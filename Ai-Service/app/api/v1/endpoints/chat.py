"""
Chat Endpoint - Grounded RAG Q&A with streaming support.
POST /api/v1/chat        - Standard RAG response (requires Bearer auth)
GET  /api/v1/chat/stream - Server-Sent Events streaming (requires ?token= query param)

Note on streaming auth:
    The GET /chat/stream endpoint uses a ?token= query parameter because the
    browser's native EventSource API cannot set custom headers (W3C spec limitation).
    The token is still cryptographically verified server-side with the same JWT_SECRET.
    This is a temporary solution for local development — the frontend will be upgraded
    to fetch()+ReadableStream before any production deployment.
    The token value is NEVER logged server-side.

Multi-turn conversation context (Phase 2 Milestone 1):
    Both endpoints accept an optional `conversation_id`. When provided, the last
    6 messages for that conversation are fetched from the Node backend and injected
    into the Groq/Gemini messages array so the LLM understands follow-up questions
    such as "Explain the second point" or "Summarise your last answer."
    If fetching history fails (DB down, invalid ID, network error), the request
    proceeds without history — chat is never broken by a DB issue.
"""
import logging
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from app.services.rag_engine import run_rag_query, calculate_confidence, SYSTEM_PROMPT
from app.services.vector_store import similarity_search
from app.services.hybrid_search import hybrid_search
from app.services.reranker_service import rerank, clean_retrieval_query
from app.services.llm_service import get_llm_response
from app.core.auth import get_current_user_id, verify_token_payload, verify_token_string
from app.core.config import settings
import json

router = APIRouter()
logger = logging.getLogger(__name__)

# Node backend URL — used to fetch conversation history.
# Configurable via NODE_BACKEND_URL env var; defaults to localhost:5000.
_NODE_URL = getattr(settings, "NODE_BACKEND_URL", "http://localhost:5000")

# Maximum messages loaded from history (3 user + 3 assistant = 3 prior turns).
_HISTORY_LIMIT = 6


