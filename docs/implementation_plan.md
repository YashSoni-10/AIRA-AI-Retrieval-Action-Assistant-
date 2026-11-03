# AIRA Phase 2 — Discovery Report
**Date:** 2026-09-14 | Based strictly on repository evidence

---

## Evidence Sources Inspected

| File | Key Finding |
|---|---|
| `AIRA_PROJECT_DOCUMENTATION.md` | Full architecture, API reference, session log defining Phases 1–7 |
| `docs/IMPLEMENTATION_ROADMAP.md` | Explicit Level 1 → Level 2 → Level 3 progression with task codes |
| `docs/DEFINITION_OF_DONE.md` | Explicit checklist for Level 1 AND Level 2 acceptance criteria |
| `docs/LEVEL_2_TRACEABILITY.md` | Level 2 completion = ~2/9 items done |
| `docs/GAP_ANALYSIS.md` | 31 numbered gaps with P0/P1/P2/P3 priority and acceptance criteria |
| `docs/HYBRID_SEARCH_AUDIT.md` | Hybrid search = 0% implemented, plan included |
| `docs/KNOWLEDGE_GRAPH_AUDIT.md` | Knowledge graph = 0% implemented, path documented |
| `docs/AGENT_AUDIT.md` | Agents are scripted (keyword triggers), not LangGraph |
| `docs/RAG_AUDIT.md` | Multi-turn context missing; `llm_service.py` has no try/except |
| `Ai-Service/app/services/llm_service.py` | No error handling — Groq/Gemini failures → unhandled 500 |
| `Ai-Service/app/services/agent_service.py` | `tool_create_task()` is simulated — no persistence |
| `Ai-Service/requirements.txt` | No `rank-bm25`, `langgraph`, `networkx` installed |
| `frontend/src/App.tsx` | Dashboard stats hardcoded: "128", "94%" etc. |
| `frontend/src/components/AIAssistant.tsx` | Not wired to any API |
| `frontend/src/components/SearchBox.tsx` | Not wired to any API |
| `frontend/src/components/ActivityPanel.tsx` | Hardcoded activity feed |
| `frontend/src/pages/ProjectsPage.tsx` | Wired to GitHub API — mock fallback when no token |
| `backend/server.js` | No Task route. `/api/documents` and `/api/conversations` present |
| `backend/src/models/` | No Task model exists |

---

## A. What is the original purpose of AIRA?

**"AI Research & Intelligence Assistant"** — an enterprise knowledge management platform that:
- Ingests documents (PDF, TXT, MD) → vector search → RAG answers with citations
- Provides specialized AI Agents (Knowledge, Engineering, Task) over the knowledge base
- Integrates with GitHub for engineering workflows
- Persists conversations, documents, and workspaces in MongoDB

The project is explicitly structured as a **multi-phase B.Tech/placement portfolio project** with defined Level 1 (foundation) and Level 2 (intelligence) milestones.

---

## B. Features explicitly promised in documentation

From `DEFINITION_OF_DONE.md` Level 2 and `IMPLEMENTATION_ROADMAP.md`:

| Feature | Source Document |
|---|---|
| BM25 keyword search | DoD L2, Roadmap B2-001, GAP-007 |
| Hybrid search (RRF fusion) | DoD L2, Roadmap B2-002, GAP-007 |
| Cross-encoder reranking | DoD L2, Roadmap B2-003, GAP-008 |
| LangGraph agent workflow | DoD L2, Roadmap B2-004, GAP-009 |
| Knowledge graph (networkx) | DoD L2, Roadmap B2-005, GAP-010 |
| Task persistence in MongoDB | DoD L2, Roadmap B2-006, GAP-012 |
| LLM-driven tool selection | DoD L2, GAP-011 |
| GitHub pagination + rate limiting | DoD L2, LEVEL_2_TRACEABILITY.md |
| Mock data indicator in ProjectsPage | DoD L2, GAP-021 |
| Dashboard stats wired to real APIs | DoD L1 (still unchecked), GAP-014 |
| SearchBox wired to /api/v1/search | DoD L1 (still unchecked), GAP-015 |
| AIAssistant widget wired to chat | DoD L1 (still unchecked), GAP-016 |
| Multi-turn conversation context in LLM | DoD L1, GAP-003 |
| Rate limiting | Roadmap Security P2, GAP-018 |
| Real LLM error handling | GAP-013 |

---

## C. Features planned but NOT completed in Phase 1

> Verified against actual code — NOT assumed.

