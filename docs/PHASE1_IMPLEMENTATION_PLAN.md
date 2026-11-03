# AIRA — Phase 1 Implementation Plan: Security Foundation & Identity
**Date:** 2026-09-09 | Status: AWAITING APPROVAL

---

## Pre-Condition: Critical Discovery

Two facts confirmed from actual source code inspection:

1. **`backend/.env` DOES NOT EXIST.** The `JWT_SECRET` is `undefined` at runtime. In `jsonwebtoken@9`, `jwt.sign({ id }, undefined)` and `jwt.verify(token, undefined)` both throw `secretOrPublicKey must have a value`. Any register or login call would crash with an unhandled 500.

2. **`Ai-Service/.env` has NO `JWT_SECRET` field.** The `Settings` class in `config.py` has 12 fields — none of them is `JWT_SECRET`. FastAPI has no awareness of a JWT secret.

These two facts confirm that the P0 fix is **real and urgent** — the system has a broken auth setup by omission.

---

## JWT Algorithm Compatibility Verification

Node backend (`authController.js` line 12):
```js
jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || "7d" })
// Default algorithm for jsonwebtoken with string secret: HS256
```

Token payload structure (actual):
```json
{ "id": "<MongoDB _id string or mem_xxx string>", "iat": 1234567890, "exp": 1234567890 }
```

Python `PyJWT` with `jwt.decode(token, secret, algorithms=["HS256"])` is **fully compatible**. Same secret + same algorithm + same payload. No second auth system needed.

---

## Final Authentication Flow (End-to-End)

```
1. User submits login form
   → React LoginPage.tsx
   → POST http://localhost:5000/api/auth/login { email, password }

2. Node backend verifies credentials
   → authController.js login()
   → bcrypt.compare(password, hash)
   → jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" })
   → Response: { success: true, token, user }

3. React stores the token
   → auth.ts: localStorage.setItem("aira_token", token)
   → AuthGate re-renders → App shown

4. User performs an AI action (e.g., upload document)
   → api.ts request() helper
   → CURRENTLY: no Authorization header to FastAPI
   → AFTER PHASE 1: Authorization: Bearer <JWT> added to all AI service calls

5. FastAPI receives request
   → app/core/auth.py get_current_user_id() Dependency
   → jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
   → Extracts payload["id"] → user_id
   → Injects user_id into the endpoint function

6. Endpoint receives authenticated user_id
   → ingest_document(file, user_id="507f1f77bcf86cd799439011")
   → user_id stored, ready for Phase 2 Qdrant filtering
```

---

## TASK 1 — JWT_SECRET Validation at Node Backend Startup

### Current State
**File:** `backend/server.js` (viewed — 76 lines)
- Line 1: `require("dotenv").config()` — loads from `.env`
- **`backend/.env` DOES NOT EXIST** — confirmed by directory listing
- `JWT_SECRET` is `undefined` at runtime
- Server starts regardless — no guard exists

### What Needs to Change
Add a fail-fast check immediately after `require("dotenv").config()`, before Express is configured:

```js
// In backend/server.js, after line 1:
if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not set.");
  console.error("Create backend/.env from backend/.env.example and set JWT_SECRET.");
  process.exit(1);
}
```

### Also Required: Create `backend/.env`
Must be created before the server can start. Contents:
```
PORT=5000
MONGO_URI=mongodb://localhost:27017/aira
JWT_SECRET=<a_real_secret_min_32_chars>
JWT_EXPIRE=7d
FRONTEND_ORIGIN=http://localhost:5173
```

### Why Required
Without this guard, auth crashes silently with unhandled 500s. The developer gets no actionable error message.

### Security Considerations
- Minimum 32 random characters for JWT_SECRET
- Never hardcode a default fallback value — force the developer to set it

### Verification
| Case | Expected |
|------|---------|
| Start Node without `backend/.env` | Process exits with FATAL message |
| Start Node with correct `.env` | Server starts on port 5000 |
| POST /api/auth/register | 201, returns JWT token |
| POST /api/auth/login | 200, returns JWT token |

