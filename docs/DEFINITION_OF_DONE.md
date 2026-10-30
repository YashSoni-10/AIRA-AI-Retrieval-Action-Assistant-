# AIRA — Definition of Done
**Date:** 2026-09-09

---

## Level 1 — Foundation & RAG — Definition of Done

All items must pass before Level 1 is declared complete.

### Authentication
- [ ] User can register with name, email, password → receives JWT
- [ ] Registered user can log in → receives fresh JWT
- [ ] Invalid credentials → 401 response with clear message
- [ ] Protected routes return 401 without valid JWT
- [ ] JWT expires after 7 days
- [ ] Logout clears localStorage and redirects to login
- [ ] Profile update (name) persists in MongoDB
- [ ] Password change issues new JWT, invalidates old one
- [ ] `JWT_SECRET` validation: server refuses to start without it

### AI Service Authentication
- [ ] All FastAPI endpoints (ingest, chat, search, agents) require valid JWT
- [ ] Request without token → 401
- [ ] Request with expired token → 401
- [ ] Request with valid token → 200 and proceeds normally
- [ ] `user_id` extracted from JWT and available in all service calls

### Document Management
- [ ] Upload PDF → text extracted, chunked, embedded, stored in Qdrant
- [ ] Upload TXT → processed successfully
- [ ] Upload MD → processed successfully
- [ ] Unsupported file type → 415 error with clear message
- [ ] File > 10 MB → 413 error with clear message
- [ ] Uploaded document appears in document list
- [ ] Duplicate upload (same filename by same user) → warns and replaces old vectors
- [ ] Delete document → removed from Qdrant and document list
- [ ] Document metadata (filename, upload date, size, chunk count) stored in MongoDB
- [ ] User A's documents not visible to User B

### RAG Chat
- [ ] Submit query → RAG response within 15s
- [ ] Response grounded in indexed documents
- [ ] Response includes citations (filename, excerpt, confidence score)
- [ ] Response includes confidence label (High/Medium/Low)
- [ ] Response includes reasoning steps
- [ ] No documents indexed → appropriate "no context found" message (not hallucination)
- [ ] LLM API failure → 503 with user-friendly message (not unhandled 500)

### Conversation History
- [ ] Chat messages persist in MongoDB after page reload
- [ ] User can resume previous conversations
- [ ] Prior conversation turns included as context in subsequent LLM calls
- [ ] "What did you say earlier?" references prior turn correctly
- [ ] Each conversation belongs to one user; other users cannot access it

### Semantic Search
- [ ] Direct search at `/knowledge` returns relevant chunks
- [ ] Dashboard SearchBox wired to search API and shows results
- [ ] Results include filename, excerpt, score

### Frontend Live Data
- [ ] Dashboard stats show real data (real indexed vector count, real conversation count)
- [ ] ActivityPanel shows real recent events
- [ ] All page data refreshes without hardcoded values

---

## Level 2 — Intelligence & Agents — Definition of Done

All items must pass before Level 2 is declared complete. All Level 1 items must already pass.

### Hybrid Search
- [ ] BM25 index built and updated when documents are added/deleted
- [ ] `similarity_search()` uses hybrid search (semantic + BM25)
- [ ] RRF fusion applied to merge ranked lists
- [ ] Keyword-heavy query ("what is the refund policy") returns better results than semantic-only

### Reranking
- [ ] Cross-encoder model loaded at service startup
- [ ] Retrieved top-K chunks reranked before context construction
- [ ] Reranked order differs from vector similarity order (demonstrably)
- [ ] Reranking adds < 3s to response time

### GitHub Integration
- [ ] With `GITHUB_TOKEN` set: real repos/issues/PRs from GitHub API shown
- [ ] Without `GITHUB_TOKEN`: mock indicator shown in UI ("Demo Data — Configure GITHUB_TOKEN")
- [ ] Engineering agent correctly surfaces GitHub data in response