async def _fetch_history(conversation_id: str, token: str) -> list[dict]:
    """
    Fetch the last _HISTORY_LIMIT messages for conversation_id from the Node backend.
    Returns a list of {"role": ..., "content": ...} dicts, oldest-first.
    Returns [] silently on any error — history is always best-effort.
    """
    if not conversation_id or not conversation_id.strip():
        return []
    try:
        url = f"{_NODE_URL}/api/conversations/{conversation_id}/messages"
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(
                url,
                params={"page": 1, "limit": _HISTORY_LIMIT},
                headers={"Authorization": f"Bearer {token}"},
            )
        if resp.status_code != 200:
            logger.debug(
                "History fetch returned %d for conversation %s — proceeding without history",
                resp.status_code, conversation_id,
            )
            return []
        data = resp.json()
        msgs = data.get("messages", [])
        # Build compact history list
        history = []
        for m in msgs:
            role = m.get("role")
            content = m.get("content", "")
            if role in ("user", "assistant") and content:
                history.append({"role": role, "content": content})
        logger.debug("Loaded %d history messages for conversation %s", len(history), conversation_id)
        return history
    except Exception as exc:
        logger.warning("Could not fetch conversation history: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)
    conversation_id: str | None = Field(
        default=None,
        description="Optional MongoDB conversation ID. When provided, prior messages "
                    "are loaded and sent as context so the LLM can answer follow-ups.",
    )


class Citation(BaseModel):
    filename: str
    chunk_index: int
    excerpt: str
    score: float
    page_number: int | None = None
    raw_score: float | None = None
    score_label: str | None = None
    score_type: str | None = None


class ChatResponse(BaseModel):
    answer: str
    confidence: float
    confidence_label: str
    reasoning_steps: list[str]
    citations: list[Citation]
    chunks_found: int
    query: str


# ---------------------------------------------------------------------------
# SSE helper
# ---------------------------------------------------------------------------
# CRITICAL: SSE events MUST be terminated with two REAL newline bytes (0x0A 0x0A).
# Writing `\n\n` inside an f-string that contains other backslash sequences is
# error-prone: if the surrounding context uses raw strings or the file is
# edited, `\\n\\n` (0x5C 0x6E 0x5C 0x6E) can silently replace real newlines.
# This helper uses plain string concatenation so the newlines are always real.
# ---------------------------------------------------------------------------
def _sse(payload: dict) -> str:
    """Return a properly-terminated SSE data line with REAL newline bytes."""
    return "data: " + json.dumps(payload) + "\n\n"


# ---------------------------------------------------------------------------
# POST /chat  (standard non-streaming, Bearer auth)
# ---------------------------------------------------------------------------
@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    http_request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """RAG-powered Q&A endpoint with grounding and citations. Requires authentication."""
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # Extract the raw Bearer token from the Authorization header so we can call
    # the Node backend to fetch conversation history (same pattern as /chat/stream).
    auth_header = http_request.headers.get("Authorization", "")
    raw_token = auth_header[7:] if auth_header.startswith("Bearer ") else ""

    # Fetch conversation history (best-effort — never blocks the response).
    # If fetching fails (network error, invalid ID, DB down), proceeds without history.
    history = await _fetch_history(request.conversation_id or "", raw_token)
    if history:
        logger.info("chat: loaded %d history messages for conversation %s", len(history), request.conversation_id)

    ws_id = user_id
    if raw_token:
        try:
            import jwt
            decoded = jwt.decode(raw_token, options={"verify_signature": False})
            ws_id = decoded.get("workspace_id") or user_id
        except Exception:
            pass

    result = run_rag_query(
        request.query,
        top_k=request.top_k,
        user_id=user_id,
        workspace_id=ws_id,
        history=history,
    )
    return ChatResponse(
        answer=result["answer"],
        confidence=result["confidence"],
        confidence_label=result["confidence_label"],
        reasoning_steps=result["reasoning_steps"],
        citations=[Citation(**c) for c in result["citations"]],
        chunks_found=result["chunks_found"],
        query=request.query,
    )


# ---------------------------------------------------------------------------
# GET /chat/stream  (SSE streaming, ?token= auth)
# ---------------------------------------------------------------------------
@router.get("/chat/stream")
async def chat_stream(
    query: str = Query(..., min_length=1),
    top_k: int = Query(default=5, ge=1, le=20),
    token: str = Query(
        default="",
        description="Bearer JWT — required because EventSource cannot set headers",
    ),
    conversation_id: str = Query(
        default="",
        description="Optional MongoDB conversation ID. Loads prior messages for multi-turn context.",
    ),
):
    """
    Server-Sent Events streaming endpoint.
    Emits events: reasoning_step | token | done | error

    Authentication: JWT passed as ?token= query parameter.
    Token is cryptographically verified and never logged.

    Multi-turn: pass ?conversation_id= to inject prior messages as context.
    """
    # Authenticate — raises 401 if missing/invalid/expired
    payload = verify_token_payload(token)
    user_id = payload["id"]
    ws_id = payload.get("workspace_id") or user_id
    logger.info("chat/stream: request received [user authenticated]")

    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # Fetch conversation history BEFORE starting the stream (best-effort, 3s timeout)
    history = await _fetch_history(conversation_id, token)
    if history:
        logger.info("chat/stream: loaded %d history messages for context", len(history))

    async def event_stream():
        try:
            # ── Step 1: Retrieve context (scoped to authenticated user/workspace) ───────
            logger.info("chat/stream: step 1 — searching knowledge base")
            yield _sse({"type": "reasoning_step", "text": "Searching knowledge base (hybrid mode)..."})

            candidate_k = max(top_k * 2, 12)
            candidates = hybrid_search(query.strip(), top_k=candidate_k, user_id=user_id, workspace_id=ws_id, mode="hybrid")
            logger.info("chat/stream: step 1 — found %d candidates", len(candidates))

            if not candidates:
                logger.info("chat/stream: no results — informing user")
                yield _sse({
                    "type": "token",
                    "text": (
                        "I could not find any relevant information in the knowledge base. "
                        "Please upload documents first."
                    ),
                })
                yield _sse({
                    "type": "done",
                    "confidence": 0.0,
                    "confidence_label": "Low",
                    "citations": [],
                    "chunks_found": 0,
                })
                return

            yield _sse({"type": "reasoning_step", "text": "Applying neural Cross-Encoder reranking..."})
            clean_q = clean_retrieval_query(query.strip())
            context_k = max(top_k, 5)
            results, rerank_lat = rerank(clean_q, candidates, top_k=context_k)
            logger.info("chat/stream: step 1 — reranked %d candidates to %d results in %.1fms", len(candidates), len(results), rerank_lat)
            yield _sse({"type": "reasoning_step", "text": f"Retrieved and reranked {len(results)} relevant passages"})

            # ── Step 2: Build context ─────────────────────────────────────────
            logger.info("chat/stream: step 2 — building context from %d chunks", len(results))
            yield _sse({"type": "reasoning_step", "text": "Analysing passages for grounded context"})

            context_parts = []
            citations = []
            for i, chunk in enumerate(results):
                page_info = f" | Page {chunk['page_number']}" if chunk.get("page_number") else ""
                score_label = chunk.get("score_label") or (
                    f"Score: {chunk.get('score', 0.0):.2f}"
                )
                context_parts.append(
                    f"[Source {i+1}: {chunk['filename']}{page_info} | Chunk {chunk['chunk_index']} | {score_label}]\n{chunk['text']}"
                )
                citations.append({
                    "filename": chunk["filename"],
                    "chunk_index": chunk["chunk_index"],
                    "page_number": chunk.get("page_number"),
                    "excerpt": (
                        chunk["text"][:200] + "..."
                        if len(chunk["text"]) > 200
                        else chunk["text"]
                    ),
                    "score": chunk.get("score", 0.0),
                    "raw_score": chunk.get("raw_score"),
                    "score_label": chunk.get("score_label", ""),
                    "score_type": chunk.get("score_type", "relevance"),
                })
            context = "\n\n---\n\n".join(context_parts)

            # ── Step 3: LLM response (with conversation history) ──────────────
            logger.info("chat/stream: step 3 — requesting LLM response (history=%d msgs)", len(history))
            if history:
                yield _sse({"type": "reasoning_step", "text": f"Using {len(history)} prior messages for context"})
            yield _sse({"type": "reasoning_step", "text": "Generating grounded answer..."})

            user_prompt = f"""Context from the knowledge base:

{context}

---

User Question: {query}

Please answer the question based on the context above. Mention which sources you used."""

            # Stream tokens from LLM as they arrive (real-time, not buffered)
            from app.services.llm_service import stream_llm_response
            answer_parts: list[str] = []
            try:
                for chunk in stream_llm_response(SYSTEM_PROMPT, user_prompt, max_tokens=1024, history=history):
                    if chunk:
                        answer_parts.append(chunk)
                        yield _sse({"type": "token", "text": chunk})
            except RuntimeError as llm_err:
                logger.error("chat/stream: LLM streaming error — %s", llm_err)
                yield _sse({"type": "error", "message": str(llm_err)})
                return

            answer = "".join(answer_parts)
            logger.info("chat/stream: LLM streaming complete, %d chars total", len(answer))

            # ── Step 4: Done event ────────────────────────────────────────────
            confidence, confidence_label = calculate_confidence(results)
            logger.info("chat/stream: emitting done (confidence=%s %.2f)", confidence_label, confidence)
            yield _sse({
                "type": "done",
                "confidence": confidence,
                "confidence_label": confidence_label,
                "citations": citations,
                "chunks_found": len(results),
            })

        except HTTPException as exc:
            logger.warning("chat/stream: HTTPException — %s", exc.detail)
            yield _sse({"type": "error", "message": exc.detail})
        except Exception as exc:
            logger.error("chat/stream: unexpected error — %s: %s", type(exc).__name__, exc)
            yield _sse({
                "type": "error",
                "message": f"An unexpected error occurred: {type(exc).__name__}",
            })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
