# AIRA — Level 2 Traceability Matrix
**Date:** 2026-09-09 | LEVEL 2: Intelligence & Agents

---

## Summary

| Requirement | Status |
|-------------|--------|
| Hybrid Search | NOT IMPLEMENTED |
| Reranking | NOT IMPLEMENTED |
| GitHub Integration | PARTIALLY IMPLEMENTED (mock fallback) |
| Knowledge Graph | NOT IMPLEMENTED |
| LangGraph | NOT IMPLEMENTED |
| AI Agents | PARTIALLY IMPLEMENTED (scripted, not graph-based) |
| Tool Calling | PARTIALLY IMPLEMENTED (deterministic, not LLM-selected) |
| Multi-source Reasoning | PARTIALLY IMPLEMENTED |
| Evidence-backed Responses | IMPLEMENTED |

---

## Detailed Traceability

### 1. Hybrid Search
| Aspect | Required | Actual Implementation | Files | Status |
|--------|---------|----------------------|-------|--------|
| Semantic (vector) retrieval | ✅ | Cosine similarity via Qdrant | `vector_store.py similarity_search()` | IMPLEMENTED |
| Keyword retrieval (BM25) | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Score normalization | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Retrieval fusion (RRF or similar) | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Metadata filtering | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |

**Gap:** No hybrid search. Current system is pure semantic/vector similarity only. BM25 or TF-IDF keyword component is missing. No fusion strategy.

**Status: NOT IMPLEMENTED**

---

### 2. Reranking
| Aspect | Required | Actual Implementation | Files | Status |
|--------|---------|----------------------|-------|--------|
| Reranker model | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Cross-encoder reranking | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Score re-ordering | ✅ | NOT IMPLEMENTED (results just sorted by vector score) | — | NOT IMPLEMENTED |
| Integration with retrieval | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |

**Gap:** Results are returned in Qdrant cosine similarity order. No reranking model applied. Calling the vector score "reranking" would be false.

**Status: NOT IMPLEMENTED**

---

### 3. GitHub Integration
| Aspect | Required | Actual Implementation | Files | Status |
|--------|---------|----------------------|-------|--------|
| Token-based auth | ✅ | `GITHUB_TOKEN` env var → `Authorization: token` header | `github_service.py get_headers()` | IMPLEMENTED |
| Repository listing | ✅ | `GET /user/repos` | `github_service.py get_github_repos()` | IMPLEMENTED (real + mock) |
| Issues listing | ✅ | `GET /repos/{owner}/{repo}/issues` | `github_service.py get_github_issues()` | IMPLEMENTED (real + mock) |
| Pull requests | ✅ | `GET /repos/{owner}/{repo}/pulls` | `github_service.py get_github_pulls()` | IMPLEMENTED (real + mock) |
| Commits | ❌ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Files/Code browsing | ❌ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Rate limit handling | ❌ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Pagination | ❌ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Mock fallback | — | 3 repos, 3 issues, 2 PRs hardcoded | `github_service.py` | IMPLEMENTED (explicitly declared as mock) |
| Frontend display | ✅ | ProjectsPage shows repos/issues/PRs | `ProjectsPage.tsx` | IMPLEMENTED |
| Agent integration | ✅ | Engineering agent triggers GitHub tools | `agent_service.py execute_agent()` | IMPLEMENTED |
| API endpoints | ✅ | `/api/v1/github/repos`, `/issues`, `/pulls` | `endpoints/github.py` | IMPLEMENTED |

**Gap:** Real GitHub integration works when `GITHUB_TOKEN` is set. Without token, mock data is shown. No commits, no code browsing, no rate limiting.

**Status: PARTIALLY IMPLEMENTED** (core repos/issues/PRs work with real token; no commits/code/pagination)

---

### 4. Knowledge Graph
| Aspect | Required | Actual Implementation | Files | Status |
|--------|---------|----------------------|-------|--------|
| Graph database (Neo4j) | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Entity extraction | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Relationship mapping | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Graph nodes | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Graph edges | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Graph queries | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| RAG + graph integration | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Knowledge graph UI | ✅ | NOT IMPLEMENTED (KnowledgePage is basic search only) | — | NOT IMPLEMENTED |

**Gap:** Knowledge Graph does not exist anywhere in the codebase. There is no Neo4j connection, no entity extraction, no relationship mapping, no graph model, no graph queries.

**Status: NOT IMPLEMENTED**

---

### 5. LangGraph
| Aspect | Required | Actual Implementation | Files | Status |
|--------|---------|----------------------|-------|--------|
| LangGraph dependency | ✅ | NOT IN requirements.txt | — | NOT IMPLEMENTED |
| Graph state definition | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Graph nodes | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Graph edges | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Conditional routing | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Tool integration | ✅ | NOT IMPLEMENTED as LangGraph tools | — | NOT IMPLEMENTED |
| Memory persistence | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |

**Gap:** LangGraph is not installed (not in requirements.txt) and not used anywhere. `agent_service.py` implements a sequential function-call pattern — NOT a graph.

**Status: NOT IMPLEMENTED**

---

