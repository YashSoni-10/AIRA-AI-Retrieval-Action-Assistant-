# AIRA — AI Service Audit (Python FastAPI)
**Date:** 2026-09-09 | Source: `Ai-Service/app/`

---

## 1. Service Configuration

| Setting | Value |
|---------|-------|
| Framework | FastAPI |
| Server | Uvicorn |
| Port | 8000 |
| Auth | **NONE** — all endpoints unauthenticated |
| CORS | Allows `FRONTEND_ORIGIN`, `localhost:5173`, `localhost:3000` |
| Docs | Swagger `/docs`, ReDoc `/redoc` |
| API Prefix | `/api/v1` |

---

## 2. Complete Endpoint Inventory

### `GET /api/v1/health`
| Field | Value |
|-------|-------|
| File | `endpoints/health.py` |
| Function | `health_check()` |
| Auth | None |
| Request | None |
| Response | `{ status, service, version, llm_provider, indexed_vectors }` |
| Dependencies | `vector_store.get_document_count()`, `config.settings` |
| Status | **IMPLEMENTED** |
| Test Status | **NOT TESTED** |

### `POST /api/v1/ingest`
| Field | Value |
|-------|-------|
| File | `endpoints/ingest.py` |
| Function | `ingest_document()` |
| Auth | None |
| Request | `UploadFile` (multipart/form-data) |
| Allowed Types | `.pdf`, `.txt`, `.md`, `.rst` |
| Max Size | 10 MB |
| Response | `{ status, filename, file_size_kb, chunks_created, vectors_stored, message }` |
| Pipeline | `extract_text()` → `chunk_text()` → `add_documents()` |
| Dependencies | `document_processor`, `vector_store`, `config` |
| Error Handling | 415 bad type, 413 too large, 400 empty, 422 no text/chunks |
| Status | **IMPLEMENTED** |
| Test Status | **NOT TESTED** |

### `GET /api/v1/ingest/list`
| Field | Value |
|-------|-------|
| File | `endpoints/ingest.py` |
| Function | `list_indexed_documents()` |
| Auth | None |
| Response | `{ documents: list[str], count: int }` |
| Dependencies | `vector_store.list_documents()` |
| Status | **IMPLEMENTED** |
| Test Status | **NOT TESTED** |

### `DELETE /api/v1/ingest/{filename}`
| Field | Value |
|-------|-------|
| File | `endpoints/ingest.py` |
| Function | `delete_document()` |
| Auth | None |
| URL Param | `filename: str` |
| Response | `{ status, filename, chunks_removed, message }` |
| Dependencies | `vector_store.delete_documents()` |
| Issue | `chunks_removed` always returns `1` from Qdrant (count not accurate), correct count from memory |
| Status | **PARTIALLY IMPLEMENTED** (Qdrant delete count inaccurate) |
| Test Status | **NOT TESTED** |

### `POST /api/v1/chat`
| Field | Value |
|-------|-------|
| File | `endpoints/chat.py` |
| Function | `chat()` |
| Auth | None |
| Request | `{ query: str (1-2000), top_k: int (1-20, default: 5) }` |
| Response | `ChatResponse` Pydantic model: `{ answer, confidence, confidence_label, reasoning_steps, citations, chunks_found, query }` |
| Pipeline | `run_rag_query(query, top_k)` |
| Dependencies | `rag_engine`, `vector_store`, `llm_service` |
| Status | **IMPLEMENTED** |
| Test Status | **NOT TESTED** |

### `GET /api/v1/chat/stream`
| Field | Value |
|-------|-------|
| File | `endpoints/chat.py` |
| Function | `chat_stream()` |
| Auth | None |
| Query Params | `query: str`, `top_k: int` |
| Response | SSE `text/event-stream` with JSON events |
| Event Types | `reasoning_step`, `token`, `done`, `error` |
| Streaming | **Simulated** — full LLM response obtained, then emitted word-by-word |
| Status | **PARTIALLY IMPLEMENTED** (fake streaming — not real token streaming from LLM) |
| Test Status | **NOT TESTED** |

### `GET /api/v1/search`
| Field | Value |
|-------|-------|
| File | `endpoints/search.py` |
| Function | `search_knowledge()` |
| Auth | None |
| Query Params | `q: str`, `top_k: int (1-20, default: 5)` |
| Response | `{ query, results: [{text, filename, chunk_index, score}], count }` |
| Dependencies | `vector_store.similarity_search()` |
| Status | **IMPLEMENTED** |
| Test Status | **NOT TESTED** |

### `GET /api/v1/agents`
| Field | Value |
|-------|-------|
| File | `endpoints/agents.py` |
| Function | `get_agents()` |
| Auth | None |
| Response | `{ agents: [{ id, name, description, tools }], count }` |
| Dependencies | `agent_service.list_agents()` |
| Status | **IMPLEMENTED** |
| Test Status | **NOT TESTED** |