### Knowledge Graph
- [ ] Document upload triggers entity extraction
- [ ] Entities (Person, Technology, Project, Document) stored in graph
- [ ] Relationships (MENTIONS, USES, RELATES_TO) stored in graph
- [ ] Graph queryable via agent tool `search_knowledge_graph()`
- [ ] Knowledge graph context included in relevant agent responses
- [ ] Graph node count shown in health/dashboard

### LangGraph Agents
- [ ] LangGraph StateGraph defined with planner/tool-executor/synthesizer nodes
- [ ] Agent can call multiple tools in a single execution
- [ ] Tool selection is LLM-driven (not hardcoded keywords)
- [ ] Agent can iterate (call tool → observe → decide next tool)
- [ ] Agent execution result includes step-by-step reasoning trace

### Task Management
- [ ] Task Agent creates task → task saved in MongoDB
- [ ] Tasks retrievable via API
- [ ] Task includes title, description, priority, status, creator

### Agent Quality
- [ ] Knowledge Agent: returns grounded answer from KB with citations
- [ ] Engineering Agent: answers questions using KB + GitHub data
- [ ] Task Agent: creates and persists task in addition to answering

### Evidence Quality
- [ ] All chat responses include source citations
- [ ] Citations include filename, excerpt, confidence score
- [ ] Agent responses include knowledge_results references
- [ ] No factual hallucination when clear instructions given to stay grounded

---

## Code Quality Standards (All Levels)

- [ ] No commented-out code blocks
- [ ] All `console.log` debug statements removed from production paths
- [ ] All API errors return structured JSON (not HTML error pages)
- [ ] No hardcoded secrets in source files (use `.env`)
- [ ] `.env.example` files up to date with all required variables
- [ ] Python code follows PEP 8 (basic formatting)
- [ ] TypeScript code has no `any` types on critical paths

---

## Test Requirements (Minimum)

### Unit Tests (to be written)
- [ ] `authController.register()` — success, duplicate email, missing fields
- [ ] `authController.login()` — success, wrong password, missing fields
- [ ] `protect` middleware — valid token, expired token, missing token
- [ ] `document_processor.chunk_text()` — normal text, empty text, small text
- [ ] `vector_store.similarity_search()` — with results, no results
- [ ] `rag_engine.run_rag_query()` — normal query, empty KB
- [ ] `agent_service.execute_agent()` — knowledge, engineering, task agents

### Integration Tests (to be written)
- [ ] End-to-end: register → login → upload → chat → citations verified
- [ ] End-to-end: upload → delete → verify not in list
- [ ] End-to-end: User A uploads → User B cannot retrieve in chat

---

## Environment Requirements

The following environment variables must be documented and set:

### Node Backend
| Variable | Required | Purpose |
|---------|---------|---------|
| JWT_SECRET | **REQUIRED** | JWT signing key |
| MONGO_URI | Optional | MongoDB connection (has in-memory fallback) |
| PORT | Optional | Server port (default 5000) |
| FRONTEND_ORIGIN | Optional | CORS origin (default localhost:5173) |

### FastAPI AI Service
| Variable | Required | Purpose |
|---------|---------|---------|
| GROQ_API_KEY | Required for LLM | Groq API key |
| GEMINI_API_KEY | Required if Groq not used | Gemini API key |
| LLM_PROVIDER | Optional | "groq" or "gemini" (default: groq) |
| JWT_SECRET | **REQUIRED** (for auth) | Same secret as Node backend |
| GITHUB_TOKEN | Optional | GitHub API PAT (mock fallback without it) |
| GITHUB_REPO | Optional | Default GitHub repo for issues/PRs |
| QDRANT_HOST | Optional | Qdrant host (default: localhost) |
| QDRANT_PORT | Optional | Qdrant port (default: 6333) |
| QDRANT_COLLECTION | Optional | Collection name (default: aira_knowledge) |
| CHUNK_SIZE | Optional | Text chunk size (default: 500) |
| CHUNK_OVERLAP | Optional | Text chunk overlap (default: 50) |
