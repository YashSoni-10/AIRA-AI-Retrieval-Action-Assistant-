# AIRA — Backend Implementation Plan
**Date:** 2026-09-09

---

## LEVEL 1 BACKEND WORK

---

### TASK B1-001 — JWT_SECRET Validation at Startup
| Field | Detail |
|-------|--------|
| Priority | P0 |
| Feature | Fail-fast if JWT_SECRET not configured |
| File to Modify | `backend/server.js` |
| Implementation | Add early check: `if (!process.env.JWT_SECRET) { console.error("FATAL: JWT_SECRET not set"); process.exit(1); }` |
| Acceptance Criteria | Server refuses to start without JWT_SECRET |
| Test | Start backend without JWT_SECRET → exits with error |

### TASK B1-002 — FastAPI JWT Authentication Middleware
| Field | Detail |
|-------|--------|
| Priority | P0 |
| Feature | Protect all AI service endpoints with JWT |
| File to Create | `Ai-Service/app/core/auth.py` |
| Implementation | FastAPI `HTTPBearer` dependency; verify token using shared JWT_SECRET (same secret as Node backend) |
| File to Modify | All endpoint files in `Ai-Service/app/api/v1/endpoints/` |
| API Impact | All `/ingest`, `/chat`, `/search`, `/agents` endpoints require `Authorization: Bearer <token>` |
| Database | None — only JWT verification |
| AI Service Interaction | `settings.JWT_SECRET` env var needed in FastAPI config |
| Expected Behavior | 401 on missing/invalid/expired token; `req.user_id` available in endpoint |
| Dependencies | Add `JWT_SECRET` to `Ai-Service/.env` and `Ai-Service/app/core/config.py` |
| Acceptance Criteria | Curl without token → 401; valid token → 200 |
| Test | Unit test with valid/expired/missing tokens |

