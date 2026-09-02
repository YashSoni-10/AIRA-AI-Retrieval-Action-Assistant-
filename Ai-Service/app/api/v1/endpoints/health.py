from fastapi import APIRouter
from app.core.config import settings
from app.services.vector_store import get_document_count

router = APIRouter()


@router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "llm_provider": settings.LLM_PROVIDER,
        "indexed_vectors": get_document_count(),
    }