### 6. AI Agents
| Aspect | Required | Actual Implementation | Files | Status |
|--------|---------|----------------------|-------|--------|
| Multiple specialized agents | ✅ | 3 agents: Knowledge, Engineering, Task | `agent_service.py AGENTS dict` | IMPLEMENTED |
| Agent selection | ✅ | By `agent_id` in API request | `endpoints/agents.py` | IMPLEMENTED |
| Knowledge retrieval | ✅ | `tool_search_knowledge()` calls vector store | `agent_service.py` | IMPLEMENTED |
| GitHub tools | ✅ | `tool_list_github_repos/issues/pulls()` | `agent_service.py` | IMPLEMENTED |
| Task creation | ✅ | `tool_create_task()` — simulated UUID | `agent_service.py` | MOCK (no persistence) |
| LLM-driven tool selection | ✅ | NOT IMPLEMENTED — scripted/deterministic | — | NOT IMPLEMENTED |
| Iterative reasoning | ✅ | NOT IMPLEMENTED — single pass | — | NOT IMPLEMENTED |
| Agent memory | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Error recovery | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Frontend agent UI | ✅ | AgentsPage shows agents + execution | `AgentsPage.tsx` | IMPLEMENTED |

**Gap:** "Agents" are scripted multi-step functions, not graph-based agents with dynamic planning. The tool selection is hardcoded per agent, not LLM-driven. No iterative reasoning loop.

**Status: PARTIALLY IMPLEMENTED** (agents execute and produce results, but pattern is scripted not agentic)

---

### 7. Tool Calling
| Aspect | Required | Actual Implementation | Files | Status |
|--------|---------|----------------------|-------|--------|
| `search_documents()` | ✅ | `tool_search_knowledge()` | `agent_service.py` | IMPLEMENTED |
| `search_github()` | ✅ | `tool_get_github_issues/pulls/repos()` | `agent_service.py` | IMPLEMENTED |
| `search_knowledge_graph()` | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| `query_database()` | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| `get_project_details()` | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| `create_task()` | ✅ | `tool_create_task()` — returns dict (not persisted) | `agent_service.py` | MOCK |
| `update_task()` | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| LLM-driven selection | ✅ | NOT IMPLEMENTED — deterministic triggers | — | NOT IMPLEMENTED |
| Tool result integration | ✅ | Tool results manually concatenated into context | `agent_service.py` | IMPLEMENTED (manual) |

**Gap:** Tools are called deterministically based on keyword detection in the query string (e.g., `"issue" in query.lower()`), not selected by the LLM. True tool-calling (function calling API) is not used.

**Status: PARTIALLY IMPLEMENTED**

---

### 8. Multi-source Reasoning
| Aspect | Required | Actual Implementation | Files | Status |
|--------|---------|----------------------|-------|--------|
| Knowledge base context | ✅ | `tool_search_knowledge()` results | `agent_service.py` | IMPLEMENTED |
| GitHub context | ✅ | GitHub tool results | `agent_service.py` | IMPLEMENTED |
| Knowledge graph context | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| LLM reasoning over combined context | ✅ | Combined context string → LLM | `agent_service.py execute_agent()` | IMPLEMENTED |
| Source attribution | ✅ | Partial — RAG chat has citations, agent does not | `rag_engine.py`, `agent_service.py` | PARTIAL |

**Status: PARTIALLY IMPLEMENTED** (KB + GitHub combined, graph missing)

---

### 9. Evidence-backed Responses
| Aspect | Required | Actual Implementation | Files | Status |
|--------|---------|----------------------|-------|--------|
| Citations in RAG chat | ✅ | `filename, chunk_index, excerpt, score` | `rag_engine.py`, `endpoints/chat.py` | IMPLEMENTED |
| Confidence scoring | ✅ | `avg(top3_scores) * 1.15` | `rag_engine.py` | IMPLEMENTED |
| Reasoning steps | ✅ | Step-by-step log returned | `rag_engine.py` | IMPLEMENTED |
| Confidence labels | ✅ | High/Medium/Low | `rag_engine.py` | IMPLEMENTED |
| Faithfulness evaluation | ✅ | NOT IMPLEMENTED | — | NOT IMPLEMENTED |
| Agent response citations | ✅ | NOT IMPLEMENTED — `knowledge_results` included but not formatted as citations | — | PARTIAL |

**Status: IMPLEMENTED** (for RAG chat); **PARTIAL** for agents

---

## Level 2 Overall Completion

| # | Requirement | Status | Priority |
|---|-------------|--------|---------|
| 1 | Hybrid Search | ❌ NOT IMPLEMENTED | P1 |
| 2 | Reranking | ❌ NOT IMPLEMENTED | P1 |
| 3 | GitHub Integration | ⚠️ PARTIALLY IMPLEMENTED | P2 |
| 4 | Knowledge Graph | ❌ NOT IMPLEMENTED | P1 |
| 5 | LangGraph | ❌ NOT IMPLEMENTED | P1 |
| 6 | AI Agents | ⚠️ PARTIALLY IMPLEMENTED | P1 |
| 7 | Tool Calling | ⚠️ PARTIALLY IMPLEMENTED | P1 |
| 8 | Multi-source Reasoning | ⚠️ PARTIALLY IMPLEMENTED | P2 |
| 9 | Evidence-backed Responses | ✅ IMPLEMENTED | — |

**Level 2 Completion: ~2/9 requirements fully implemented (Evidence-backed + GitHub partial)**

**Level 2 is NOT complete.** The following are missing:
1. Hybrid search (BM25 + semantic fusion)
2. Reranking model
3. LangGraph integration
4. Knowledge graph (Neo4j or any graph store)
5. LLM-driven dynamic tool selection
6. Iterative agent reasoning loop
