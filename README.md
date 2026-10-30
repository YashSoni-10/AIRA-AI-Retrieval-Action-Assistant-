# AIRA — AI Retrieval and Action Assistant
## Phase 1 Complete — Enterprise Knowledge Management Platform

AIRA is a full-stack enterprise AI platform that allows teams to upload documents, search their organizational knowledge base, and get grounded AI answers with citations — powered by FastAPI + Qdrant + Groq and a React 19 frontend.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AIRA Architecture                       │
├───────────────┬────────────────────────┬────────────────────┤
│   Frontend    │    Node.js Backend     │    AI Service      │
│  React + Vite │  Express + MongoDB     │  FastAPI + Qdrant  │
│  Port: 5173   │  Port: 5000            │  Port: 8000        │
├───────────────┴────────────────────────┴────────────────────┤
│ Auth Flow: Frontend → Node (JWT issue) → AI Service (verify) │
│ Data Flow: Upload → AI → Qdrant (vectors + metadata)         │
│            Query  → AI → Qdrant search → Groq → Response     │
└─────────────────────────────────────────────────────────────┘
```

## Required Software

| Software | Purpose | Install |
|----------|---------|---------|
| Node.js 18+ | Backend runtime | https://nodejs.org |
| Python 3.11+ | AI service runtime | https://python.org |
| MongoDB Atlas / local | User/auth/conversation persistence | https://mongodb.com |
| Qdrant (optional) | Vector database — auto falls back to embedded mode | https://qdrant.tech |

> **No Docker required for development.** Qdrant runs in embedded mode (local disk) automatically.

---

## Environment Variables

### `backend/.env`

```env
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/aira
JWT_SECRET=<your-64-char-random-secret>
PORT=5000
JWT_EXPIRE=7d
FRONTEND_ORIGIN=http://localhost:5173
```

### `Ai-Service/.env`

```env
# LLM
LLM_PROVIDER=groq
GROQ_API_KEY=<your-groq-api-key>
GROQ_MODEL=openai/gpt-oss-20b

# Qdrant — embedded (no Docker needed)
QDRANT_LOCAL_PATH=./qdrant_storage
QDRANT_COLLECTION=aira_knowledge
ALLOW_MEMORY_FALLBACK=false

# Embeddings
EMBEDDING_MODEL=all-MiniLM-L6-v2
CHUNK_SIZE=500
CHUNK_OVERLAP=50

# Auth (must match backend JWT_SECRET exactly)
JWT_SECRET=<same-64-char-secret-as-backend>

# CORS
FRONTEND_ORIGIN=http://localhost:5173
```

> **Never commit real secrets to git.** All `.env` files are in `.gitignore`.

---

## How to Start

### 1. MongoDB
Use MongoDB Atlas (free tier) or run locally:
```bash
mongod --dbpath ./data/db
```

### 2. Qdrant (Optional — embedded mode used automatically)
To use a remote Qdrant server instead of embedded:
```bash
# Docker
docker run -p 6333:6333 qdrant/qdrant

# Or download binary from https://qdrant.tech/documentation/quick-start/
```
Set `QDRANT_HOST=localhost` and `QDRANT_PORT=6333` in `Ai-Service/.env`.

### 3. AI Service (FastAPI)
```bash
cd Ai-Service
python -m venv venv
venv\Scripts\activate       # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 4. Node Backend (Express)
```bash
cd backend
npm install
nodemon server.js           # or: node server.js
```

### 5. Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev
```

---

## API Ports

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:5173 | React UI |
| Node Backend | http://localhost:5000 | Auth, Workspace, Conversation APIs |
| AI Service | http://127.0.0.1:8000 | RAG, Search, Ingest, Agents |
| AI Docs | http://127.0.0.1:8000/docs | FastAPI Swagger UI |

---

## API Reference

### Node Backend (Auth + Data)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | No | Register new user |
| POST | /api/auth/login | No | Login, returns JWT |
| GET | /api/auth/me | JWT | Get current user |
| PATCH | /api/auth/update-profile | JWT | Update profile |
| PATCH | /api/auth/change-password | JWT | Change password |
| GET | /api/workspace/me | JWT | Get/create default workspace |
| GET | /api/workspace/:id | JWT | Get workspace by ID |
| POST | /api/conversations | JWT | Create conversation |
| GET | /api/conversations | JWT | List conversations |
| GET | /api/conversations/:id | JWT | Get one conversation |
| DELETE | /api/conversations/:id | JWT | Delete conversation |
| POST | /api/conversations/:id/messages | JWT | Save message |
| GET | /api/conversations/:id/messages | JWT | Get messages |
| GET | /api/health | No | Backend health |

### AI Service (RAG + Knowledge)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/v1/health | No | AI service health + Qdrant status |
| POST | /api/v1/ingest | JWT | Upload and index document |
| GET | /api/v1/ingest/list | JWT | List user's indexed documents |
| DELETE | /api/v1/ingest/{filename} | JWT | Delete document from index |
| POST | /api/v1/chat | JWT | RAG Q&A |
| GET | /api/v1/chat/stream | ?token= | Streaming SSE chat |
| GET | /api/v1/search | JWT | Semantic knowledge search |
| GET | /api/v1/agents | JWT | List available agents |
| POST | /api/v1/agents/execute | JWT | Execute an agent |

---

## How to Run Tests

```bash
cd Ai-Service

