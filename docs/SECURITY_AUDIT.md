# AIRA — Security Audit
**Date:** 2026-09-09 | Source: All backend files

---

## CURRENTLY IMPLEMENTED SECURITY

### 1. Password Hashing ✅
- **Implementation:** `bcryptjs` with salt rounds = 12
- **File:** `backend/src/models/User.js` (pre-save hook), `backend/src/controllers/authController.js` (in-memory path)
- **Verification:** `bcrypt.compare()` in `comparePassword()` instance method and in-memory login
- **Status:** CORRECTLY IMPLEMENTED

### 2. JWT Authentication ✅
- **Signing:** `jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" })` in `authController.js`
- **Verification:** `jwt.verify(token, process.env.JWT_SECRET)` in `middleware/auth.js`
- **Token extraction:** `Authorization: Bearer <token>` header
- **User lookup:** DB lookup after decode to confirm user still exists and `isActive === true`
- **Status:** CORRECTLY IMPLEMENTED

### 3. Protected Routes ✅
- **Middleware:** `protect` middleware in `middleware/auth.js`
- **Applied to:** `/api/auth/me`, `/api/auth/update-profile`, `/api/auth/change-password`
- **Status:** CORRECTLY IMPLEMENTED

### 4. Role-Based Authorization ✅ (partial)
- **Implementation:** `restrictTo(...roles)` factory in `middleware/auth.js`
- **Status:** IMPLEMENTED but **NEVER USED** — no routes call `restrictTo()`

### 5. Password Exclusion from Responses ✅
- **Mongoose:** `select: false` on password field + `toJSON()` removes it
- **In-memory:** `sendToken()` does `delete userResponse.password`
- **Status:** CORRECTLY IMPLEMENTED

### 6. CORS Restrictions ✅
- **Node backend:** `cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173", credentials: true })`
- **FastAPI:** `allow_origins=[FRONTEND_ORIGIN, "http://localhost:5173", "http://localhost:3000"]`
- **Status:** IMPLEMENTED (but FastAPI CORS allows localhost:3000 in addition — minor over-permissiveness)

---

## MISSING / REQUIRED SECURITY

### CRITICAL ISSUES

#### 🔴 AI Service Has Zero Authentication
- **Problem:** All 12 FastAPI endpoints are publicly accessible without any authentication
- **Impact:** Any person who knows the URL can:
  - Upload arbitrary documents to the knowledge base
  - Delete any document from the knowledge base
  - Query the knowledge base using costly LLM calls
  - Execute agents with arbitrary queries
  - Access all indexed documents
- **File:** All files in `Ai-Service/app/api/v1/endpoints/`
- **Fix Required:** Add JWT verification middleware to FastAPI endpoints, forward token from frontend

#### 🔴 No User/Workspace Isolation in Vector Store
- **Problem:** All documents are stored in a single shared Qdrant collection `aira_knowledge`
- **Impact:** User A's uploaded documents are retrievable by User B's RAG queries. No privacy.
- **Fix Required:** Add `user_id` to Qdrant payload, filter by `user_id` during retrieval

#### 🔴 Anyone Can Delete Anyone's Documents
- **Problem:** `DELETE /api/v1/ingest/{filename}` takes only a filename — no ownership check
- **Impact:** User B can delete User A's document by knowing the filename
- **Fix Required:** Verify ownership via user_id filter before deletion

---

### HIGH SEVERITY

#### 🟠 No Rate Limiting on Auth Endpoints
- **Problem:** No limit on login attempts — brute force possible
- **Fix Required:** `express-rate-limit` on `/api/auth/login`, `/api/auth/register`

#### 🟠 No Rate Limiting on AI Service
- **Problem:** No limit on chat/ingest/agent calls — can exhaust LLM API quotas
- **Fix Required:** Rate limiting per IP or per user on expensive endpoints

#### 🟠 JWT Secret — No Default, No Validation
- **Problem:** If `JWT_SECRET` is not set in `.env`, both `jwt.sign()` and `jwt.verify()` receive `undefined` and throw errors (sign returns undefined secret, verify fails with secret required)
- **Impact:** Server would crash on first auth attempt
- **Fix Required:** Validate `JWT_SECRET` is set at startup; add default only in development

