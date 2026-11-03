"""
Health Endpoint - Public service health check.
GET /api/v1/health — Returns service status, LLM provider, and Qdrant connection info.
"""
from fastapi import APIRouter
from app.core.config import settings
from app.services.vector_store import get_vector_store_status

router = APIRouter()


@router.get("/health")
async def health_check():
    """Public health endpoint — no authentication required."""
    vs_status = get_vector_store_status()
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "llm_provider": settings.LLM_PROVIDER,
        "vector_store": {
            "mode": vs_status.get("mode", "unknown"),
            "collection": vs_status.get("collection", settings.QDRANT_COLLECTION),
            "vectors": vs_status.get("vectors", 0),
            "dimension": settings.EMBEDDING_DIM,
            "warning": vs_status.get("warning"),
            "error": vs_status.get("error"),
        },
        # Legacy field kept for backward compatibility
        "indexed_vectors": vs_status.get("vectors", 0),
    }