# Install test dependencies (first time)
pip install pytest httpx

# Run Phase 1 regression tests (auth-focused, no services needed)
pytest tests/test_phase1_regression.py -v

# Run full Phase 1 integration tests (all services must be running)
pytest tests/test_phase1_complete.py -v

# Run all tests
pytest tests/ -v
```

> Integration tests require all three services to be running and a valid `Ai-Service/.env`.

---

## Phase 1 Features (COMPLETE ✅)

> **Test results: 51/51 passing** — run `pytest tests/test_phase1_complete.py -v` to verify.

### Authentication & Users
- [x] User registration and login
- [x] JWT authentication (shared secret between Node backend + AI service)
- [x] Protected routes — unauthenticated requests rejected with 401
- [x] User profile and password change
- [x] Role-based access control (admin / member / viewer)

### Workspaces
- [x] Default workspace auto-created on first login
- [x] Workspace IDOR protection

### Document Management
- [x] Document upload (PDF, TXT, MD, RST — max 10 MB)
- [x] Text extraction and chunking
- [x] Vector embeddings (all-MiniLM-L6-v2, 384-dim)
- [x] Qdrant persistence (embedded local mode — data survives restarts)
- [x] Document metadata saved to MongoDB (filename, file_size, chunk_count, status)
- [x] Per-user + per-workspace isolation (no cross-user data access)
- [x] Deduplication on re-upload

### AI Chat & Search
- [x] Semantic knowledge search with per-user filtering
- [x] RAG chat with grounded citations
- [x] SSE streaming chat
- [x] Conversation history persists across page refreshes
- [x] Chat history sidebar (last 20 conversations)
- [x] New Chat button creates fresh MongoDB conversation

### Agents
- [x] Knowledge, Engineering, and Task agents
- [x] GitHub integration (mock fallback if no token)

### Security
- [x] IDOR protection on all endpoints
- [x] Error handling — no stack traces exposed
- [x] Expired/invalid JWT rejected by AI service
- [x] user_id + workspace_id in every Qdrant vector payload

---


## Level 2 Features (COMPLETE & VERIFIED ✅)

> **Test results: 104/104 passing tests across all test suites:**
> - `pytest tests/test_phase1_complete.py -v` → **51/51 PASSED (100%)**
> - `pytest tests/test_phase_b_tasks.py -v` → **23/23 PASSED (100%)**
> - `pytest tests/test_phase_c_d_e_retrieval.py -v` → **13/13 PASSED (100%)**
> - `pytest tests/test_phase_f_g_langgraph.py -v` → **17/17 PASSED (100%)**
> - `npm test` (backend) → **12/12 PASSED (100%)**

### Retrieval Intelligence (Phases C, D, E)
- [x] **BM25 Keyword Search**: Persistent token indexing via `rank-bm25` (BM25Plus), per-workspace disk storage in `./bm25_storage`, automatic vector store synchronization on ingestion/deletion, and Qdrant recovery.
- [x] **Hybrid Search + Reciprocal Rank Fusion**: RRF scoring ($\sum \frac{1}{k + rank}$), cross-algorithm deduplication, score provenance tracking, and mode switching (`hybrid`, `semantic`, `bm25`).
- [x] **Neural Cross-Encoder Reranking**: Re-scores top retrieved candidates using `sentence-transformers` `CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')` with lazy singleton loading, latency metrics, and safe fallback.

### LangGraph Agent Engine & Observability (Phases F, G)
- [x] **StateGraph Architecture**: Dynamic cyclic agent loop (`agent_reason` ⇄ `execute_tool` → `finalize`) with LLM tool selection.
- [x] **Tool Suite**: `search_knowledge`, `summarize_document`, `create_task`, `list_github_repos`, `get_github_issues`, `get_github_pulls`.
- [x] **Security & Bounded Loop**: Strict backend authorization (viewers forbidden from write tools), bounded iteration limit (`MAX_TOOL_ITERATIONS = 5`) to prevent infinite looping.
- [x] **Observability**: Rich response schema returning `steps`, `tool_calls` (name, args, output summary), `citations`, and `confidence`. Integrated into frontend log inspection.

### Task Management & Action Persistence (Phase B)
- [x] **MongoDB Task Model**: Indexed by `workspace_id`, `created_by`, `status`, and `priority`.
- [x] **Task CRUD API & RBAC**: Strict role enforcement (Admin: full workspace access; Member: workspace tasks; Viewer: read-only).
- [x] **Agent Tool Integration**: `create_task` tool creates persistent MongoDB action items returning valid 24-character ObjectIDs.
- [x] **Task UI**: Full interactive task management page (`/tasks`) with filters, status toggles, deletion, and priority badges.

### Security & Hardening (Phase A & H)
- [x] **Rate Limiting**: `express-rate-limit` protecting `/api/auth/login`, `/api/auth/register`, `/api/documents/upload`, and `/api/github`.
- [x] **Security Headers**: Express `helmet` integration enforcing CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and HSTS.
- [x] **Fail-Fast Configuration**: Validates `JWT_SECRET` presence and length (min 32 characters) on boot.
- [x] **Multi-Turn Context**: Both POST `/chat` and GET `/chat/stream` inject prior conversation history into RAG context.
- [x] **Real Activity Panel**: Live workspace event feed aggregated from MongoDB documents, tasks, and conversations.
