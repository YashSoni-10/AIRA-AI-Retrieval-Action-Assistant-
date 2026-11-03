# AIRA — Complete Gap Analysis
**Date:** 2026-09-09

---

## Priority Legend
- **P0:** Blocking — system is broken without this
- **P1:** Required for Level 1/2 completion
- **P2:** Quality improvement — makes system more correct
- **P3:** Level 3 roadmap — production hardening

---

## P0 — Blocking Issues

### GAP-001: No Auth on AI Service
| Field | Detail |
|-------|--------|
| Feature | AI Service Authentication |
| Current State | All 12 FastAPI endpoints are publicly accessible |
| Expected State | JWT token from Node backend verified on all sensitive AI endpoints |
| Gap | Complete absence of auth middleware in FastAPI |
| Why Required | Without auth, anyone can upload docs, delete docs, exhaust LLM quotas |
| Files to Modify | All `Ai-Service/app/api/v1/endpoints/*.py` |
| Files to Create | `Ai-Service/app/core/auth.py` (JWT verification dependency) |
| Complexity | Medium |
| Priority | **P0** |
| Acceptance Criteria | Requests without valid JWT to /ingest, /chat, /agents receive 401 |

### GAP-002: JWT_SECRET Not Validated at Startup
| Field | Detail |
|-------|--------|
| Feature | JWT_SECRET presence validation |
| Current State | `jwt.sign()`/`jwt.verify()` receive `undefined` if not set → throws |
| Expected State | Backend refuses to start if JWT_SECRET is missing |
| Files to Modify | `backend/server.js` |
| Complexity | Low |
| Priority | **P0** |
| Acceptance Criteria | Node backend logs error and exits if JWT_SECRET not set |

---

## P1 — Required for Level 1 Completion

### GAP-003: No Conversation History Persistence
| Field | Detail |
|-------|--------|
| Feature | Conversation history |
| Current State | Messages exist only in browser state — lost on refresh; each query is stateless |
| Expected State | Conversations stored in MongoDB; prior messages sent as context to LLM |
| Gap | No Conversation/Message model; no API endpoints; no multi-turn context in RAG |
| Files to Modify | `Ai-Service/app/services/rag_engine.py`, `Ai-Service/app/api/v1/endpoints/chat.py` |
| Files to Create | `backend/src/models/Conversation.js`, `backend/src/routes/conversations.js`, `backend/src/controllers/conversationController.js` |
| Dependencies | GAP-001 (auth required for conversation ownership) |
| Complexity | High |
| Priority | **P1** |
| Acceptance Criteria | Chat history persists across page reloads; prior turns included in LLM context |

### GAP-004: No Per-User Document Isolation
| Field | Detail |
|-------|--------|
| Feature | User/workspace-scoped vector retrieval |
| Current State | All documents in single `aira_knowledge` Qdrant collection; no `user_id` filtering |
| Expected State | Each user's documents retrieved separately; `user_id` stored in vector payload |
| Gap | No `user_id` in Qdrant payload; no filter in `similarity_search()` |
| Files to Modify | `Ai-Service/app/services/vector_store.py`, `Ai-Service/app/services/rag_engine.py`, `Ai-Service/app/api/v1/endpoints/ingest.py` |
| Complexity | Medium |
| Priority | **P1** |
| Acceptance Criteria | User A's documents not retrievable in User B's queries |

### GAP-005: Duplicate Document Ingestion
| Field | Detail |
|-------|--------|
| Feature | Deduplication on re-upload |
| Current State | Re-uploading same file creates duplicate vectors |
| Expected State | System detects existing filename, warns user or replaces chunks |
| Files to Modify | `Ai-Service/app/api/v1/endpoints/ingest.py`, `Ai-Service/app/services/vector_store.py` |
| Complexity | Low |
| Priority | **P1** |
| Acceptance Criteria | Uploading same filename returns warning or auto-replaces existing vectors |

### GAP-006: No Document Metadata Model
| Field | Detail |
|-------|--------|
| Feature | MongoDB Document model |
| Current State | Only filename stored in Qdrant payload; no upload date, size, owner, status |
| Expected State | MongoDB collection with per-document metadata |
| Files to Create | `backend/src/models/Document.js`, routes and controllers |
| Complexity | Medium |
| Priority | **P1** |
| Acceptance Criteria | Document list shows filename, upload date, size, status, chunk count |

---

## P1 — Required for Level 2 Completion

