"""
Search Endpoint - Direct semantic knowledge base search (without LLM generation).
GET /api/v1/search?q=<query>&top_k=<n>
"""
from fastapi import APIRouter, Query
from app.services.vector_store import similarity_search

router = APIRouter()


@router.get("/search")
async def search_knowledge(
    q: str = Query(..., min_length=1, description="Search query"),
    top_k: int = Query(default=5, ge=1, le=20, description="Number of results"),
):
    """Semantic search in the knowledge base. Returns raw chunks without LLM synthesis."""
    results = similarity_search(q, top_k=top_k)
    return {
        "query": q,
        "results": results,
        "count": len(results),
    }
