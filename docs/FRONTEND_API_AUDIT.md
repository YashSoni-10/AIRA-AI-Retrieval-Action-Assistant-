# AIRA — Frontend API Audit
**Date:** 2026-09-09 | Source: `frontend/src/services/api.ts`, `frontend/src/services/auth.ts`, and all pages

---

## 1. Auth Service Calls (`services/auth.ts` → Node backend port 5000)

| Feature | Frontend File | Function | HTTP | Endpoint | Request Body | Expected Response | Backend Exists? | Controller Exists? | Status |
|---------|--------------|----------|------|----------|--------------|-------------------|-----------------|-------------------|--------|
| Register | LoginPage.tsx | `register()` | POST | `/api/auth/register` | `{ name, email, password }` | `{ success, token, user }` | ✅ | ✅ authController.js | **IMPLEMENTED** |
| Login | LoginPage.tsx | `login()` | POST | `/api/auth/login` | `{ email, password }` | `{ success, token, user }` | ✅ | ✅ authController.js | **IMPLEMENTED** |
| Get Me | SettingsPage.tsx | `getMe()` | GET | `/api/auth/me` | — | `{ success, user }` | ✅ | ✅ authController.js | **IMPLEMENTED** |
| Update Profile | SettingsPage.tsx | `updateProfile()` | PATCH | `/api/auth/update-profile` | `{ name, role }` | `{ success, user }` | ✅ | ✅ authController.js | **IMPLEMENTED** |
| Change Password | SettingsPage.tsx | `changePassword()` | PATCH | `/api/auth/change-password` | `{ currentPassword, newPassword }` | `{ success, token, user }` | ✅ | ✅ authController.js | **IMPLEMENTED** |
| Logout | SettingsPage.tsx | `logout()` | None (localStorage) | — | — | — | N/A | N/A | **IMPLEMENTED** |

---

## 2. AI Service Calls (`services/api.ts` → FastAPI port 8000)

| Feature | Frontend File | Function | HTTP | Endpoint | Request | Expected Response | AI Service Exists? | Status |
|---------|--------------|----------|------|----------|---------|-------------------|-------------------|--------|
| Health Check | ChatPage.tsx | `checkHealth()` | GET | `/api/v1/health` | — | `{ status, service, version, llm_provider, indexed_vectors }` | ✅ health.py | **IMPLEMENTED** |
| Chat (RAG Q&A) | ChatPage.tsx | `sendChatMessage()` | POST | `/api/v1/chat` | `{ query, top_k }` | `{ answer, confidence, confidence_label, reasoning_steps, citations, chunks_found, query }` | ✅ chat.py | **IMPLEMENTED** |
| Chat Stream | ChatPage.tsx | `streamChatMessage()` | GET (SSE) | `/api/v1/chat/stream` | Query params `?query=&top_k=` | SSE events: reasoning_step, token, done, error | ✅ chat.py | **IMPLEMENTED (simulated streaming)** |
| Upload Document | DocumentsPage.tsx | `ingestDocument()` | POST | `/api/v1/ingest` | FormData (file) | `{ status, filename, file_size_kb, chunks_created, vectors_stored, message }` | ✅ ingest.py | **IMPLEMENTED** |
| List Documents | DocumentsPage.tsx | `listDocuments()` | GET | `/api/v1/ingest/list` | — | `{ documents: string[], count }` | ✅ ingest.py | **IMPLEMENTED** |
| Delete Document | DocumentsPage.tsx | `deleteDocument()` | DELETE | `/api/v1/ingest/{filename}` | URL param | `{ status, message }` | ✅ ingest.py | **IMPLEMENTED** |
| Semantic Search | KnowledgePage.tsx | `searchKnowledge()` | GET | `/api/v1/search` | `?q=&top_k=` | `{ query, results, count }` | ✅ search.py | **IMPLEMENTED** |
| List Agents | AgentsPage.tsx | `getAgents()` | GET | `/api/v1/agents` | — | `{ agents, count }` | ✅ agents.py | **IMPLEMENTED** |
| Execute Agent | AgentsPage.tsx | `executeAgent()` | POST | `/api/v1/agents/execute` | `{ agent_id, query }` | `{ agent_id, agent_name, steps, answer, task_created, knowledge_results, status }` | ✅ agents.py | **IMPLEMENTED** |
| GitHub Repos | ProjectsPage.tsx | `getGithubRepos()` | GET | `/api/v1/github/repos` | — | `{ repositories, count }` | ✅ github.py | **IMPLEMENTED (mock fallback)** |
| GitHub Issues | ProjectsPage.tsx | `getGithubIssues()` | GET | `/api/v1/github/issues` | `?repo=` | `{ issues, count, repository }` | ✅ github.py | **IMPLEMENTED (mock fallback)** |
| GitHub PRs | ProjectsPage.tsx | `getGithubPulls()` | GET | `/api/v1/github/pulls` | `?repo=` | `{ pulls, count, repository }` | ✅ github.py | **IMPLEMENTED (mock fallback)** |

