# AIRA — RAG Deep Audit
**Date:** 2026-09-09 | Source: `Ai-Service/app/services/rag_engine.py` and dependencies

---

## 1. Complete RAG Pipeline Trace

```
Document Upload
  ↓ FastAPI POST /api/v1/ingest (ingest.py)
  ↓ document_processor.extract_text(file_bytes, filename)
  ↓ document_processor.chunk_text(raw_text, filename, chunk_size=500, chunk_overlap=50)
  ↓ vector_store.add_documents(chunks)
    ↓ embeddings_service.embed_texts([chunk.text for chunk in chunks])
      ↓ SentenceTransformer("all-MiniLM-L6-v2").encode(texts, normalize_embeddings=True)
    ↓ [Qdrant] client.upsert(collection="aira_knowledge", points=[...])
      OR [Memory] _memory_store.append({vector, text, filename, chunk_index})

User Query
  ↓ FastAPI POST /api/v1/chat { query, top_k=5 }
  ↓ rag_engine.run_rag_query(query, top_k)

  STEP 1: Semantic Retrieval
    ↓ vector_store.similarity_search(query, top_k)
      ↓ embeddings_service.embed_query(query)
        ↓ SentenceTransformer.encode([query], normalize_embeddings=True)[0]
      ↓ [Qdrant] client.search(query_vector, limit=top_k, with_payload=True)
        OR [Memory] numpy.dot(query_vec, stored_vec) for each stored vector → sort → top_k
    → results: [{text, filename, chunk_index, score}, ...]

  STEP 2: Context Construction
    → For each result: "[Source N: {filename} | Chunk {i} | Relevance: {score:.2%}]\n{text}"
    → context = "\n\n---\n\n".join(context_parts)

  STEP 3: LLM Call
    → system_prompt = AIRA grounding instructions
    → user_prompt = f"Context:\n{context}\n---\nUser Question: {query}\nAnswer with sources."
    ↓ llm_service.get_llm_response(system_prompt, user_prompt, max_tokens=1024)
      ↓ [Groq] Groq().chat.completions.create(model="llama-3.1-8b-instant", messages=[...], temp=0.3)
        OR [Gemini] GenerativeModel("gemini-1.5-flash").generate_content(...)
    → answer: str

  STEP 4: Confidence Scoring
    → top_scores = [r.score for r in results[:3]]
    → avg_score = mean(top_scores)
    → confidence = min(avg_score * 1.15, 1.0)
    → label = "High" if ≥0.75 else "Medium" if ≥0.45 else "Low"

  STEP 5: Citation Formatting
    → citations = [{filename, chunk_index, excerpt: text[:200], score}]

  ↓ Return ChatResponse {answer, confidence, confidence_label, reasoning_steps, citations, chunks_found, query}
```

---

## 2. Stage-by-Stage Analysis

### Stage 1: Upload & Text Extraction
| Item | Detail | Status |
|------|--------|--------|
| File | `document_processor.py` → `extract_text()` | — |
| PDF input | `pypdf.PdfReader(io.BytesIO(file_bytes))` | IMPLEMENTED |
| PDF output | Text with `[Page N]` prefix per page | IMPLEMENTED |
| TXT/MD/RST | `file_bytes.decode("utf-8", errors="replace")` | IMPLEMENTED |
| Error handling | `errors="replace"` prevents decode crash | IMPLEMENTED |
| Empty file guard | `ingest.py` checks `file_bytes` length | IMPLEMENTED |
| Scanned PDFs | Not handled — returns empty/near-empty text | MISSING |
| DOCX/XLSX | Not supported | MISSING |
| Large file | 10 MB limit enforced by ingest endpoint | IMPLEMENTED |

### Stage 2: Chunking
| Item | Detail | Status |
|------|--------|--------|
| File | `document_processor.py` → `chunk_text()` | — |
| Algorithm | Sliding window with overlap | IMPLEMENTED |
| Chunk size | 500 chars (configurable via env) | IMPLEMENTED |
| Overlap | 50 chars (configurable via env) | IMPLEMENTED |
| Boundary detection | Tries `\n\n`, `. `, `? `, `! `, `\n`, ` ` | IMPLEMENTED |
| Empty chunk guard | Skips chunks with only whitespace | IMPLEMENTED |
| Metadata returned | `text, filename, chunk_index, char_start, char_end` | IMPLEMENTED |
| Metadata stored | `text, filename, chunk_index` only (char_start/end NOT in Qdrant) | PARTIAL |

**Issue:** `char_start` and `char_end` computed by chunker are NOT stored in the vector DB payload. They exist in the intermediate dict but are discarded in `_qdrant_add()` and `_memory_add()`.

### Stage 3: Embedding
| Item | Detail | Status |
|------|--------|--------|
| File | `embeddings_service.py` | — |
| Model | `all-MiniLM-L6-v2` | IMPLEMENTED |
| Dimension | 384 | IMPLEMENTED |
| Normalization | `normalize_embeddings=True` (cosine similarity) | IMPLEMENTED |
| Batch | `model.encode(list_of_texts)` | IMPLEMENTED |
| Singleton | Model loaded once, reused | IMPLEMENTED |
| Error handling | No try/except — model load errors crash startup | MISSING |