### GAP-007: No Hybrid Search (BM25)
| Field | Detail |
|-------|--------|
| Feature | BM25 keyword retrieval |
| Current State | Pure vector similarity only |
| Expected State | BM25 + semantic → RRF fusion → top-K results |
| Files to Modify | `Ai-Service/app/services/vector_store.py`, `Ai-Service/app/services/rag_engine.py` |
| Files to Create | `Ai-Service/app/services/bm25_store.py` |
| Dependencies | `rank_bm25` Python package |
| Complexity | Medium |
| Priority | **P1** |
| Acceptance Criteria | `/chat` returns results from both semantic and keyword search, fused with RRF |

### GAP-008: No Reranking
| Field | Detail |
|-------|--------|
| Feature | Cross-encoder reranking |
| Current State | Results ordered by vector similarity score only |
| Expected State | Retrieved chunks reranked by cross-encoder before context construction |
| Files to Modify | `Ai-Service/app/services/rag_engine.py` |
| Files to Create | `Ai-Service/app/services/reranker.py` |
| Dependencies | `sentence-transformers` (cross-encoder model: `cross-encoder/ms-marco-MiniLM-L-6-v2`) |
| Complexity | Medium |
| Priority | **P1** |
| Acceptance Criteria | Top-K chunks reranked before being passed to LLM |

### GAP-009: No LangGraph Integration
| Field | Detail |
|-------|--------|
| Feature | LangGraph agentic workflow |
| Current State | Scripted sequential function calls in `agent_service.py` |
| Expected State | LangGraph state graph with nodes, edges, conditional routing, tool-calling loop |
| Files to Modify | `Ai-Service/app/services/agent_service.py` |
| Files to Create | `Ai-Service/app/services/langgraph_agent.py` |
| Dependencies | `langgraph`, `langchain-core` Python packages |
| Complexity | High |
| Priority | **P1** |
| Acceptance Criteria | Agent uses LangGraph StateGraph with dynamic tool selection and iterative reasoning |

### GAP-010: No Knowledge Graph
| Field | Detail |
|-------|--------|
| Feature | Knowledge graph (entities + relationships) |
| Current State | Not implemented |
| Expected State | Graph of entities extracted from documents, queryable for RAG context |
| Files to Create | `Ai-Service/app/services/graph_service.py`, storage (networkx or Neo4j) |
| Dependencies | `networkx` (simplest) or `neo4j` driver |
| Complexity | High |
| Priority | **P1** |
| Acceptance Criteria | Entities extracted from uploaded docs; graph queryable by agent |

### GAP-011: LLM-Driven Tool Selection
| Field | Detail |
|-------|--------|
| Feature | Dynamic tool selection by LLM |
| Current State | Tools triggered by keyword matching in query string |
| Expected State | LLM uses function-calling API to select appropriate tools |
| Files to Modify | `Ai-Service/app/services/agent_service.py` (or `langgraph_agent.py`) |
| Complexity | High |
| Priority | **P1** |
| Acceptance Criteria | Agent selects tools based on LLM reasoning, not hardcoded if/elif |

### GAP-012: Task Persistence
| Field | Detail |
|-------|--------|
| Feature | Persisted tasks from Task Agent |
| Current State | `tool_create_task()` returns a dict with a UUID — never saved |
| Expected State | Tasks saved to MongoDB, retrievable via API |
| Files to Create | `backend/src/models/Task.js`, routes, controllers |
| Files to Modify | `Ai-Service/app/services/agent_service.py` (call backend API or direct DB) |
| Complexity | Medium |
| Priority | **P1** |
| Acceptance Criteria | Tasks created by agent appear in DB and are queryable |

---

## P1 — LLM Error Handling

### GAP-013: No LLM Error Handling
| Field | Detail |
|-------|--------|
| Feature | LLM call error handling |
| Current State | `llm_service.get_llm_response()` has no try/except — Groq/Gemini failures → 500 |
| Expected State | Graceful error with user-friendly message |
| Files to Modify | `Ai-Service/app/services/llm_service.py` |
| Complexity | Low |
| Priority | **P1** |
| Acceptance Criteria | LLM errors return 503 with informative message, not unhandled 500 |

---

## P2 — Quality Improvements

### GAP-014: Dashboard Stats Hardcoded
| Field | Detail |
|-------|--------|
| Feature | Live dashboard metrics |
| Current State | "128", "24", "12", "94%" all hardcoded in `App.tsx` |
| Expected State | Real data from APIs |
| Files to Modify | `frontend/src/App.tsx` (Dashboard component) |
| Complexity | Low |
| Priority | **P2** |
| Acceptance Criteria | Dashboard shows real document count, conversation count |

