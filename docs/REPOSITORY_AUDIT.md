# AIRA — Complete Repository Audit
**Audited:** 2026-09-09 | **Auditor:** Lead Software Architect

---

## Repository Root: `AIRA-AI-Retrieval-Action-Assistant-/`

```
AIRA-AI-Retrieval-Action-Assistant-/
├── .git/                          (Git version control)
├── .gitignore                     (Git ignore rules)
├── AIRA_PROJECT_DOCUMENTATION.md  (Duplicate of README.md — same content)
├── LICENSE                        (MIT License)
├── README.md                      (Main project documentation)
├── start.bat                      (Windows batch start script)
├── Ai-Service/                    (Python FastAPI AI Backend)
├── backend/                       (Node.js Express Auth Backend)
└── frontend/                      (React 19 + Vite + TypeScript Frontend)
```

---

## 1. `Ai-Service/` — Python FastAPI AI Backend

**Technology:** Python 3.13, FastAPI, Uvicorn, Qdrant, Sentence-Transformers  
**Port:** 8000  
**Purpose:** Core AI engine — RAG pipeline, vector store, LLM integration, agents, GitHub integration  
**Status:** IMPLEMENTED (functional, unverified without running)

### Structure

```
Ai-Service/
├── .env                           ← ACTUAL secrets (not committed — good)
├── .env.example                   ← Template for env vars
├── requirements.txt               ← Python dependencies
├── venv/                          ← Python virtual environment (installed)
└── app/
    ├── __init__.py
    ├── main.py                    ← FastAPI app entry point
    ├── core/
    │   ├── __init__.py
    │   └── config.py              ← Centralized settings via dotenv
    ├── api/
    │   └── v1/
    │       ├── __init__.py
    │       ├── router.py          ← Mounts all endpoint routers
    │       └── endpoints/
    │           ├── __init__.py
    │           ├── health.py      ← GET /api/v1/health
    │           ├── ingest.py      ← POST/GET/DELETE /api/v1/ingest
    │           ├── chat.py        ← POST /api/v1/chat, GET /api/v1/chat/stream
    │           ├── search.py      ← GET /api/v1/search
    │           ├── agents.py      ← GET/POST /api/v1/agents
    │           └── github.py      ← GET /api/v1/github/*
    └── services/
        ├── __init__.py
        ├── llm_service.py         ← Groq + Gemini unified LLM client
        ├── document_processor.py  ← PDF/TXT/MD text extraction + chunking
        ├── embeddings_service.py  ← Sentence-transformer embeddings (all-MiniLM-L6-v2)
        ├── vector_store.py        ← Qdrant + in-memory fallback
        ├── rag_engine.py          ← Full RAG pipeline
        ├── agent_service.py       ← 3-agent system (Knowledge, Engineering, Task)
        └── github_service.py      ← GitHub API integration + mock fallback
```

### Dependencies (requirements.txt)
| Package | Version | Purpose |
|---------|---------|---------|
| fastapi | >=0.110.0 | Web framework |
| uvicorn[standard] | >=0.28.0 | ASGI server |
| pydantic | >=2.6.0 | Schema validation |
| python-multipart | >=0.0.9 | File upload support |
| qdrant-client | >=1.8.0 | Vector database client |
| sentence-transformers | >=2.6.0 | Embedding model |
| pypdf | >=4.1.0 | PDF extraction |
| httpx | >=0.27.0 | HTTP client for GitHub API |
| python-dotenv | >=1.0.1 | Environment loading |
| groq | >=0.5.0 | Groq LLM API |
| google-generativeai | >=0.5.0 | Gemini LLM API |
| numpy | >=1.24.0 | Vector math |
| scikit-learn | >=1.2.0 | Utilities |

> **NOTE:** `torch` is present in the venv (installed as a transitive dep of sentence-transformers). This is a large, unnecessary download — PyTorch is the ML backend for transformers.

### Missing Pieces (Ai-Service)
- No BM25 / keyword search implementation
- No hybrid search fusion
- No reranking model
- No LangGraph / actual agentic graph
- No knowledge graph (Neo4j or similar)
- No conversation history persistence (stateless)
- No auth on any endpoint (all endpoints are open)
- No streaming at the real LLM level (fake word-by-word streaming)
- No rate limiting
- No tests

---

## 2. `backend/` — Node.js Express Auth Backend

**Technology:** Node.js, Express 5, MongoDB (Mongoose), JWT, bcryptjs  
**Port:** 5000  
**Purpose:** Authentication only — register, login, profile management  
**Status:** IMPLEMENTED (auth flows complete, in-memory fallback present)

### Structure