#### 🟠 In-Memory Fallback Loses Auth Data
- **Problem:** If MongoDB is down, registered users are lost on server restart
- **Impact:** Users lose access; registrations are silently discarded
- **Fix Required:** Warn loudly when operating in memory mode; require MongoDB for production

---

### MEDIUM SEVERITY

#### 🟡 No Input Sanitization
- **Problem:** No library (joi, express-validator, zod) validates input formats
- **Impact:** Malformed emails accepted; any string accepted as role
- **Fix Required:** Add validation middleware

#### 🟡 No Helmet.js (HTTP Security Headers)
- **Problem:** Missing `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, etc.
- **Fix Required:** `app.use(require('helmet')())`

#### 🟡 No Logging Middleware
- **Problem:** No morgan or winston — cannot audit access patterns or detect attacks
- **Fix Required:** Add request logging

#### 🟡 Prompt Injection Defense
- **Problem:** User queries passed directly to LLM with minimal sanitization
- **Impact:** Sophisticated users could craft queries that override AIRA's system prompt
- **Current Mitigation:** System prompt says "answer STRICTLY based on context" — weak
- **Fix Required:** Input filtering, prompt hardening, separate user content from instructions

#### 🟡 GitHub Token in Logs
- **Problem:** If `GITHUB_TOKEN` is set incorrectly, the full API error (which may contain token info) is logged via `logger.error()`
- **Fix Required:** Sanitize sensitive data in error logs

---

### LOW SEVERITY

#### 🔵 No CSRF Protection
- **Assessment:** JWT in Authorization header (not cookie) is inherently CSRF-safe. NOT a vulnerability.

#### 🔵 Token Storage in localStorage
- **Problem:** `aira_token` stored in `localStorage` — vulnerable to XSS
- **Current Risk:** Low (no persistent XSS vectors found in code)
- **Better Practice:** `httpOnly` cookie + CSRF token pair
- **Fix Priority:** P3 (Level 3 hardening)

#### 🔵 No Refresh Token
- **Problem:** 7-day tokens with no refresh mechanism
- **Fix Required:** Refresh token endpoint for production

---

## Authentication Trace

```
REGISTRATION:
  POST /api/auth/register
  → authController.register()
  → Validate name/email/password presence
  → Check for existing email
  → User.create({ ... })  ← bcrypt hashes password via pre-save hook
  → signToken(user._id) → jwt.sign
  → sendToken() → { token, user (no password) }

LOGIN:
  POST /api/auth/login
  → authController.login()
  → User.findOne({ email }).select("+password")
  → user.comparePassword(password) → bcrypt.compare()
  → signToken(user._id)
  → sendToken() → { token, user }

PROTECTED ROUTE:
  GET /api/auth/me (Authorization: Bearer <token>)
  → protect middleware
  → jwt.verify(token, JWT_SECRET) → { id }
  → User.findById(id) — user must exist + isActive=true
  → req.user = user
  → next() → authController.getMe()
  → res.json({ success, user })

AI SERVICE (CURRENT — INSECURE):
  POST /api/v1/chat { query }
  → FastAPI chat endpoint
  → NO AUTH CHECK
  → rag_engine.run_rag_query()
  → Response
```

---

## Security Summary Table

| Control | Status | Priority |
|---------|--------|---------|
| Password hashing (bcrypt) | ✅ IMPLEMENTED | — |
| JWT authentication | ✅ IMPLEMENTED | — |
| Protected Node routes | ✅ IMPLEMENTED | — |
| AI service authentication | ❌ MISSING | P0 |
| User isolation in vector store | ❌ MISSING | P0 |
| Document ownership check | ❌ MISSING | P0 |
| Rate limiting (auth) | ❌ MISSING | P1 |
| Rate limiting (AI service) | ❌ MISSING | P1 |
| JWT_SECRET validation | ❌ MISSING | P1 |
| Input sanitization | ❌ MISSING | P1 |
| Helmet.js | ❌ MISSING | P2 |
| Logging | ❌ MISSING | P2 |
| Prompt injection defense | ❌ MISSING | P2 |
| Refresh tokens | ❌ MISSING | P3 |
| HttpOnly cookie auth | ❌ MISSING | P3 |
| PII protection | ❌ MISSING | P3 |
| Role-based resource access | ❌ MISSING | P2 |