### TASK B1-003 — MongoDB Document Model
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | Persistent document metadata |
| File to Create | `backend/src/models/Document.js` |
| Schema | `{ userId, filename, originalName, fileSize, fileType, chunkCount, vectorCount, status, uploadedAt }` |
| File to Create | `backend/src/routes/documents.js` |
| File to Create | `backend/src/controllers/documentController.js` |
| API | `GET /api/documents` (list user's docs), `DELETE /api/documents/:id` |
| Middleware | `protect` (JWT required) |
| AI Service Interaction | After `POST /api/v1/ingest` returns success, Node backend creates Document record |
| Expected Behavior | Users see their documents with metadata |
| Acceptance Criteria | Document created on upload, deleted with /api/documents/:id |

### TASK B1-004 — User-Scoped Document Isolation in AI Service
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | Filter vector search by user_id |
| File to Modify | `Ai-Service/app/services/vector_store.py` |
| Changes | Add `user_id: str` param to `add_documents()`, `similarity_search()`, `delete_documents()`, `list_documents()` |
| Changes | Store `user_id` in Qdrant point payload |
| Changes | Add Qdrant `Filter` on `user_id` to all search/list/delete operations |
| File to Modify | `Ai-Service/app/api/v1/endpoints/ingest.py`, `chat.py`, `search.py` |
| Changes | Extract `user_id` from verified JWT, pass to service functions |
| Acceptance Criteria | User A's documents invisible to User B's queries |

### TASK B1-005 — Duplicate Document Detection
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | Prevent duplicate vector creation on re-upload |
| File to Modify | `Ai-Service/app/api/v1/endpoints/ingest.py` |
| Implementation | Before ingestion, check `list_documents(user_id=user_id)` for filename match; if exists, call `delete_documents(filename, user_id)` first (replace mode) or return 409 (duplicate mode) |
| Recommended | Replace mode with warning in response |
| Acceptance Criteria | Re-uploading same file replaces old vectors, not duplicates |

### TASK B1-006 — Conversation Model + API
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | Persistent conversation and message history |
| File to Create | `backend/src/models/Conversation.js` |
| Schema | `{ userId, title, messages: [{role, content, citations, confidence, timestamp}], createdAt, updatedAt }` |
| File to Create | `backend/src/routes/conversations.js` |
| File to Create | `backend/src/controllers/conversationController.js` |
| API | `GET /api/conversations`, `POST /api/conversations`, `GET /api/conversations/:id`, `POST /api/conversations/:id/messages`, `DELETE /api/conversations/:id` |
| Middleware | `protect` |
| AI Service Interaction | Frontend calls Node backend to save conversation, then calls FastAPI to get AI response |
| Acceptance Criteria | Chat history persists across browser reloads |

### TASK B1-007 — Multi-turn Context in RAG
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | Include conversation history in RAG LLM call |
| File to Modify | `Ai-Service/app/api/v1/endpoints/chat.py`, `Ai-Service/app/services/rag_engine.py` |
| Changes | Add optional `history: list[{role, content}]` to `ChatRequest` schema |
| Changes | Prepend prior messages to LLM call as chat history |
| Expected Behavior | LLM can reference prior turns in conversation |
| Acceptance Criteria | "What did you say about X earlier?" resolved correctly |

### TASK B1-008 — LLM Error Handling
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | Graceful LLM failure handling |
| File to Modify | `Ai-Service/app/services/llm_service.py` |
| Implementation | Wrap `_call_groq()` and `_call_gemini()` in try/except; raise `HTTPException(503, "LLM unavailable")` |
| Acceptance Criteria | Groq/Gemini API failure returns 503, not 500 |

---

## LEVEL 2 BACKEND WORK

---

### TASK B2-001 — BM25 Keyword Search
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | BM25 sparse retrieval |
| File to Create | `Ai-Service/app/services/bm25_store.py` |
| Implementation | `rank_bm25.BM25Okapi` index; rebuild from vector store on startup; `keyword_search(query, top_k)` returns ranked chunks |
| Dependency | `pip install rank-bm25` |
| Persistence | BM25 index serialized to disk (pickle or JSON) |
| Acceptance Criteria | Keyword-heavy queries return relevant results even when cosine similarity is low |

### TASK B2-002 — Hybrid Search Fusion (RRF)
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | Reciprocal Rank Fusion of semantic + keyword results |
| File to Modify | `Ai-Service/app/services/vector_store.py` or new `Ai-Service/app/services/retrieval.py` |
| Implementation | `hybrid_search(query, top_k)` calls both `similarity_search()` and `keyword_search()`, applies RRF, returns merged top-K |
| File to Modify | `Ai-Service/app/services/rag_engine.py` — use `hybrid_search()` instead of `similarity_search()` |
| Acceptance Criteria | Chat endpoint uses hybrid retrieval; results demonstrably better for keyword queries |

### TASK B2-003 — Reranking
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | Cross-encoder reranking of retrieved chunks |
| File to Create | `Ai-Service/app/services/reranker.py` |
| Implementation | `sentence_transformers.CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")` singleton; `rerank(query, chunks, top_k)` |
| File to Modify | `Ai-Service/app/services/rag_engine.py` — apply reranker after hybrid search |
| Acceptance Criteria | Final top-K chunks reordered by cross-encoder score before LLM |

### TASK B2-004 — LangGraph Agent Workflow
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | Real LangGraph-based agent |
| File to Create | `Ai-Service/app/services/langgraph_agent.py` |
| Implementation | `langgraph.StateGraph` with State TypedDict; nodes: `planner`, `tool_executor`, `synthesizer`; edges with conditional routing; tool registry with all existing tools |
| Dependency | `pip install langgraph langchain-core langchain-groq` |
| File to Modify | `Ai-Service/app/api/v1/endpoints/agents.py` — call LangGraph instead of `execute_agent()` |
| Acceptance Criteria | Agent can call multiple tools in sequence based on LLM planning; iterative reasoning loop |

### TASK B2-005 — Knowledge Graph (networkx-based)
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | In-memory knowledge graph with entity extraction |
| File to Create | `Ai-Service/app/services/graph_service.py` |
| Implementation | `networkx.DiGraph`; entity extraction via LLM prompt during ingestion; nodes: Document, Person, Technology, Project; edges: MENTIONS, RELATES_TO, USES |
| File to Modify | `Ai-Service/app/api/v1/endpoints/ingest.py` — trigger entity extraction post-ingestion |
| File to Create | `Ai-Service/app/api/v1/endpoints/graph.py` — `GET /api/v1/graph` endpoint |
| Acceptance Criteria | After document upload, entities extracted and stored as graph; graph queryable by agent |

### TASK B2-006 — Task Persistence
| Field | Detail |
|-------|--------|
| Priority | P1 |
| Feature | Persist tasks created by Task Agent |
| File to Create | `backend/src/models/Task.js` |
| Schema | `{ userId, title, description, priority, status, agentCreated, createdAt }` |
| File to Create | `backend/src/routes/tasks.js` |
| Implementation | Task Agent calls `POST /api/tasks` on Node backend after creating task |
| Acceptance Criteria | Tasks visible in frontend after agent creates them |

---

## LEVEL 3 BACKEND WORK (ROADMAP)

### TASK B3-001 — Docker Containerization
- Dockerfiles for Node, FastAPI, frontend
- `docker-compose.yml` with MongoDB + Qdrant + services
- **Priority: P3**

### TASK B3-002 — GitHub Actions CI/CD
- Test workflow on PR
- Build + push Docker images
- **Priority: P3**

### TASK B3-003 — Rate Limiting
- `express-rate-limit` on Node backend `/api/auth/login`
- `slowapi` on FastAPI expensive endpoints
- **Priority: P3**

### TASK B3-004 — Redis + Celery Background Jobs
- Background document processing
- Async embedding generation
- **Priority: P3**

### TASK B3-005 — Prometheus Metrics + Grafana
- FastAPI metrics via `prometheus-fastapi-instrumentator`
- Grafana dashboard
- **Priority: P3**

### TASK B3-006 — Real Token Streaming from LLM
- Groq streaming API → AsyncGenerator → SSE
- **Priority: P3**

### TASK B3-007 — Refresh Tokens
- Refresh token endpoint in Node backend
- **Priority: P3**
