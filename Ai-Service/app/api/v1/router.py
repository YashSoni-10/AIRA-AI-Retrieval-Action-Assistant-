from fastapi import APIRouter
from app.api.v1.endpoints import health, ingest, chat, search, agents, github

api_router = APIRouter()

api_router.include_router(health.router, tags=["Health"])
api_router.include_router(ingest.router, tags=["Document Ingestion"])
api_router.include_router(chat.router, tags=["RAG Chat"])
api_router.include_router(search.router, tags=["Knowledge Search"])
api_router.include_router(agents.router, tags=["AI Agents"])
api_router.include_router(github.router, prefix="/github", tags=["GitHub Integration"])
