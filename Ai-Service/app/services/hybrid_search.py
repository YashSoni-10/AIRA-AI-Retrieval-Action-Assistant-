"""
Hybrid Search Service — AIRA AI Service (Phase D)
===================================================
Combines Semantic (Vector / Qdrant) retrieval and BM25 (Keyword) retrieval
using Reciprocal Rank Fusion (RRF).

Formula:
    RRF_score(doc) = Σ [ 1 / (k + rank) ]
    where k = settings.RRF_K (default: 60)
    and rank is 1-indexed position in the respective retriever list.

Key Features:
- Preserves all chunk metadata (text, filename, chunk_index, document_id, page_number).
- Deduplicates identical chunks across retrievers.
- Tracks provenance: semantic_score, bm25_score, semantic_rank, bm25_rank.
- Strict workspace and user isolation.
- Graceful fallbacks: if either retriever is empty or fails, returns the other.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.core.config import settings
from app.services.vector_store import similarity_search
from app.services.bm25_service import search_bm25

logger = logging.getLogger(__name__)


def _chunk_key(chunk: dict) -> str:
    """Generate a unique deduplication key for a chunk."""
    doc_id = chunk.get("document_id") or ""
    filename = chunk.get("filename") or ""
    chunk_idx = str(chunk.get("chunk_index", 0))
    if doc_id:
        return f"{doc_id}:{chunk_idx}"
    return f"{filename}:{chunk_idx}"


def rrf_fuse(
    semantic_results: list[dict],
    bm25_results: list[dict],
    k: int = 60,
    top_k: int = 5,
) -> list[dict]:
    """
    Combine two ranked result lists using Reciprocal Rank Fusion.

    Parameters:
        semantic_results: List of chunks ranked by cosine similarity (top-1 first).
        bm25_results: List of chunks ranked by BM25 score (top-1 first).
        k: Smoothing constant (default: 60).
        top_k: Number of fused results to return.

    Returns:
        Deduplicated list of chunks sorted descending by RRF score.
    """
    fused: dict[str, dict] = {}

    # Score from semantic results
    for rank, item in enumerate(semantic_results, start=1):
        key = _chunk_key(item)
        if key not in fused:
            fused[key] = {
                "chunk": dict(item),
                "rrf_score": 0.0,
                "semantic_score": item.get("score"),
                "semantic_rank": rank,
                "bm25_score": None,
                "bm25_rank": None,
            }
        fused[key]["rrf_score"] += 1.0 / (k + rank)
        fused[key]["semantic_score"] = item.get("score")
        fused[key]["semantic_rank"] = rank

    # Score from BM25 results
    for rank, item in enumerate(bm25_results, start=1):
        key = _chunk_key(item)
        if key not in fused:
            fused[key] = {
                "chunk": dict(item),
                "rrf_score": 0.0,
                "semantic_score": None,
                "semantic_rank": None,
                "bm25_score": item.get("score"),
                "bm25_rank": rank,
            }
        fused[key]["rrf_score"] += 1.0 / (k + rank)
        fused[key]["bm25_score"] = item.get("score")
        fused[key]["bm25_rank"] = rank

    if not fused:
        return []

    # Sort candidates descending by RRF score
    sorted_items = sorted(fused.values(), key=lambda x: x["rrf_score"], reverse=True)

    results = []
    for entry in sorted_items[:top_k]:
        chunk = entry["chunk"]
        chunk["rrf_score"] = round(entry["rrf_score"], 6)
        # Set primary score to rrf_score
        chunk["score"] = chunk["rrf_score"]
        chunk["semantic_score"] = entry["semantic_score"]
        chunk["bm25_score"] = entry["bm25_score"]
        chunk["semantic_rank"] = entry["semantic_rank"]
        chunk["bm25_rank"] = entry["bm25_rank"]
        chunk["retrieval_mode"] = "hybrid"
        results.append(chunk)

    return results


def hybrid_search(
    query: str,
    top_k: int = 5,
    user_id: str = "",
    workspace_id: str = "",
    mode: str = "hybrid",
    k_rrf: Optional[int] = None,
) -> list[dict]:
    """
    Search documents using the specified retrieval mode.

    Modes:
      - "hybrid": Run both semantic and BM25 retrieval, merge via RRF (default).
      - "semantic": Pure vector similarity search.
      - "bm25": Pure keyword search.

    Parameters:
        query: User search text.
        top_k: Number of results to return.
        user_id: Authenticated user ID (isolation).
        workspace_id: Authenticated workspace ID (isolation).
        mode: "hybrid" | "semantic" | "bm25".
        k_rrf: Custom RRF constant (defaults to settings.RRF_K).

    Returns:
        List of chunk dicts with {text, filename, chunk_index, score, document_id, page_number}.
    """
    k_constant = k_rrf if k_rrf is not None else settings.RRF_K
    effective_workspace = workspace_id or user_id

    # 1. Pure semantic mode
    if mode == "semantic":
        results = similarity_search(
            query,
            top_k=top_k,
            user_id=user_id,
            workspace_id=effective_workspace,
        )
        for r in results:
            r["retrieval_mode"] = "semantic"
        return results

    # 2. Pure BM25 mode
    if mode == "bm25":
        return search_bm25(
            query,
            top_k=top_k,
            user_id=user_id,
            workspace_id=effective_workspace,
        )

    # 3. Hybrid mode (Semantic + BM25 + RRF)
    # Fetch wider candidate pools (2x top_k) for fusion
    candidate_k = max(top_k * 2, 10)

    semantic_candidates: list[dict] = []
    try:
        semantic_candidates = similarity_search(
            query,
            top_k=candidate_k,
            user_id=user_id,
            workspace_id=effective_workspace,
        )
    except Exception as exc:
        logger.warning("Hybrid: semantic retrieval failed (%s), falling back to BM25", exc)

    bm25_candidates: list[dict] = []
    try:
        bm25_candidates = search_bm25(
            query,
            top_k=candidate_k,
            user_id=user_id,
            workspace_id=effective_workspace,
        )
    except Exception as exc:
        logger.warning("Hybrid: BM25 retrieval failed (%s), falling back to semantic", exc)

    # Fallbacks if either is empty
    if not semantic_candidates and not bm25_candidates:
        return []
    if not semantic_candidates:
        for r in bm25_candidates[:top_k]:
            r["retrieval_mode"] = "bm25_fallback"
        return bm25_candidates[:top_k]
    if not bm25_candidates:
        for r in semantic_candidates[:top_k]:
            r["retrieval_mode"] = "semantic_fallback"
        return semantic_candidates[:top_k]

    return rrf_fuse(
        semantic_candidates,
        bm25_candidates,
        k=k_constant,
        top_k=top_k,
    )