---

## TASK 2 — Add JWT_SECRET to AI Service Configuration

### Current State
**File:** `Ai-Service/app/core/config.py` (viewed — 48 lines)

The `Settings` class ends at line 44. No `JWT_SECRET`. All 12 existing fields are unaffected.

**File:** `Ai-Service/.env` (viewed — 29 lines)

No `JWT_SECRET` line. GROQ_API_KEY is set. File exists and is functional.

### What Needs to Change

**`Ai-Service/app/core/config.py`** — Add one field inside the `Settings` class:
```python
# JWT (shared with Node backend — must be identical value)
JWT_SECRET: str = os.getenv("JWT_SECRET", "")
```

**`Ai-Service/.env`** — Add one line:
```
# Must match backend/.env JWT_SECRET exactly
JWT_SECRET=<same value as backend/.env JWT_SECRET>
```

**`Ai-Service/.env.example`** — Add one line:
```
# JWT Secret (must match the Node backend JWT_SECRET exactly)
JWT_SECRET=your_jwt_secret_key_here
```

### Why Required
FastAPI cannot verify a token without the signing secret. The secret must be identical on both sides.

### Dependencies
Task 1 must complete first — `JWT_SECRET` value is established in `backend/.env`, then copied to `Ai-Service/.env`.

---

## TASK 3 — Create FastAPI JWT Auth Dependency

### Current State
`Ai-Service/app/core/auth.py` — **DOES NOT EXIST**

No JWT verification exists anywhere in the Python codebase.

### What Needs to Change

**Create** `Ai-Service/app/core/auth.py`:

```python
"""
AIRA FastAPI JWT Authentication Dependency.
Verifies Bearer tokens issued by the Node.js auth backend.
Same JWT_SECRET and HS256 algorithm — no second auth system.
"""
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

_bearer = HTTPBearer(auto_error=False)


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """
    FastAPI Dependency: Extracts and verifies Bearer JWT.
    Returns the authenticated user_id (payload["id"]).
    Raises HTTP 401 on missing, expired, or invalid token.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated — no token provided",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode_token(credentials.credentials)


def verify_token_string(token: str) -> str:
    """
    Verify a raw token string — used for SSE endpoints
    where EventSource cannot set Authorization headers.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated — no token provided",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode_token(token)


def _decode_token(token: str) -> str:
    """Core JWT decode logic shared by both verification paths."""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=["HS256"],
        )
        user_id: str | None = payload.get("id")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token — missing user identity",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or malformed token",
            headers={"WWW-Authenticate": "Bearer"},
        )
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| `HTTPBearer(auto_error=False)` | Prevents FastAPI auto-returning 403; we control the 401 response exactly |
| `algorithms=["HS256"]` whitelist | Prevents `alg: none` algorithm confusion attacks |
| `_decode_token()` shared helper | DRY — same logic for header-based and query-param-based token verification |
| `verify_token_string()` separate function | Required for SSE which cannot use `Depends()` in the same way |
| Returns `str` (user_id only) | Endpoints only need user_id; no need to expose full JWT payload |

### Python Package Check
The package `PyJWT` is imported as `import jwt`. Check:
```
d:\Coding\Aira\AIRA-AI-Retrieval-Action-Assistant-\Ai-Service\venv\Scripts\pip.exe show PyJWT
```
If installed: no change to `requirements.txt`.
If not installed: add `PyJWT>=2.8.0` to `requirements.txt`.

> **Warning:** Do not confuse `PyJWT` (correct) with `jwt` (a different, older package). They both import as `import jwt` but are incompatible.

---

## TASK 4 — Add JWT_SECRET Startup Log to FastAPI

### Current State
**File:** `Ai-Service/app/main.py` — `startup_event()` at lines 40-47

Currently logs LLM key status but nothing about JWT_SECRET. If `JWT_SECRET` is missing, auth fails with a confusing "Invalid or malformed token" message rather than a clear config error.

### What Needs to Change

In `startup_event()`, add:
```python
logger.info(f"   JWT Secret   : {'✅ set' if settings.JWT_SECRET else '❌ NOT SET — all protected endpoints will return 401'}")
if not settings.JWT_SECRET:
    logger.critical("FATAL: JWT_SECRET not configured in Ai-Service/.env")
    logger.critical("Copy JWT_SECRET from backend/.env to Ai-Service/.env — they must match exactly")