### `POST /api/v1/agents/execute`
| Field | Value |
|-------|-------|
| File | `endpoints/agents.py` |
| Function | `execute_agent_endpoint()` |
| Auth | None |
| Request | `{ agent_id: str, query: str (1-2000) }` |
| Response | `{ agent_id, agent_name, query, steps, answer, task_created, knowledge_results, status }` |
| Dependencies | `agent_service.execute_agent()` |
| Error Handling | 404 unknown agent, 400 empty query |
| Status | **IMPLEMENTED** |
| Test Status | **NOT TESTED** |

### `GET /api/v1/github/repos`
| Field | Value |
|-------|-------|
| File | `endpoints/github.py` |
| Function | `list_repos()` |
| Auth | None |
| Response | `{ repositories: list[dict], count: int }` |
| Dependencies | `github_service.get_github_repos()` |
| Fallback | Hardcoded mock repos if no `GITHUB_TOKEN` |
| Status | **IMPLEMENTED (MOCK FALLBACK)** |
| Test Status | **NOT TESTED** |

### `GET /api/v1/github/issues`
| Field | Value |
|-------|-------|
| File | `endpoints/github.py` |
| Function | `list_issues()` |
| Auth | None |
| Query Params | `repo?: str` |
| Response | `{ issues: list[dict], count: int, repository: str }` |
| Dependencies | `github_service.get_github_issues()` |
| Fallback | Hardcoded mock issues if no `GITHUB_TOKEN` |
| Status | **IMPLEMENTED (MOCK FALLBACK)** |
| Test Status | **NOT TESTED** |

### `GET /api/v1/github/pulls`
| Field | Value |
|-------|-------|
| File | `endpoints/github.py` |
| Function | `list_pulls()` |
| Auth | None |
| Query Params | `repo?: str` |
| Response | `{ pulls: list[dict], count: int, repository: str }` |
| Dependencies | `github_service.get_github_pulls()` |
| Fallback | Hardcoded mock PRs if no `GITHUB_TOKEN` |
| Status | **IMPLEMENTED (MOCK FALLBACK)** |
| Test Status | **NOT TESTED** |

---

## 3. Services Layer Analysis

### `llm_service.py`
| Feature | Detail | Status |
|---------|--------|--------|
| Provider routing | `LLM_PROVIDER` env var → Groq or Gemini | IMPLEMENTED |
| Groq integration | `groq.Groq(api_key=...).chat.completions.create()` | IMPLEMENTED |
| Gemini integration | `google.generativeai.GenerativeModel().generate_content()` | IMPLEMENTED |
| Local fallback | Returns echo message when no API key set | IMPLEMENTED |
| Temperature | 0.3 for all calls | IMPLEMENTED |
| Token limits | Configurable `max_tokens` param | IMPLEMENTED |
| Error handling | **NO try/except** — LLM errors will propagate as 500 | **MISSING** |
| Streaming from LLM | **NOT IMPLEMENTED** — only batch generation | MISSING |

### `document_processor.py`
| Feature | Detail | Status |
|---------|--------|--------|
| PDF extraction | `pypdf.PdfReader` with page numbering | IMPLEMENTED |
| TXT/MD/RST | UTF-8 decode with error replace | IMPLEMENTED |
| Unknown types | UTF-8 decode fallback | IMPLEMENTED |
| Chunking | Overlapping chunks, tries sentence/paragraph boundaries | IMPLEMENTED |
| Chunk metadata | `text, filename, chunk_index, char_start, char_end` | IMPLEMENTED |
| Empty text guard | Returns empty list if no text | IMPLEMENTED |
| Large file handling | Limited to 10MB by ingest endpoint | IMPLEMENTED |
| Duplicate detection | **NOT IMPLEMENTED** — re-uploading same file creates duplicate vectors | MISSING |

### `embeddings_service.py`
| Feature | Detail | Status |
|---------|--------|--------|
| Model | `all-MiniLM-L6-v2` (384-dim) | IMPLEMENTED |
| Loading | Singleton — loaded once, reused | IMPLEMENTED |
| Normalization | `normalize_embeddings=True` | IMPLEMENTED |
| Batch embed | `embed_texts(list[str])` | IMPLEMENTED |
| Single embed | `embed_query(str)` | IMPLEMENTED |
| Error handling | No try/except — model load failures propagate | PARTIAL |