```
backend/
├── .env.example                   ← Template
├── package.json                   ← Dependencies (no lock concerns)
├── package-lock.json
├── server.js                      ← Express app entry, MongoDB connect, routes
└── src/
    ├── controllers/
    │   └── authController.js      ← register, login, getMe, updateProfile, changePassword
    ├── middleware/
    │   └── auth.js                ← JWT protect + restrictTo middleware
    ├── models/
    │   └── User.js                ← Mongoose User schema + bcrypt hooks
    └── routes/
        └── auth.js                ← POST /register, POST /login, GET /me, PATCH /update-profile, PATCH /change-password
```

### Dependencies (package.json)
| Package | Version | Purpose |
|---------|---------|---------|
| express | ^5.2.1 | Web framework |
| mongoose | ^9.9.4 | MongoDB ODM |
| jsonwebtoken | ^9.0.3 | JWT signing/verification |
| bcryptjs | ^3.0.3 | Password hashing |
| cors | ^2.8.6 | Cross-origin requests |
| dotenv | ^17.4.2 | Environment loading |

### Missing Pieces (backend)
- Only ONE route file (`auth.js`) — no document routes, no workspace routes, no search proxying
- No workspace model or document model
- No role-based route guards beyond `protect` + `restrictTo`
- No rate limiting on auth endpoints
- No input sanitization/validation library
- No logging middleware
- The backend is **not connected** to the AI service in any way
- Dashboard stats on frontend are all hardcoded (128 docs, 24 convos, etc.) — not queried from backend

---

## 3. `frontend/` — React 19 + TypeScript + Tailwind CSS + Vite

**Technology:** React 19, TypeScript 6, Vite 8, React Router DOM 7, Tailwind CSS 4  
**Port:** 5173 (dev)  
**Purpose:** Full UI — dashboard, chat, documents, agents, projects, knowledge, settings  
**Status:** IMPLEMENTED (UI complete, most pages connected to AI service)

### Structure

```
frontend/
├── index.html
├── vite.config.ts
├── tsconfig*.json
├── package.json
├── eslint.config.js
├── public/
│   ├── favicon.svg
│   └── icons.svg
└── src/
    ├── main.tsx                   ← React DOM entry point (BrowserRouter + ThemeProvider)
    ├── App.tsx                    ← Auth gate + routing
    ├── App.css                    ← Global styles
    ├── index.css                  ← Tailwind base
    ├── context/
    │   └── ThemeContext.tsx       ← Dark/light mode context
    ├── components/
    │   ├── Sidebar.tsx            ← Navigation sidebar
    │   ├── Header.tsx             ← Top header
    │   ├── SearchBox.tsx          ← Search widget (NOT connected to API)
    │   ├── StatsCard.tsx          ← Dashboard metric cards (hardcoded values)
    │   ├── ActivityPanel.tsx      ← Recent activity (hardcoded data)
    │   └── AIAssistant.tsx        ← Floating AI widget (NOT connected to API)
    ├── pages/
    │   ├── LoginPage.tsx          ← Auth (LIVE — calls Node backend)
    │   ├── ChatPage.tsx           ← AI Chat (LIVE — calls FastAPI)
    │   ├── DocumentsPage.tsx      ← Document mgmt (LIVE — calls FastAPI)
    │   ├── KnowledgePage.tsx      ← Knowledge explorer (PARTIALLY connected)
    │   ├── AgentsPage.tsx         ← Agents UI (LIVE — calls FastAPI)
    │   ├── ProjectsPage.tsx       ← Projects/GitHub (LIVE — calls FastAPI GitHub endpoints)
    │   ├── SettingsPage.tsx       ← Settings (PARTIALLY connected — profile update calls Node backend)
    │   ├── HelpPage.tsx           ← Static help/FAQ
    │   └── NotFoundPage.tsx       ← 404 page
    └── services/
        ├── api.ts                 ← Typed client for FastAPI (port 8000)
        └── auth.ts                ← Typed client for Node auth backend (port 5000)
```

### Missing Pieces (frontend)
- Dashboard stats (128 docs, 24 conversations, 12 tasks, 94% AI activity) are **hardcoded**
- SearchBox component is NOT wired to the search API
- AIAssistant floating widget is NOT wired to any API
- ActivityPanel shows hardcoded activity items
- KnowledgePage search may not call the real API
- No conversation history persistence
- No workspace management UI
- No user avatar upload
- No test files

---

## 4. Supporting Files

| File | Purpose | Status |
|------|---------|--------|
| `start.bat` | Windows batch to start all 3 services | EXISTS — unverified |
| `README.md` | Complete project documentation | EXISTS — accurate |
| `AIRA_PROJECT_DOCUMENTATION.md` | Duplicate of README | DUPLICATE — can delete |
| `.gitignore` | Ignore patterns | EXISTS |
| `LICENSE` | MIT License | EXISTS |

### No Tests Found
- Zero unit test files
- Zero integration test files
- Zero API test files
- Zero E2E test files

### No DevOps Found
- No Dockerfile
- No docker-compose.yml
- No GitHub Actions (.github/)
- No CI/CD pipeline
- No Prometheus / Grafana config
- No Nginx config