```

### Why Not `sys.exit()`?
The AI service remains useful for health checks and Swagger UI exploration even when misconfigured. A critical log is sufficient — the auth dependency enforces the 401 on all protected calls.

---

## TASK 5 — Protect FastAPI Endpoints

### Auth Policy per Endpoint

| Endpoint | Protect? | Rationale |
|----------|---------|-----------|
| GET /health | ❌ Open | Health checks must work without auth |
| POST /ingest | ✅ Auth | Writes to shared knowledge base |
| GET /ingest/list | ✅ Auth | Lists documents (user-scoped after Phase 2) |
| DELETE /ingest/{fn} | ✅ Auth | Destructive, irreversible action |
| POST /chat | ✅ Auth | Consumes LLM API credits |
| GET /chat/stream | ✅ Auth | Consumes LLM API credits (via query param token) |
| GET /search | ✅ Auth | Exposes all indexed knowledge |
| GET /agents | ❌ Open | Read-only agent metadata, no data risk |
| POST /agents/execute | ✅ Auth | Consumes LLM credits + reads knowledge base |
| GET /github/repos | ❌ Open | Public/mock data, no data risk |
| GET /github/issues | ❌ Open | Same rationale |
| GET /github/pulls | ❌ Open | Same rationale |

### Pattern for Protected Endpoints

```python
from app.core.auth import get_current_user_id
from fastapi import Depends

@router.post("/ingest")
async def ingest_document(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),  # ← FastAPI injects this
):
    # user_id is authenticated and verified
    # Not yet passed to services (Phase 2 will add user_id to Qdrant payload)
    ...
```

### Changes to `ingest.py`

All 3 endpoints add `user_id: str = Depends(get_current_user_id)`:

```python
# POST /ingest
async def ingest_document(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):

# GET /ingest/list
async def list_indexed_documents(
    user_id: str = Depends(get_current_user_id),
):

# DELETE /ingest/{filename}
async def delete_document(
    filename: str,
    user_id: str = Depends(get_current_user_id),
):
```

### Changes to `chat.py`

**POST /chat** — standard Depends:
```python
async def chat(
    request: ChatRequest,
    user_id: str = Depends(get_current_user_id),
):
```

**GET /chat/stream** — SSE constraint: Standard `EventSource` API **cannot set custom headers** (browser limitation). Solution: pass token as query parameter.

```python
from app.core.auth import verify_token_string

async def chat_stream(
    query: str,
    top_k: int = 5,
    token: str = "",   # ← token passed as ?token= query param
):
    user_id = verify_token_string(token)  # raises 401 if invalid
    ...
```

### Changes to `search.py`

```python
async def search_knowledge(
    q: str,
    top_k: int = 5,
    user_id: str = Depends(get_current_user_id),
):
```

### Changes to `agents.py`

Only `POST /agents/execute` is protected. `GET /agents` stays open.

```python
# POST /agents/execute — ADD auth
async def execute_agent_endpoint(
    request: AgentExecuteRequest,
    user_id: str = Depends(get_current_user_id),
):

# GET /agents — NO CHANGE
```

### Backward Compatibility
- `user_id` parameter is added to function signatures but **not yet passed to services**
- All existing service call behavior is unchanged
- Existing response formats are unchanged
- The only behavioral change: unauthenticated requests now get 401 instead of 200

---

## TASK 6 — Update Frontend to Send JWT to FastAPI

### Current State

**`frontend/src/services/api.ts`** (viewed — 221 lines)

```ts
// Line 80-90 — request() helper
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },  // NO auth header
    ...options,
  });