### Stage 4: Vector Storage
| Item | Detail | Status |
|------|--------|--------|
| File | `vector_store.py` | — |
| Qdrant upsert | `client.upsert(collection, [PointStruct(id, vector, payload)])` | IMPLEMENTED |
| UUID generation | `str(uuid.uuid4())` per chunk | IMPLEMENTED |
| In-memory fallback | `_memory_store.append(...)` | IMPLEMENTED |
| Persistence (Qdrant) | On-disk via Qdrant server | IMPLEMENTED |
| Persistence (memory) | **NONE** — lost on restart | KNOWN GAP |
| Duplicate handling | **NONE** — same file creates new points | MISSING |
| User isolation | **NONE** — no `user_id` in payload | MISSING |

### Stage 5: Retrieval
| Item | Detail | Status |
|------|--------|--------|
| File | `vector_store.py` → `similarity_search()` | — |
| Qdrant search | `client.search(query_vector, limit, with_payload=True)` | IMPLEMENTED |
| Memory search | `numpy.dot(q, v)` for all stored vectors → sort | IMPLEMENTED |
| Top-K | Configurable (default 5, max 20 in API) | IMPLEMENTED |
| Score type | Cosine similarity (0-1, higher is better) | IMPLEMENTED |
| Metadata filtering | **NONE** — searches all docs regardless of user/workspace | MISSING |
| BM25/keyword retrieval | **NONE** | MISSING |

### Stage 6: Context Construction
| Item | Detail | Status |
|------|--------|--------|
| File | `rag_engine.py` | — |
| Format | `[Source N: {filename} | Chunk {i} | Relevance: {score:.2%}]\n{text}` | IMPLEMENTED |
| Separator | `\n\n---\n\n` between sources | IMPLEMENTED |
| Truncation | Full chunk text used in context | IMPLEMENTED |
| Max context | Not explicitly limited — depends on LLM token limit | PARTIAL |
| Conversation context | **NOT INCLUDED** — each query is stateless | MISSING |

### Stage 7: LLM Generation
| Item | Detail | Status |
|------|--------|--------|
| File | `llm_service.py` | — |
| Groq call | `Groq().chat.completions.create()` | IMPLEMENTED |
| Gemini call | `GenerativeModel().generate_content()` | IMPLEMENTED |
| Temperature | 0.3 for factual consistency | IMPLEMENTED |
| Max tokens | 1024 (chat), 512 (agent summarize), 768 (agent execute) | IMPLEMENTED |
| Error handling | **NONE** — LLM errors propagate as 500 | MISSING |
| Retry logic | **NONE** | MISSING |
| Token counting | **NONE** — no checks for context exceeding model limits | MISSING |

### Stage 8: Confidence Scoring
| Item | Detail | Status |
|------|--------|--------|
| Algorithm | `avg(top_3_scores) * 1.15`, capped at 1.0 | IMPLEMENTED |
| Rationale | Slight boost to raw cosine similarity | REASONABLE |
| Issue | If only 1-2 results, avg of fewer scores — not normalized to 3 | MINOR |
| Faithfulness score | **NOT COMPUTED** — confidence only reflects retrieval similarity | MISSING |

### Stage 9: Citation Formatting
| Item | Detail | Status |
|------|--------|--------|
| Fields | `filename, chunk_index, excerpt (200 chars), score` | IMPLEMENTED |
| Completeness | All retrieved chunks cited | IMPLEMENTED |
| Page number | **NOT INCLUDED** | MISSING |
| Character position | **NOT INCLUDED** | MISSING |
| Deep link to source | **NOT IMPLEMENTED** | MISSING |

---

## 3. Duplicate Ingestion Behavior
When the same file is uploaded twice:
1. `extract_text()` runs again → same text
2. `chunk_text()` runs again → same chunks
3. `embed_texts()` generates same (or near-same) vectors
4. `add_documents()` calls `client.upsert()` with **new UUIDs** → duplicated points

**Result:** Duplicate documents in the vector store. `list_documents()` returns the filename once (deduped by `set()`), but `get_document_count()` returns double the expected count, and retrieval gets duplicate chunks.

**Fix Required:** Check if filename already indexed before ingestion.

---

## 4. Deletion Behavior Verification

**Qdrant path:**
```python
client.delete(
    collection_name=settings.QDRANT_COLLECTION,
    points_selector=Filter(must=[FieldCondition(key="filename", match=MatchValue(value=filename))])
)
```
→ Deletes ALL points with matching filename payload. Returns operation result, not count.  
→ `delete_documents()` returns `1` always from Qdrant path — inaccurate count.

**Memory path:**
```python
_memory_store[:] = [c for c in _memory_store if c["filename"] != filename]
```
→ Correct filter-based deletion. Returns `before - after` as actual count.

---

## 5. What is Missing for Full Level 2 RAG

| Feature | Gap | Priority |
|---------|-----|---------|
| BM25/keyword search | Full hybrid retrieval impossible without it | P1 |
| Retrieval fusion (RRF) | Need to merge semantic + keyword ranked lists | P1 |
| Reranking model | Cross-encoder to improve top-K quality | P1 |
| Conversation history in context | Multi-turn chat not implemented | P1 |
| User/workspace filtering | All users share same vector space | P0 |
| Token budget management | Long documents may exceed LLM context window | P2 |
| LLM error handling | LLM failures crash the endpoint with 500 | P1 |
| Duplicate detection | Re-upload creates vector duplicates | P1 |
| Page number in citations | Better source attribution | P2 |
