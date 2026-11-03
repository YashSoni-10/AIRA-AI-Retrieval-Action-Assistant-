"""
Search Endpoint — AIRA AI Service (Phases C, D, E)
===================================================
Direct knowledge base retrieval supporting:
- mode=hybrid   (Semantic + BM25 + Reciprocal Rank Fusion) [default]
- mode=semantic (Pure Vector / Qdrant cosine similarity)
- mode=bm25     (Pure BM25Okapi keyword retrieval)
- Optional Cross-Encoder reranking (ms-marco-MiniLM-L-6-v2)

GET /api/v1/search?q=<query>&mode=hybrid&top_k=<n>&rerank=true&workspace_id=<id>

Requires a valid Bearer JWT (issued by Node.js auth backend).
Results are strictly filtered by user_id and workspace_id.
"""

from fastapi import APIRouter, Depends, Query
from app.core.auth import get_current_user_id
from app.core.config import settings
from app.services.hybrid_search import hybrid_search
from app.services.reranker_service import rerank

router = APIRouter()


@router.get("/search")
async def search_knowledge(
    q: str = Query(..., min_length=1, description="Search query"),
    mode: str = Query(
        default="hybrid",
        pattern="^(hybrid|semantic|bm25)$",
        description="Retrieval mode: 'hybrid' (default), 'semantic', or 'bm25'",
    ),
    top_k: int = Query(default=5, ge=1, le=20, description="Number of results to return"),
    rerank_results: bool = Query(
        default=True,
        alias="rerank",
        description="Enable neural Cross-Encoder reranking for top candidates",
    ),
    workspace_id: str = Query(default="", description="Workspace ID filter (optional)"),
    user_id: str = Depends(get_current_user_id),
):
    """
    Search chunks in the user's workspace knowledge base.
    Returns ranked chunks with provenance scores and retrieval metadata.
    """
    effective_workspace_id = workspace_id or user_id

    # If reranking is requested, retrieve a wider candidate pool first
    candidate_k = max(top_k * 2, settings.RERANKER_CANDIDATES) if rerank_results else top_k

    candidates = hybrid_search(
        query=q,
        top_k=candidate_k,
        user_id=user_id,
        workspace_id=effective_workspace_id,
        mode=mode,
    )

    rerank_latency_ms = 0.0
    is_reranked = False

    if rerank_results and candidates:
        results, rerank_latency_ms = rerank(query=q, candidates=candidates, top_k=top_k)
        is_reranked = any(r.get("reranked") for r in results)
    else:
        results = candidates[:top_k]

    return {
        "query": q,
        "mode": mode,
        "results": results,
        "count": len(results),
        "reranked": is_reranked,
        "rerank_latency_ms": rerank_latency_ms,
    }