| Feature | Evidence | Status |
|---|---|---|
| Multi-turn conversation context in RAG | `rag_engine.py` and `chat.py` have no `conversation_history` param | **MISSING** |
| Dashboard stats (real data) | `App.tsx` L129: `value="128"`, L150: `value="94%"` hardcoded | **MISSING** |
| SearchBox wired to API | `SearchBox.tsx` only imports `useTheme` — no fetch/API call | **MISSING** |
| AIAssistant widget wired to API | `AIAssistant.tsx` only imports `useTheme` — no fetch/API call | **MISSING** |
| ActivityPanel live data | `ActivityPanel.tsx` hardcoded items including `"API Documentation.pdf"` | **MISSING** |
| Task persistence | `agent_service.py L54`: `"""Create a task/action item (simulated)."""` | **MISSING** |
| LLM error handling | `llm_service.py`: `_call_groq()` has no try/except | **MISSING** |
| Mock data indicator in ProjectsPage | No `"Demo Data"` banner in `ProjectsPage.tsx` | **MISSING** |

---

## D. What should logically come immediately after Phase 1?

Based on the project's own roadmap priority order:

1. **Complete the Level 1 DoD unchecked items** (dashboard live stats, SearchBox, AIAssistant, multi-turn context, LLM error handling)
2. **Task persistence** — Task Agent creates tasks that are never saved
3. **Hybrid search** — the project's biggest retrieval upgrade
4. **LLM-driven agents** — replace keyword routing with real tool calling

---

## E. Minimum necessary Phase 2

These are the items explicitly listed in `DEFINITION_OF_DONE.md` Level 2 with acceptance criteria written, plus leftover Level 1 items still unchecked:

### E1. Leftover Level 1 items (must close before Level 2)
1. Multi-turn conversation context in RAG LLM call
2. Dashboard stats show real data
3. SearchBox wired to `/api/v1/search`
4. AIAssistant widget calls `/api/v1/chat`
5. LLM error handling (try/except in `llm_service.py`)

### E2. Core Level 2 (all in DEFINITION_OF_DONE.md)
6. BM25 keyword index + RRF fusion (Hybrid Search)
7. Cross-encoder reranking
8. Task persistence in MongoDB (Task model + route + controller)
9. LangGraph agent framework
10. Knowledge graph (networkx, in-memory, entity extraction via LLM)
11. GitHub mock indicator in UI
12. Rate limiting (auth + AI endpoints)

---

## F. Features that are only optional improvements

| Feature | Why Optional |
|---|---|
| Real GitHub token integration | Already works when `GITHUB_TOKEN` is set; mock covers demos |
| GitHub pagination/rate limiting | Only matters if repo has >30 issues |
| Agent memory across turns | Adds complexity; not in DoD L2 |
| Groq/Gemini streaming (real token-by-token) | SSE currently simulates streaming — works for users |
| DOCX/XLSX file support | Not in DoD, not in GAP priority list |
| Page numbers in citations | Useful but not in DoD acceptance criteria |
| OCR for scanned PDFs | Complex, not required for B.Tech portfolio |

---

## G. Features that would be unnecessary overengineering

| Feature | Reason |
|---|---|
| Neo4j (full graph DB) | Documentation explicitly says use `networkx` for B.Tech project |
| Redis + Celery task queue | P3 roadmap, Windows setup is complex |
| Prometheus/Grafana monitoring | P3, no operational requirement |
| Docker/docker-compose | P3, Windows dev setup adds friction |
| RAGAS-based AI evaluation | P3, research-grade — beyond project scope |
| Jira/Slack integration | Out of scope (P3, no mention in DoD) |
| Refresh tokens | P3, JWT 7d expiry sufficient for portfolio |
| PII detection/redaction | P3, no compliance requirement |

---

## H. What should be postponed to Phase 3?

Per `IMPLEMENTATION_ROADMAP.md` Level 3 section — all these are explicitly Phase 3:

- Docker + docker-compose
- GitHub Actions CI/CD
- Real LLM token streaming from Groq (not simulated)
- Redis + Celery background jobs
- Prometheus + Grafana monitoring
- Refresh token mechanism
- Jira/Slack integration
- RAGAS-based AI evaluation
- PII detection and redaction
- Helmet.js on Node backend

---

## I. What makes this stronger for college project + placement portfolio?

**High impact, actually achievable:**

1. **Hybrid search** — most interviewers know this buzzword; demonstrating BM25 + RRF in code is impressive
2. **LangGraph agents** — "we use LangGraph for tool orchestration" reads extremely well
3. **Knowledge graph** — D3.js visualization of entities extracted from documents is visually impressive
4. **Multi-turn RAG** — "the AI remembers the context of prior questions" is a concrete UX improvement
5. **Task persistence** — moving from "simulated" to a real Task model is basic completeness
6. **Live dashboard** — makes the product feel real vs. a demo
7. **Rate limiting** — one line to add with `slowapi`/`express-rate-limit`, shows security awareness

