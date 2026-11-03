import os
from dotenv import load_dotenv

# Load .env into os.environ so that os.getenv() and os.environ[] both work.
# override=True ensures .env values win over any pre-existing shell environment.
load_dotenv(override=True)


class Settings:
    # App
    APP_NAME: str = "AIRA AI Service"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # CORS
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

    # LLM Provider: "groq" | "gemini" | "local"
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "groq")

    # API Keys
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

    # Groq Model
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

    # Gemini Model
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

    # Qdrant — remote server (optional; used if QDRANT_HOST is reachable)
    QDRANT_HOST: str = os.getenv("QDRANT_HOST", "localhost")
    QDRANT_PORT: int = int(os.getenv("QDRANT_PORT", "6333"))
    QDRANT_COLLECTION: str = os.getenv("QDRANT_COLLECTION", "aira_knowledge")

    # Qdrant — local embedded persistence (used when QDRANT_LOCAL_PATH is set
    # and the remote server is not reachable).  Data is stored on disk so it
    # survives AI service restarts.  Set to "" to disable (use remote server only).
    QDRANT_LOCAL_PATH: str = os.getenv("QDRANT_LOCAL_PATH", "./qdrant_storage")

    # In-memory fallback: only used when ALLOW_MEMORY_FALLBACK=true in .env.
    # NEVER the default — keeps the system honest about persistence.
    ALLOW_MEMORY_FALLBACK: bool = os.getenv("ALLOW_MEMORY_FALLBACK", "false").lower() == "true"

    # Embeddings
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    EMBEDDING_DIM: int = 384

    # GitHub Integration
    GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")
    GITHUB_REPO: str = os.getenv("GITHUB_REPO", "")

    # JWT — shared secret with Node.js auth backend (must be identical).
    # Implemented as a @property so it reads os.environ at every call instead
    # of being frozen to the value present at class-parse time.
    @property
    def JWT_SECRET(self) -> str:  # noqa: N802
        return os.environ.get("JWT_SECRET", "")

    # Document Chunking
    CHUNK_SIZE: int = int(os.getenv("CHUNK_SIZE", "500"))
    CHUNK_OVERLAP: int = int(os.getenv("CHUNK_OVERLAP", "50"))

    # Node backend base URL (for the AI service to call MongoDB-backed endpoints)
    NODE_BACKEND_URL: str = os.getenv("NODE_BACKEND_URL", "http://localhost:5000")

    # BM25 Storage (Phase C)
    BM25_STORAGE_PATH: str = os.getenv("BM25_STORAGE_PATH", "./bm25_storage")

    # Hybrid Search RRF constant (Phase D)
    RRF_K: int = int(os.getenv("RRF_K", "60"))

    # Cross-Encoder Reranking (Phase E)
    ENABLE_RERANKER: bool = os.getenv("ENABLE_RERANKER", "true").lower() == "true"
    RERANKER_MODEL: str = os.getenv("RERANKER_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
    RERANKER_TOP_K: int = int(os.getenv("RERANKER_TOP_K", "5"))
    RERANKER_CANDIDATES: int = int(os.getenv("RERANKER_CANDIDATES", "20"))


settings = Settings()
