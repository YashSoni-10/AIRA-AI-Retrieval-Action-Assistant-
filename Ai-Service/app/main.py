"""
AIRA AI Service - FastAPI Application Entry Point
Runs on http://localhost:8000
"""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.router import api_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ── FastAPI App ────────────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AIRA Python AI Backend — RAG Engine, Vector Store & Agent Workforce",
    docs_url="/docs",
    redoc_url="/redoc",
    swagger_ui_parameters={"persistAuthorization": True},
)

# ── CORS Middleware ────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_ORIGIN,
        "http://localhost:5173",
        "http://localhost:5174",   # Vite fallback port when 5173 is occupied
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Mount API Router ───────────────────────────────────────────────────────────
app.include_router(api_router, prefix="/api/v1")


@app.on_event("startup")
async def startup_event():
    logger.info(f"🚀 {settings.APP_NAME} v{settings.APP_VERSION} starting up")
    logger.info(f"   LLM Provider : {settings.LLM_PROVIDER}")
    logger.info(f"   Groq Key     : {'✅ set' if settings.GROQ_API_KEY else '❌ not set'}")
    logger.info(f"   Gemini Key   : {'✅ set' if settings.GEMINI_API_KEY else '❌ not set'}")
    logger.info(f"   JWT Secret   : {'✅ set' if settings.JWT_SECRET else '❌ NOT SET'}")
    logger.info(f"   Frontend URL : {settings.FRONTEND_ORIGIN}")
    logger.info(f"   Docs         : http://localhost:8000/docs")
    if not settings.JWT_SECRET:
        logger.critical("=" * 60)
        logger.critical("FATAL: JWT_SECRET is not configured.")
        logger.critical("All protected endpoints will return HTTP 503.")
        logger.critical("Add JWT_SECRET to Ai-Service/.env — must match backend/.env exactly.")
        logger.critical("=" * 60)

    # Pre-warm reranker
    if settings.ENABLE_RERANKER:
        from app.services.reranker_service import warm_up_reranker
        warm_up_reranker()
        logger.info("   Reranker    : pre-warmed at startup")
    else:
        logger.info("   Reranker    : disabled")


@app.get("/")
async def root():
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/docs",
        "api": "/api/v1",
    }