**Lower priority for interviews:**
- GitHub pagination (users won't notice)
- Real streaming (simulation already works)

---

## J. What can realistically be implemented on the current Windows setup?

✅ **Works on Windows without Docker:**
- `rank-bm25` — pure Python, pip install, no dependencies
- `sentence-transformers` cross-encoder — already installed, just load a different model
- `networkx` — pure Python, pip install
- `langgraph` + `langchain-core` + `langchain-groq` — pip install, no system deps
- Express `express-rate-limit` — npm install
- `slowapi` for FastAPI — pip install
- MongoDB Task model — already have Mongoose setup
- Frontend dashboard wiring — pure React state

❌ **Would need Docker/WSL:**
- Neo4j (graph DB)
- Redis/Celery
- Prometheus/Grafana

---

## Complete Feature Classification

| Feature | Classification | Source |
|---|---|---|
| Multi-turn conversation context | **REQUIRED** (DoD L1 unchecked) | `DEFINITION_OF_DONE.md` L52 |
| Dashboard live stats | **REQUIRED** (DoD L1 unchecked) | `DEFINITION_OF_DONE.md` L62 |
| SearchBox wired to search API | **REQUIRED** (DoD L1 unchecked) | `DEFINITION_OF_DONE.md` L58 |
| AIAssistant widget wired | **REQUIRED** (DoD L1 unchecked) | `DEFINITION_OF_DONE.md` L62 |
| LLM error handling (try/except) | **REQUIRED** (DoD L1 acceptance) | `DEFINITION_OF_DONE.md` L47, GAP-013 |
| BM25 + Hybrid Search + RRF | **REQUIRED** (DoD L2) | `DEFINITION_OF_DONE.md` L73 |
| Cross-encoder reranking | **REQUIRED** (DoD L2) | `DEFINITION_OF_DONE.md` L79 |
| Task persistence in MongoDB | **REQUIRED** (DoD L2) | `DEFINITION_OF_DONE.md` L104 |
| LangGraph agent workflow | **REQUIRED** (DoD L2) | `DEFINITION_OF_DONE.md` L98 |
| LLM-driven tool selection | **REQUIRED** (DoD L2) | `DEFINITION_OF_DONE.md` L98 |
| Knowledge graph (networkx) | **REQUIRED** (DoD L2) | `DEFINITION_OF_DONE.md` L91 |
| GitHub mock indicator in UI | **REQUIRED** (DoD L2) | `DEFINITION_OF_DONE.md` L86 |
| Rate limiting | **RECOMMENDED** (GAP-018, P2) | `GAP_ANALYSIS.md` |
| ActivityPanel live data | **RECOMMENDED** (GAP-017, P2) | `GAP_ANALYSIS.md` |
| Real LLM streaming (Groq API) | **OPTIONAL** (GAP-019, P2) | `GAP_ANALYSIS.md` |
| GitHub pagination/rate limiting | **OPTIONAL** (P2) | `LEVEL_2_TRACEABILITY.md` |
| DOCX/XLSX support | **OPTIONAL** | Not in any DoD |
| Page numbers in citations | **OPTIONAL** | RAG_AUDIT.md noted |
| Docker/CI/CD | **PHASE 3** | `IMPLEMENTATION_ROADMAP.md` |
| Neo4j (replace networkx) | **PHASE 3** | `KNOWLEDGE_GRAPH_AUDIT.md` |
| Refresh tokens | **PHASE 3** | `GAP_ANALYSIS.md` |
| Redis/Celery | **PHASE 3** | `IMPLEMENTATION_ROADMAP.md` |
| Prometheus/Grafana | **PHASE 3** | `IMPLEMENTATION_ROADMAP.md` |
| RAGAS evaluation | **PHASE 3** | `GAP_ANALYSIS.md` |
| Jira/Slack integration | **OUT OF SCOPE** | Not in DoD |

---

## ROADMAP A — Minimum Required Phase 2

*Strictly based on `DEFINITION_OF_DONE.md` Level 2 acceptance criteria + unchecked Level 1 items.*

### Group A1: Close Remaining Level 1 Items (1–2 days)
1. **Multi-turn context in RAG**: Pass last N conversation messages as `history` to `get_llm_response()` via `chat.py` + `rag_engine.py`
2. **LLM error handling**: Add try/except in `llm_service.py` → return 503 with message
3. **Dashboard live stats**: Wire `App.tsx` StatsCards to real API data (vector count from `/health`, conversation count from backend)
4. **SearchBox → API**: Wire `SearchBox.tsx` to call `/api/v1/search` and display results
5. **AIAssistant → API**: Wire `AIAssistant.tsx` to call `/api/v1/chat` or navigate to ChatPage

### Group A2: Hybrid Search (2–3 days)
6. **`bm25_store.py`**: Build BM25 index over all ingested chunks; rebuild on upload/delete
7. **RRF fusion in `vector_store.py`**: Combine dense + sparse ranked lists using Reciprocal Rank Fusion
8. **Cross-encoder reranker in `reranker.py`**: Load `cross-encoder/ms-marco-MiniLM-L-6-v2` from sentence-transformers; rerank top-K before context construction

### Group A3: Task Persistence (0.5 day)
9. **`backend/src/models/Task.js`**: Task model (title, description, priority, status, creator_id)
10. **`backend/src/routes/tasks.js`** + controller: CRUD for tasks
11. **`agent_service.py`**: Replace simulated `tool_create_task()` with HTTP POST to backend Task API

### Group A4: LangGraph Agents (2–3 days)
12. **Install**: `langgraph`, `langchain-core`, `langchain-groq` in requirements.txt
13. **`langgraph_agent.py`**: StateGraph with Planner → ToolExecutor → Synthesizer nodes
14. **LLM tool selection**: Use Groq function-calling API for dynamic tool selection
15. **Iterative reasoning**: Loop until answer found or max_iterations reached
16. **Wire to `agents.py` endpoint**: Migrate `execute_agent()` to use LangGraph

### Group A5: Knowledge Graph (2–3 days)
17. **Install**: `networkx` in requirements.txt
18. **`graph_service.py`**: Entity extraction via LLM (Groq) during document ingestion
19. **Graph storage**: Nodes + edges stored as JSON file (persisted across restarts)
20. **Agent tool**: `search_knowledge_graph(query)` for LangGraph agents
21. **`GET /api/v1/graph`**: Endpoint returning graph node/edge data for frontend

### Group A6: Frontend Polish (0.5 day)
22. **ProjectsPage mock indicator**: Show "Demo Data — Set GITHUB_TOKEN to connect" banner
23. **ActivityPanel**: Wire to real events (last 5 uploads + last 5 chat queries from MongoDB)

### Group A7: Tests + Docs (0.5 day)
24. **Phase 2 regression tests**: `test_phase2_complete.py` covering hybrid search, agents, knowledge graph, tasks
25. **Update README** and definition-of-done checkboxes

**Estimated effort: 8–12 developer-days**

---

## ROADMAP B — Enhanced Phase 2

*Roadmap A + recommended improvements for a stronger portfolio.*

All of Roadmap A, plus:

| Addition | Priority | Effort | Value |
|---|---|---|---|
| Rate limiting (`slowapi` + `express-rate-limit`) | Recommended | 0.5 day | Security awareness |
| Real Groq streaming (token-by-token, not word-split) | Optional | 1 day | Better UX |
| Knowledge graph D3.js visualization in `KnowledgePage.tsx` | Recommended | 1 day | Visually impressive for demo |
| GitHub pagination (50 items per page) | Optional | 0.5 day | Real-world robustness |
| Agent citations (format `knowledge_results` like RAG citations) | Recommended | 0.5 day | Consistency |
| Unit tests for `chunk_text`, `bm25_store`, `reranker` | Recommended | 0.5 day | Code quality |

**Estimated effort: 11–16 developer-days total**

---

## First Task for Phase 2

Based on the roadmap dependency order, the very first task is:

> **A1.1 — Multi-turn conversation context in RAG**

**Why first?**
- Explicitly required by `DEFINITION_OF_DONE.md` L52-53: *"Prior conversation turns included as context in subsequent LLM calls"*
- It is a Level 1 item that was left incomplete
- It completes the chat feature before adding more complex retrieval features
- It requires changes only to `chat.py` and `rag_engine.py` — no new dependencies

**Exact files:**
- `Ai-Service/app/api/v1/endpoints/chat.py` — accept `conversation_history: list[dict]` in request body
- `Ai-Service/app/services/rag_engine.py` — prepend history as `[{"role": ..., "content": ...}]` to Groq messages list
- `Ai-Service/app/api/v1/endpoints/chat.py` (stream endpoint) — same history injection
- `frontend/src/pages/ChatPage.tsx` — send `messages` array as `conversation_history` in each request

**Second task:** A1.2 — LLM error handling in `llm_service.py` (15 minutes, completely isolated)

**Third task:** A1.3 — Dashboard live stats wired to real API data

---

*Ready to begin Phase 2 on your command: **"START PHASE 2"***