---

## 3. Unconnected UI Elements (Frontend → No API)

| Component | File | What It Should Do | Current State |
|-----------|------|-------------------|---------------|
| SearchBox | SearchBox.tsx | Global knowledge search | Static UI — no API call |
| AIAssistant widget | AIAssistant.tsx | Quick Q&A on dashboard | Static UI — no API call |
| StatsCard - Knowledge Sources | App.tsx Dashboard | Show real indexed document count | Hardcoded "128" |
| StatsCard - Conversations | App.tsx Dashboard | Show real conversation count | Hardcoded "24" |
| StatsCard - Active Tasks | App.tsx Dashboard | Show real task count | Hardcoded "12" |
| StatsCard - AI Activity | App.tsx Dashboard | Show real AI success rate | Hardcoded "94%" |
| ActivityPanel | ActivityPanel.tsx | Show recent activity from backend | Hardcoded data |

---

## 4. Frontend/Backend Mismatches

| Issue | Severity | Detail |
|-------|----------|--------|
| AI service has no auth | **CRITICAL** | All FastAPI endpoints accept requests without any JWT. Any user (or anonymous) can upload, delete, or query documents. The token stored in `localStorage` is NEVER sent to the AI service. |
| Dashboard stats hardcoded | **HIGH** | Stats cards show fake numbers. No API is called to populate them. |
| SearchBox not wired | **MEDIUM** | The main dashboard search box is decorative — it doesn't call `/api/v1/search`. |
| AIAssistant widget not wired | **MEDIUM** | The floating AI panel doesn't call the chat API. |
| GitHub fallback is mock data | **MEDIUM** | Without `GITHUB_TOKEN`, repos/issues/PRs shown are completely fabricated. |
| SSE streaming is simulated | **LOW** | `/api/v1/chat/stream` emits the full LLM response word-by-word after generation, not true token streaming from the LLM provider. |
| `isActive` check in memory fallback | **LOW** | `memoryUsers` objects created in authController.js do have `isActive: true`. The middleware checks it. No bug, but memory users are lost on server restart. |
| No error boundary in frontend | **LOW** | React errors in pages are unhandled — could crash the whole SPA. |

---

## 5. API Type Contract Verification

The frontend TypeScript types in `api.ts` are verified against the actual FastAPI response models:

| Frontend Type | FastAPI Response | Match? |
|--------------|-----------------|--------|
| `ChatResponse` | `ChatResponse` Pydantic model in chat.py | ✅ MATCH |
| `Citation` | `Citation` Pydantic model | ✅ MATCH |
| `IngestResponse` | Dict returned from `ingest_document()` | ✅ MATCH |
| `SearchResponse` | Dict returned from `search_knowledge()` | ✅ MATCH |
| `AgentInfo` | Dict from `list_agents()` | ✅ MATCH |
| `AgentExecuteResponse` | Dict returned from `execute_agent()` | ✅ MATCH |
| `HealthResponse` | Dict returned from `health_check()` | ✅ MATCH |
| `GitHubRepo` | Dict from `get_github_repos()` | ✅ MATCH |
| `GitHubIssue` | Dict from `get_github_issues()` | ✅ MATCH |
| `GitHubPullRequest` | Dict from `get_github_pulls()` | ✅ MATCH |
| `AuthResponse` | `{ success, token, user }` from authController | ✅ MATCH |
| `AuthUser` | User object from authController | ✅ MATCH |

**API Type Contracts: All types match actual backend responses.**  
**No type mismatches found between frontend clients and backend responses.**
