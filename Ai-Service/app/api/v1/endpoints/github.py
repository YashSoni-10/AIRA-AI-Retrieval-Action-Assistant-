"""
GitHub Proxy Endpoint — AIRA FastAPI Service
=============================================
All GitHub data flows through the Node backend which holds the workspace's
encrypted OAuth token and handles automatic refresh/rotation.

This FastAPI endpoint is a thin authenticated proxy:
  1. Validates the user's JWT (via get_current_user_id)
  2. Forwards the Bearer token to Node /api/github/*
  3. Returns the Node response directly

No GitHub tokens are stored or processed here.
No fallback to global GITHUB_TOKEN — if Node fails, surface the error.
"""
import httpx
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, Query, Request, HTTPException, status
from app.core.auth import get_current_user_id

router = APIRouter()

NODE_GITHUB_BASE = "http://localhost:5000/api/github"


class AddRepoRequest(BaseModel):
    name: str = Field(..., min_length=1, description="Repository name")
    full_name: str | None = Field(default=None, description="Repository full name (org/name)")
    description: str | None = Field(default="", description="Repository description")
    html_url: str | None = Field(default=None, description="Repository URL")
    language: str | None = Field(default="TypeScript", description="Primary programming language")


def _fwd_headers(request: Request) -> dict:
    """Extract Bearer Authorization header for forwarding to Node. Never log value."""
    auth = request.headers.get("Authorization", "")
    return {"Authorization": auth, "Accept": "application/json"}


async def _proxy_get(path: str, headers: dict, params: dict | None = None) -> dict:
    """Forward a GET request to the Node GitHub backend."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{NODE_GITHUB_BASE}{path}", headers=headers, params=params or {})
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code in (401, 403):
            raise HTTPException(
                status_code=resp.status_code,
                detail="GitHub authentication failed. Please reconnect your GitHub account.",
            )
        raise HTTPException(status_code=resp.status_code, detail="GitHub service error.")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="GitHub service timed out.")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Cannot reach AIRA backend.")


@router.get("/status")
async def github_status(
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """Get GitHub connection status for the authenticated user's workspace."""
    return await _proxy_get("/status", _fwd_headers(request))


@router.get("/repos")
async def list_repos(
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """List GitHub repositories for the authenticated workspace."""
    return await _proxy_get("/repos", _fwd_headers(request))


@router.post("/repos", status_code=status.HTTP_201_CREATED)
async def create_repo(
    request: Request,
    body: AddRepoRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Add a repository to the workspace."""
    headers = _fwd_headers(request)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{NODE_GITHUB_BASE}/repos",
                headers=headers,
                json=body.model_dump(),
            )
        if resp.status_code in (200, 201):
            return resp.json()
        if resp.status_code in (401, 403):
            raise HTTPException(status_code=resp.status_code, detail="GitHub authentication failed.")
        raise HTTPException(status_code=resp.status_code, detail="Failed to add repository.")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="GitHub service timed out.")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Cannot reach AIRA backend.")


@router.get("/issues")
async def list_issues(
    request: Request,
    repo: str | None = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    """List GitHub issues for a repository."""
    params = {"repo": repo} if repo else {}
    return await _proxy_get("/issues", _fwd_headers(request), params)


@router.get("/pulls")
async def list_pulls(
    request: Request,
    repo: str | None = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    """List GitHub pull requests for a repository."""
    params = {"repo": repo} if repo else {}
    return await _proxy_get("/pulls", _fwd_headers(request), params)


@router.get("/tree")
async def get_tree(
    request: Request,
    repo: str = Query(..., description="Repository full_name (owner/name)"),
    branch: str | None = Query(default=None),
    path: str | None = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    """Get the file tree and structure of a GitHub repository."""
    params = {"repo": repo}
    if branch:
        params["branch"] = branch
    if path:
        params["path"] = path
    return await _proxy_get("/tree", _fwd_headers(request), params)


@router.get("/file")
async def get_file(
    request: Request,
    repo: str = Query(..., description="Repository full_name (owner/name)"),
    path: str = Query(..., description="File path relative to repository root"),
    ref: str | None = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    """Get the content of a file in a GitHub repository."""
    params = {"repo": repo, "path": path}
    if ref:
        params["ref"] = ref
    return await _proxy_get("/file", _fwd_headers(request), params)
