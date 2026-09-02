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
)

# ── CORS Middleware ────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN, "http://localhost:5173", "http://localhost:3000"],
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
    logger.info(f"   Frontend URL : {settings.FRONTEND_ORIGIN}")
    logger.info(f"   Docs         : http://localhost:8000/docs")


@app.get("/")
async def root():
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/docs",
        "api": "/api/v1",
    }
