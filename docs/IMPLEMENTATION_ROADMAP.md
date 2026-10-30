# AIRA — Implementation Roadmap
**Date:** 2026-09-09

---

```
P0 — BLOCKING FIXES (Do First)
  ├── B1-001: JWT_SECRET validation at startup (Node backend)
  └── B1-002: JWT auth middleware on FastAPI AI service
         ↓
LEVEL 1 — FOUNDATION COMPLETION
  ├── B1-003: MongoDB Document model + CRUD API
  ├── B1-004: User-scoped vector isolation (user_id in Qdrant)
  ├── B1-005: Duplicate document detection
  ├── B1-006: Conversation model + history API
  ├── B1-007: Multi-turn context in RAG LLM call
  └── B1-008: LLM error handling
         ↓
P2 — FRONTEND INTEGRATION CLEANUP
  ├── Wire SearchBox to /api/v1/search
  ├── Wire AIAssistant widget to /api/v1/chat
  ├── Wire dashboard stats to real API data
  ├── Add conversation history UI in ChatPage
  └── Add mock data indicator in ProjectsPage
         ↓
LEVEL 1 E2E VERIFICATION
  ├── Upload document → verify in DB + Qdrant
  ├── Chat query → verify RAG response + citations
  ├── Chat history → verify persistence across reloads
  ├── Auth flows → register/login/logout
  └── User isolation → verify User A cannot see User B's docs
         ↓
LEVEL 2 — RETRIEVAL ENHANCEMENT
  ├── B2-001: BM25 keyword search store
  ├── B2-002: Hybrid search fusion (RRF)
  └── B2-003: Cross-encoder reranking
         ↓
LEVEL 2 — AGENTS & GRAPH
  ├── B2-005: Knowledge graph (networkx + entity extraction)
  ├── B2-004: LangGraph agent workflow
  ├── B2-006: Task persistence (MongoDB)
  └── Agent tools: search_graph tool + create_task via API
         ↓
LEVEL 2 — GITHUB INTEGRATION HARDENING
  ├── Pagination for repos/issues/PRs
  ├── Rate limit handling
  └── Mock data indicator in UI
         ↓
LEVEL 2 E2E VERIFICATION
  ├── Hybrid search demonstrably better than semantic-only
  ├── Reranking changes top-K order
  ├── LangGraph agent with iterative tool calls
  ├── Knowledge graph queryable
  ├── GitHub integration with real token
  └── Task created by agent → persisted in MongoDB
         ↓
SECURITY HARDENING (P2)
  ├── Rate limiting on auth + AI endpoints
  ├── Input validation middleware
  ├── Helmet.js on Node backend
  └── Prompt injection defenses
         ↓
LEVEL 3 — ROADMAP (FUTURE)
  ├── Docker + docker-compose
  ├── GitHub Actions CI/CD
  ├── Real LLM token streaming
  ├── Redis + Celery background jobs
  ├── Prometheus + Grafana monitoring
  ├── Refresh token mechanism
  ├── Jira/Slack integration
  ├── RAGAS-based AI evaluation
  └── PII detection and redaction
```

---

## Estimated Effort by Phase

| Phase | Tasks | Estimated Effort | Outcome |
|-------|-------|-----------------|---------|
| P0 Fixes | 2 | 2-4 hours | System is secure |
| Level 1 Completion | 6 | 2-3 days | Full Level 1 working |
| P2 Frontend | 5 | 1 day | All UI connected |
| Level 1 E2E | Testing | 0.5 day | Level 1 verified |
| Level 2 Retrieval | 3 | 1-2 days | Hybrid search + reranking |
| Level 2 Agents | 3 | 2-3 days | Real LangGraph + knowledge graph |
| Level 2 E2E | Testing | 0.5 day | Level 2 verified |
| Security P2 | 4 | 1 day | Hardened |
| Level 3 Roadmap | 9 | — | Future |

**Total for Level 1+2:** ~8-12 developer-days

---

## Files That Need Modification

| File | Change |
|------|--------|
| `backend/server.js` | JWT_SECRET validation |
| `backend/src/controllers/authController.js` | Minor validation improvements |
| `Ai-Service/app/core/config.py` | Add JWT_SECRET, hybrid search config |
| `Ai-Service/app/services/vector_store.py` | Add user_id param, hybrid search, BM25 integration |
| `Ai-Service/app/services/rag_engine.py` | Multi-turn context, hybrid retrieval, reranking |
| `Ai-Service/app/services/agent_service.py` | Migrate to LangGraph |
| `Ai-Service/app/services/llm_service.py` | Error handling, streaming |
| `Ai-Service/app/api/v1/endpoints/ingest.py` | Auth, user_id, dedup |
| `Ai-Service/app/api/v1/endpoints/chat.py` | Auth, user_id, conversation history |
| `Ai-Service/app/api/v1/endpoints/search.py` | Auth, user_id |
| `Ai-Service/app/api/v1/endpoints/agents.py` | Auth, LangGraph |
| `Ai-Service/app/api/v1/router.py` | Add graph endpoint |
| `frontend/src/App.tsx` | Live dashboard stats |
| `frontend/src/components/SearchBox.tsx` | Wire to search API |
| `frontend/src/components/AIAssistant.tsx` | Wire to chat API |
| `frontend/src/components/ActivityPanel.tsx` | Live activity data |
| `frontend/src/pages/ChatPage.tsx` | Conversation persistence, multi-turn |
| `frontend/src/pages/ProjectsPage.tsx` | Mock data indicator |

## Files That Need Creation

| File | Purpose |
|------|---------|
| `Ai-Service/app/core/auth.py` | FastAPI JWT middleware |
| `Ai-Service/app/services/bm25_store.py` | BM25 keyword search |
| `Ai-Service/app/services/reranker.py` | Cross-encoder reranking |
| `Ai-Service/app/services/graph_service.py` | Knowledge graph |
| `Ai-Service/app/services/langgraph_agent.py` | LangGraph agent |
| `Ai-Service/app/api/v1/endpoints/graph.py` | Graph API endpoint |
| `backend/src/models/Document.js` | Document metadata model |
| `backend/src/models/Conversation.js` | Conversation model |
| `backend/src/models/Task.js` | Task model |
| `backend/src/routes/documents.js` | Document routes |
| `backend/src/routes/conversations.js` | Conversation routes |
| `backend/src/routes/tasks.js` | Task routes |
| `backend/src/controllers/documentController.js` | Document controller |
| `backend/src/controllers/conversationController.js` | Conversation controller |
| `backend/src/controllers/taskController.js` | Task controller |
| `requirements.txt` additions | `rank-bm25`, `langgraph`, `langchain-core`, `langchain-groq`, `networkx` |
| `docs/TEST_PLAN.md` | Test plan |
| `docs/DEFINITION_OF_DONE.md` | Definition of done |
