# AIRA — Hybrid Search Audit
**Date:** 2026-09-09

---

## Verdict: NOT IMPLEMENTED

The AIRA codebase contains **only semantic (vector) search**. There is no hybrid retrieval system.

---

## What Hybrid Search Requires

A proper hybrid search system combines:

1. **Semantic Search** — vector similarity (dense retrieval)
2. **Keyword Search** — lexical matching (sparse retrieval, e.g. BM25, TF-IDF)
3. **Score Fusion** — merging ranked lists (e.g. Reciprocal Rank Fusion, linear combination)
4. **Reranking** — optional cross-encoder reranking of fused results

---

## What Currently Exists

### Semantic Search ✅
- **File:** `Ai-Service/app/services/vector_store.py`
- **Function:** `similarity_search(query, top_k)`
- **Method:** Cosine similarity between `embed_query(query)` and stored vectors
- **Qdrant path:** `client.search(query_vector, limit, with_payload=True)`
- **Memory path:** `numpy.dot(q_vec, stored_vec)` for each item

### Keyword Search ❌
- **BM25:** NOT IMPLEMENTED
- **TF-IDF:** NOT IMPLEMENTED
- **Elasticsearch:** NOT IMPLEMENTED
- **Qdrant sparse vectors:** NOT IMPLEMENTED
- No sparse retrieval of any kind exists.

### Score Normalization ❌
- NOT IMPLEMENTED

### Retrieval Fusion ❌
- **Reciprocal Rank Fusion (RRF):** NOT IMPLEMENTED
- **Linear combination:** NOT IMPLEMENTED
- No fusion strategy exists.

### Reranking ❌
- **Cross-encoder model:** NOT IMPLEMENTED
- **FlashRank/ColBERT:** NOT IMPLEMENTED
- **Groq/Gemini reranking:** NOT IMPLEMENTED

---

## How to Implement Hybrid Search (Plan, NOT yet implemented)

### Option A: BM25 with rank_bm25 library (lightweight)
```python
from rank_bm25 import BM25Okapi

# At index time: tokenize and store all chunks
bm25 = BM25Okapi([chunk["text"].split() for chunk in all_chunks])

# At query time
bm25_scores = bm25.get_scores(query.split())
# → Merge with cosine scores using RRF
```

### Option B: Qdrant Sparse Vectors (production-grade)
- Store sparse BM25/SPLADE vectors alongside dense vectors in Qdrant
- Use Qdrant's hybrid search API

### Reciprocal Rank Fusion (RRF)
```python
def reciprocal_rank_fusion(dense_results, sparse_results, k=60):
    scores = {}
    for rank, item in enumerate(dense_results):
        scores[item["id"]] = scores.get(item["id"], 0) + 1/(k + rank + 1)
    for rank, item in enumerate(sparse_results):
        scores[item["id"]] = scores.get(item["id"], 0) + 1/(k + rank + 1)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)
```

---

## Conclusion

| Component | Status |
|-----------|--------|
| Dense (semantic) retrieval | ✅ IMPLEMENTED |
| Sparse (keyword) retrieval | ❌ NOT IMPLEMENTED |
| Score normalization | ❌ NOT IMPLEMENTED |
| Retrieval fusion | ❌ NOT IMPLEMENTED |
| **Hybrid Search overall** | **❌ NOT IMPLEMENTED** |

Calling the current system "hybrid search" would be false. It is pure vector similarity search.
