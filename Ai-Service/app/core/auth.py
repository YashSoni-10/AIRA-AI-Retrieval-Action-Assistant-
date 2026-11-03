"""
AIRA FastAPI JWT Authentication Dependency.

Verifies Bearer tokens issued by the Node.js auth backend.
Uses the shared JWT_SECRET with HS256 — no second auth system.

Public interface:
    get_current_user_id — FastAPI Depends() for header-based Bearer auth
    verify_token_string  — for SSE endpoints that pass token as query param
"""
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.core.config import settings

# ──────────────────────────────────────────────────────────────────────────────
# Bearer extractor — auto_error=False so we return a clean 401, not a 403
# ──────────────────────────────────────────────────────────────────────────────
_bearer_scheme = HTTPBearer(auto_error=False)


def _decode_token_payload(token: str) -> dict:
    """
    Core JWT decode logic. Returns full payload dictionary.
    """
    if not settings.JWT_SECRET:
        # Configuration error — misconfigured deployment, not a bad token
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is not configured. Contact your administrator.",
        )
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=["HS256"],   # explicit whitelist — prevents alg:none attacks
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or malformed token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id: str | None = payload.get("id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing user identity.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload


def _decode_token(token: str) -> str:
    """Extracts and returns payload['id'] as authenticated user_id."""
    return _decode_token_payload(token)["id"]


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    """
    FastAPI Dependency for standard HTTP Bearer authentication.

    Usage:
        user_id: str = Depends(get_current_user_id)

    Extracts the Bearer token from the Authorization header, verifies it,
    and returns the authenticated user_id (payload["id"]).

    Raises HTTP 401 for missing, expired, or invalid tokens.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Provide a valid Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode_token(credentials.credentials)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> dict:
    """Returns {'id': user_id, 'role': role} from verified token."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Provide a valid Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = _decode_token_payload(credentials.credentials)
    return {"id": payload["id"], "role": payload.get("role", "member")}


def require_roles(*allowed_roles: str):
    """Dependency that ensures the authenticated user has one of the allowed roles."""
    def role_checker(
        credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    ) -> str:
        if credentials is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated. Provide a valid Bearer token.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        payload = _decode_token_payload(credentials.credentials)
        role = payload.get("role", "member")
        if role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Forbidden: role '{role}' does not have permission to perform this action.",
            )
        return payload["id"]
    return role_checker


def verify_token_payload(token: str) -> dict:
    """
    Verify a raw token string and return the full decoded payload dictionary.
    Raises HTTP 401 for missing, expired, or invalid tokens.
    """
    if not token or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Provide a valid token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode_token_payload(token.strip())


def verify_token_string(token: str) -> str:
    """
    Verify a raw token string passed as a query parameter.

    Used ONLY for SSE streaming endpoints where the browser's EventSource
    API cannot set custom headers. This is a temporary solution for local
    development — replace with fetch()+ReadableStream before production.

    IMPORTANT: The token value must NEVER be logged server-side.

    Returns the authenticated user_id on success.
    Raises HTTP 401 for missing, expired, or invalid tokens.
    """
    if not token or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Provide a valid token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode_token(token.strip())