### `vector_store.py`
| Feature | Detail | Status |
|---------|--------|--------|
| Qdrant connection | Auto-connect on first use, 5s timeout | IMPLEMENTED |
| Collection auto-create | Creates `aira_knowledge` if missing | IMPLEMENTED |
| In-memory fallback | `_memory_store` list | IMPLEMENTED |
| Add documents | `add_documents()` → embed + upsert | IMPLEMENTED |
| Cosine similarity search | Via Qdrant or numpy dot product | IMPLEMENTED |
| Delete by filename | Filter by `filename` payload | IMPLEMENTED (count inaccurate for Qdrant) |
| List documents | Scroll all points → collect filenames | IMPLEMENTED |
| Document count | `get_collection().points_count` | IMPLEMENTED |
| BM25 / keyword search | **NOT IMPLEMENTED** | MISSING |
| Hybrid search | **NOT IMPLEMENTED** | MISSING |
| Reranking | **NOT IMPLEMENTED** | MISSING |
| Metadata filtering | **NOT IMPLEMENTED** (no user/workspace filtering) | MISSING |

### `rag_engine.py`
| Feature | Detail | Status |
|---------|--------|--------|
| Semantic retrieval | `similarity_search(query, top_k)` | IMPLEMENTED |
| Context construction | Numbered source blocks with filename + chunk_index + score | IMPLEMENTED |
| System prompt | Grounded, cite-sources instructions | IMPLEMENTED |
| LLM call | `get_llm_response()` | IMPLEMENTED |
| Confidence score | `avg(top_3_scores) * 1.15`, capped at 1.0 | IMPLEMENTED |
| Confidence labels | High ≥ 0.75, Medium ≥ 0.45, Low < 0.45 | IMPLEMENTED |
| Citations | Filename, chunk_index, excerpt (200 chars), score | IMPLEMENTED |
| Conversation history | **NOT IMPLEMENTED** — stateless, each query is independent | MISSING |
| Hybrid retrieval | **NOT IMPLEMENTED** — pure semantic only | MISSING |
| Reranking | **NOT IMPLEMENTED** | MISSING |
| Hallucination mitigation | Only via grounded prompt — no faithfulness check | PARTIAL |

### `agent_service.py`
| Feature | Detail | Status |
|---------|--------|--------|
| 3 agent types | knowledge, engineering, task | IMPLEMENTED |
| Knowledge search tool | `tool_search_knowledge()` | IMPLEMENTED |
| Document summarize tool | `tool_summarize_document()` | IMPLEMENTED |
| Task creation tool | `tool_create_task()` — **SIMULATED ONLY** | MOCK |
| GitHub tools | `tool_list_github_repos/issues/pulls()` | IMPLEMENTED (mock fallback) |
| LLM answer tool | `tool_answer_question()` | IMPLEMENTED |
| LangGraph | **NOT IMPLEMENTED** — sequential function calls, not a graph | MISSING |
| Agent planning | **NOT IMPLEMENTED** — deterministic scripted flow | MISSING |
| Tool selection | **Hardcoded by agent_id** — not LLM-selected | PARTIAL |
| Iterative reasoning | **NOT IMPLEMENTED** — single pass | MISSING |
| Memory between calls | **NOT IMPLEMENTED** — stateless | MISSING |

### `github_service.py`
| Feature | Detail | Status |
|---------|--------|--------|
| Real GitHub API | Calls `api.github.com/user/repos`, `.../issues`, `.../pulls` | IMPLEMENTED |
| Auth header | Bearer token from `GITHUB_TOKEN` | IMPLEMENTED |
| Mock fallback | 3 repos, 3 issues, 2 PRs hardcoded | IMPLEMENTED (declared, not hidden) |
| Rate limiting | **NOT HANDLED** — GitHub 60 req/hr unauth, 5000 req/hr auth | MISSING |
| Error handling | Logs error, returns empty list | IMPLEMENTED |
| Pagination | **NOT IMPLEMENTED** — only first page of results | MISSING |
| Token validation | No upfront validation — only discovers invalid token on first use | PARTIAL |

---

## 4. API Classification Summary

| Endpoint | Status |
|----------|--------|
| GET /health | IMPLEMENTED |
| POST /ingest | IMPLEMENTED |
| GET /ingest/list | IMPLEMENTED |
| DELETE /ingest/{filename} | PARTIALLY IMPLEMENTED |
| POST /chat | IMPLEMENTED |
| GET /chat/stream | PARTIALLY IMPLEMENTED (simulated streaming) |
| GET /search | IMPLEMENTED |
| GET /agents | IMPLEMENTED |
| POST /agents/execute | IMPLEMENTED |
| GET /github/repos | IMPLEMENTED (MOCK FALLBACK) |
| GET /github/issues | IMPLEMENTED (MOCK FALLBACK) |
| GET /github/pulls | IMPLEMENTED (MOCK FALLBACK) |