```

```ts
// Line 137-149 — ingestDocument()
export async function ingestDocument(file: File): Promise<IngestResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE_URL}/ingest`, {
    method: "POST",
    body: formData,  // NO auth header
  });
```

```ts
// Line 109-135 — streamChatMessage()
const url = `${BASE_URL}/chat/stream?query=...&top_k=${top_k}`;
const es = new EventSource(url);  // NO token in URL
```

**`frontend/src/services/auth.ts`** (viewed — 101 lines)

The `authRequest()` helper DOES send `Authorization: Bearer` — but only to `http://localhost:5000` (Node backend). The AI service (`localhost:8000`) receives nothing.

### What Needs to Change

#### Change 1 — `request()` helper

```ts
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("aira_token");
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
```

This one change covers ALL API calls that use `request()`:
- `checkHealth()`, `sendChatMessage()`, `listDocuments()`, `deleteDocument()`, `searchKnowledge()`, `getAgents()`, `executeAgent()`, `getGithubRepos()`, `getGithubIssues()`, `getGithubPulls()`

#### Change 2 — `ingestDocument()` (FormData upload)

The file upload uses raw `fetch` with `FormData`. For multipart, the browser must set `Content-Type: multipart/form-data; boundary=...` automatically. We must NOT set `Content-Type` manually — only add the auth header.

