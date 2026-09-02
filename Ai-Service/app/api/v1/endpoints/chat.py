"""
Chat Endpoint - Grounded RAG Q&A with streaming support.
POST /api/v1/chat        - Standard RAG response
GET  /api/v1/chat/stream - Server-Sent Events streaming response
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from app.services.rag_engine import run_rag_query
from app.services.vector_store import similarity_search
from app.services.llm_service import get_llm_response
from app.core.config import settings
import json

router = APIRouter()

RAG_SYSTEM_PROMPT = """You are AIRA, an expert enterprise AI assistant. Answer the user's question STRICTLY based on the provided context passages. Be professional, precise, and concise. Format your response in clean markdown."""


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)


class Citation(BaseModel):
    filename: str
    chunk_index: int
    excerpt: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    confidence: float
    confidence_label: str
    reasoning_steps: list[str]
    citations: list[Citation]
    chunks_found: int
    query: str


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """RAG-powered Q&A endpoint with grounding and citations."""
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    result = run_rag_query(request.query, top_k=request.top_k)
    return ChatResponse(
        answer=result["answer"],
        confidence=result["confidence"],
        confidence_label=result["confidence_label"],
        reasoning_steps=result["reasoning_steps"],
        citations=[Citation(**c) for c in result["citations"]],
        chunks_found=result["chunks_found"],
        query=request.query,
    )


@router.get("/chat/stream")
async def chat_stream(query: str, top_k: int = 5):
    """
    Server-Sent Events streaming endpoint.
    Sends events: reasoning_step | citation | token | done | error
    """
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    async def event_stream():
        try:
            # Step 1: Retrieve context
            yield f"data: {json.dumps({'type': 'reasoning_step', 'text': 'Searching knowledge base...'})}\n\n"
            results = similarity_search(query.strip(), top_k=top_k)

            yield f"data: {json.dumps({'type': 'reasoning_step', 'text': f'Retrieved {len(results)} relevant passages'})}\n\n"

            if not results:
                yield f"data: {json.dumps({'type': 'token', 'text': 'I could not find any relevant information in the knowledge base. Please upload documents first.'})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'confidence': 0.0, 'confidence_label': 'Low', 'citations': [], 'chunks_found': 0})}\n\n"
                return

            # Step 2: Build context
            yield f"data: {json.dumps({'type': 'reasoning_step', 'text': 'Analysing and ranking retrieved passages'})}\n\n"
            context_parts = []
            citations = []
            for i, chunk in enumerate(results):
                context_parts.append(
                    f"[Source {i+1}: {chunk['filename']} | Chunk {chunk['chunk_index']} | Relevance: {chunk['score']:.2%}]\n{chunk['text']}"
                )
                citations.append({
                    "filename": chunk["filename"],
                    "chunk_index": chunk["chunk_index"],
                    "excerpt": chunk["text"][:200] + "..." if len(chunk["text"]) > 200 else chunk["text"],
                    "score": chunk["score"],
                })
            context = "\n\n---\n\n".join(context_parts)

            # Step 3: Stream LLM response
            yield f"data: {json.dumps({'type': 'reasoning_step', 'text': 'Generating grounded answer...'})}\n\n"

            user_prompt = f"""Context from the knowledge base:

{context}

---

User Question: {query}

Answer based on the context above. Mention which sources you used."""

            # Stream token by token (simulated with Groq non-streaming + word-by-word emit)
            answer = get_llm_response(RAG_SYSTEM_PROMPT, user_prompt, max_tokens=1024)

            # Emit words one by one for streaming effect
            words = answer.split(" ")
            for i, word in enumerate(words):
                text = word if i == 0 else " " + word
                yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"

            # Confidence
            top_scores = [r["score"] for r in results[:3]]
            avg_score = sum(top_scores) / len(top_scores) if top_scores else 0.0
            confidence = round(min(avg_score * 1.15, 1.0), 3)
            confidence_label = "High" if confidence >= 0.75 else "Medium" if confidence >= 0.45 else "Low"

            yield f"data: {json.dumps({'type': 'done', 'confidence': confidence, 'confidence_label': confidence_label, 'citations': citations, 'chunks_found': len(results)})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