### GAP-015: SearchBox Not Connected
| Field | Detail |
|-------|--------|
| Feature | Dashboard global search |
| Current State | `SearchBox.tsx` is decorative — no API call |
| Expected State | Calls `/api/v1/search` and shows results |
| Files to Modify | `frontend/src/components/SearchBox.tsx` |
| Complexity | Low |
| Priority | **P2** |

### GAP-016: AIAssistant Widget Not Connected
| Field | Detail |
|-------|--------|
| Feature | Dashboard floating AI assistant |
| Current State | Widget exists but doesn't call any API |
| Expected State | Calls `/api/v1/chat` or navigates to ChatPage |
| Files to Modify | `frontend/src/components/AIAssistant.tsx` |
| Complexity | Low |
| Priority | **P2** |

### GAP-017: ActivityPanel Shows Hardcoded Data
| Field | Detail |
|-------|--------|
| Feature | Recent activity feed |
| Current State | Static hardcoded activity items |
| Expected State | Real activity from document uploads, agent executions, chat history |
| Files to Modify | `frontend/src/components/ActivityPanel.tsx` |
| Complexity | Medium |
| Priority | **P2** |

### GAP-018: No Rate Limiting
| Field | Detail |
|-------|--------|
| Feature | Rate limiting on auth and AI endpoints |
| Current State | No rate limiting anywhere |
| Files to Modify | `backend/server.js` (express-rate-limit), `Ai-Service/app/main.py` (slowapi) |
| Complexity | Low |
| Priority | **P2** |

### GAP-019: SSE Streaming is Simulated
| Field | Detail |
|-------|--------|
| Feature | Real token streaming from LLM |
| Current State | Full response obtained, then emitted word-by-word |
| Expected State | Real token-by-token streaming from Groq/Gemini streaming API |
| Files to Modify | `Ai-Service/app/api/v1/endpoints/chat.py`, `Ai-Service/app/services/llm_service.py` |
| Complexity | Medium |
| Priority | **P2** |

### GAP-020: Qdrant Delete Count Inaccurate
| Field | Detail |
|-------|--------|
| Feature | Accurate chunk count on deletion |
| Current State | `delete_documents()` returns `1` from Qdrant path regardless of actual count |
| Files to Modify | `Ai-Service/app/services/vector_store.py` |
| Complexity | Low |
| Priority | **P2** |

### GAP-021: Mock GitHub Data Not Indicated in UI
| Field | Detail |
|-------|--------|
| Feature | Mock data indicator in frontend |
| Current State | No UI indication when mock GitHub data is displayed |
| Files to Modify | `frontend/src/pages/ProjectsPage.tsx` |
| Complexity | Low |
| Priority | **P2** |

### GAP-022: No Input Validation
| Field | Detail |
|-------|--------|
| Feature | Input sanitization/validation |
| Current State | Only basic presence checks; no format validation |
| Files to Modify | `backend/src/controllers/authController.js`, Node backend routes |
| Complexity | Low |
| Priority | **P2** |

---

## P3 — Level 3 Roadmap

### GAP-023: No Docker Containerization
- No Dockerfile, no docker-compose.yml
- **P3**

### GAP-024: No CI/CD Pipeline
- No GitHub Actions, no automated testing pipeline
- **P3**

### GAP-025: No Monitoring (Prometheus/Grafana)
- No metrics endpoints, no monitoring dashboards
- **P3**

### GAP-026: No Redis/Celery Background Jobs
- No async task queue
- **P3**

### GAP-027: No Refresh Token Mechanism
- JWT expires after 7 days with no refresh
- **P3**

### GAP-028: No Jira/Slack Integration
- Not implemented
- **P3**

### GAP-029: No AI Faithfulness Evaluation
- No automated RAG evaluation (RAGAS or similar)
- **P3**

### GAP-030: No PII Protection
- Documents may contain personal data; no PII detection or redaction
- **P3**

### GAP-031: No Helmet.js (HTTP Security Headers)
- **P3**

---

## Summary Table

| Priority | Count | Features |
|----------|-------|---------|
| P0 | 2 | AI service auth, JWT_SECRET validation |
| P1 | 11 | Conversation history, user isolation, dedup, document model, hybrid search, reranking, LangGraph, knowledge graph, tool selection, task persistence, LLM error handling |
| P2 | 9 | Dashboard stats, SearchBox, AIAssistant, ActivityPanel, rate limiting, real streaming, delete count, mock indicator, input validation |
| P3 | 9 | Docker, CI/CD, monitoring, background jobs, refresh tokens, Jira/Slack, AI eval, PII, Helmet |