```ts
export async function ingestDocument(file: File): Promise<IngestResponse> {
  const token = localStorage.getItem("aira_token");
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE_URL}/ingest`, {
    method: "POST",
    body: formData,
    headers: {
      // No Content-Type — browser sets multipart boundary automatically
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
```

#### Change 3 — `streamChatMessage()` (SSE)

```ts
export function streamChatMessage(
  query: string,
  onEvent: (event: StreamEvent) => void,
  top_k = 5
): () => void {
  const token = localStorage.getItem("aira_token") ?? "";
  const url = `${BASE_URL}/chat/stream?query=${encodeURIComponent(query)}&top_k=${top_k}&token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  ...
}
```

### Why EventSource Cannot Use Headers (Important)

The browser's native `EventSource` API does not accept a headers option. This is a W3C spec limitation — `EventSource` is a simple GET request with no custom header support. Options:
1. **Query param** (chosen for Phase 1) — simple, works immediately, token is verified server-side
2. **`fetch` + `ReadableStream`** — more correct, requires rewriting SSE client code (Phase 2 upgrade)
3. **Polyfill library** — adds dependency weight unnecessarily

The query param approach is acceptable because:
- The token is still cryptographically verified server-side
- Token is short-lived (7d)
- This runs on localhost in development
- It can be upgraded to `fetch`+`ReadableStream` in Phase 2

---

## TASK 7-9 — Verification Tests (not code)

### Unauthenticated → 401
```bash
curl -X POST http://localhost:8000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"query":"hello"}'
# Expected: 401 {"detail": "Not authenticated — no token provided"}
```

### Expired Token → 401
```bash
curl -X POST http://localhost:8000/api/v1/ingest \
  -H "Authorization: Bearer <expired_token>"
# Expected: 401 {"detail": "Token has expired"}
```

### Invalid Token → 401
```bash
curl -X GET "http://localhost:8000/api/v1/search?q=test" \
  -H "Authorization: Bearer garbage"
# Expected: 401 {"detail": "Invalid or malformed token"}
```

### Valid Token → 200
```bash
# Step 1: Get token from Node backend
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@test.com","password":"password"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Step 2: Use at AI service
curl -X POST http://localhost:8000/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"hello"}'
# Expected: 200, full RAG response
```

### Health stays open
```bash
curl http://localhost:8000/api/v1/health
# Expected: 200, no auth required
```

---

## Complete Files Summary

### Files to Modify

| File | What Changes |
|------|-------------|
| [`backend/server.js`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/backend/server.js) | Add 5-line JWT_SECRET fail-fast guard after `require("dotenv").config()` |
| [`Ai-Service/app/core/config.py`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/Ai-Service/app/core/config.py) | Add `JWT_SECRET: str = os.getenv("JWT_SECRET", "")` to Settings class |
| [`Ai-Service/app/main.py`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/Ai-Service/app/main.py) | Add JWT_SECRET presence check in `startup_event()` |
| [`Ai-Service/app/api/v1/endpoints/ingest.py`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/Ai-Service/app/api/v1/endpoints/ingest.py) | Add `user_id: str = Depends(get_current_user_id)` to all 3 routes |
| [`Ai-Service/app/api/v1/endpoints/chat.py`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/Ai-Service/app/api/v1/endpoints/chat.py) | POST /chat gets Depends; GET /chat/stream gets `token: str = ""` + `verify_token_string()` |
| [`Ai-Service/app/api/v1/endpoints/search.py`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/Ai-Service/app/api/v1/endpoints/search.py) | Add `user_id: str = Depends(get_current_user_id)` |
| [`Ai-Service/app/api/v1/endpoints/agents.py`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/Ai-Service/app/api/v1/endpoints/agents.py) | Add `Depends` to `POST /agents/execute` only; `GET /agents` unchanged |
| [`frontend/src/services/api.ts`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/frontend/src/services/api.ts) | Add JWT to `request()`, `ingestDocument()`, `streamChatMessage()` |
| [`Ai-Service/.env`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/Ai-Service/.env) | Add `JWT_SECRET=` line |
| [`Ai-Service/.env.example`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/Ai-Service/.env.example) | Add `JWT_SECRET=your_jwt_secret_key_here` line |

### Files to Create

| File | Purpose |
|------|---------|
| [`backend/.env`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/backend/) | Backend env vars — must contain `JWT_SECRET` |
| [`Ai-Service/app/core/auth.py`](file:///d:/Coding/Aira/AIRA-AI-Retrieval-Action-Assistant-/Ai-Service/app/core/auth.py) | FastAPI JWT verification dependency (`get_current_user_id`, `verify_token_string`, `_decode_token`) |

### Dependencies to Add

| Service | Package | Action |
|---------|---------|--------|
| AI Service | `PyJWT>=2.8.0` | Check `pip show PyJWT` in venv first. Add to `requirements.txt` only if missing. |

---

## Security Risks

| Risk | Severity | Mitigation |
|------|---------|-----------|
| JWT_SECRET mismatch between services | HIGH | Both `.env` files must have identical value; documented in DEFINITION_OF_DONE.md |
| Token in SSE query param | MEDIUM | Acceptable for localhost dev; upgrade to `fetch`+`ReadableStream` in Phase 2 |
| Token in `localStorage` (XSS risk) | LOW | No XSS vectors found in current code; move to httpOnly cookie in Phase 3 |
| Token replay after logout | LOW | Logout clears localStorage; token valid until expiry. No blacklist in this phase. |
| `auto_error=False` on HTTPBearer | INFO | Intentional — we control the 401 message exactly |

---

## Implementation Order (13 Steps)

```
Step 1:  Create backend/.env with JWT_SECRET (and other vars from .env.example)
Step 2:  Modify backend/server.js — add 5-line fail-fast guard
Step 3:  Add JWT_SECRET to Ai-Service/.env (same value as backend/.env)
Step 4:  Add JWT_SECRET comment to Ai-Service/.env.example
Step 5:  Modify Ai-Service/app/core/config.py — add JWT_SECRET field to Settings
Step 6:  Check PyJWT: pip show PyJWT in venv — add to requirements.txt if missing
Step 7:  Create Ai-Service/app/core/auth.py — NEW FILE with 3 functions
Step 8:  Modify Ai-Service/app/main.py — add JWT_SECRET log in startup_event()
Step 9:  Modify Ai-Service/app/api/v1/endpoints/ingest.py — add Depends to 3 routes
Step 10: Modify Ai-Service/app/api/v1/endpoints/chat.py — Depends on POST; token param on SSE
Step 11: Modify Ai-Service/app/api/v1/endpoints/search.py — add Depends
Step 12: Modify Ai-Service/app/api/v1/endpoints/agents.py — add Depends to execute only
Step 13: Modify frontend/src/services/api.ts — add JWT to request(), ingestDocument(), streamChatMessage()
         → Restart all 3 services → Run all test cases
```

---

## Test Plan

### Test Set 1: Node Backend Startup
| ID | Test | Expected |
|----|------|---------|
| 1a | Start Node without `backend/.env` | Process exits immediately with FATAL JWT_SECRET message |
| 1b | Start Node with `backend/.env` containing valid `JWT_SECRET` | Server starts on port 5000 |

### Test Set 2: Node Auth Flow (regression — must still work)
| ID | Test | Expected |
|----|------|---------|
| 2a | POST /api/auth/register valid data | 201 + JWT token |
| 2b | POST /api/auth/login correct credentials | 200 + JWT token |
| 2c | POST /api/auth/login wrong password | 401 |
| 2d | GET /api/auth/me valid JWT | 200 + user object |
| 2e | GET /api/auth/me no token | 401 |

### Test Set 3: FastAPI Startup
| ID | Test | Expected |
|----|------|---------|
| 3a | Start FastAPI without JWT_SECRET in `.env` | Starts, logs CRITICAL warning |
| 3b | Start FastAPI with correct JWT_SECRET | Starts, logs "JWT Secret: ✅ set" |

### Test Set 4: FastAPI Auth Enforcement
| ID | Test | Expected |
|----|------|---------|
| 4a | GET /api/v1/health — no token | 200 ✅ (open) |
| 4b | GET /api/v1/agents — no token | 200 ✅ (open) |
| 4c | GET /api/v1/github/repos — no token | 200 ✅ (open) |
| 4d | POST /api/v1/chat — no token | 401 "Not authenticated — no token provided" |
| 4e | POST /api/v1/ingest — no token | 401 "Not authenticated — no token provided" |
| 4f | GET /api/v1/search — no token | 401 "Not authenticated — no token provided" |
| 4g | POST /api/v1/agents/execute — no token | 401 "Not authenticated — no token provided" |
| 4h | POST /api/v1/chat — expired token | 401 "Token has expired" |
| 4i | POST /api/v1/chat — garbage token | 401 "Invalid or malformed token" |
| 4j | POST /api/v1/chat — token signed with wrong secret | 401 "Invalid or malformed token" |
| 4k | POST /api/v1/chat — valid token (from Node login) | 200 + RAG response |

### Test Set 5: Full End-to-End
| ID | Test | Expected |
|----|------|---------|
| 5a | Register → Login → upload doc → chat | Works end-to-end with auth |
| 5b | Login → copy token → Swagger UI Authorize → POST /chat | 200 via Swagger |
| 5c | Logout → attempt chat from frontend | 401 returned, frontend shows error |

### Test Set 6: SSE Streaming
| ID | Test | Expected |
|----|------|---------|
| 6a | Chat stream with valid token in `?token=` | SSE events received correctly |
| 6b | Chat stream with no token `?token=` | 401 immediately |
| 6c | Chat stream with invalid token | 401 immediately |

---

## What This Phase Enables for Future Phases

| Future Phase | How Phase 1 Enables It |
|-------------|------------------------|
| Phase 2 — User Isolation | `user_id` already extracted in all endpoints; wire to `add_documents(user_id=)` and `similarity_search(user_id=)` |
| Phase 3 — RBAC | `user_id` available to look up role from MongoDB and enforce access control |
| Phase 4 — Conversation History | `user_id` tags all conversations to the correct user |

---

> **STOP — Awaiting your approval before any code is written.**
