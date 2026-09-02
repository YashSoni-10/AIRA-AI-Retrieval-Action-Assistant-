"""
RAG Engine - Retrieval Augmented Generation with grounding and citations.
Retrieves relevant chunks from vector store, builds context, calls LLM,
and returns a structured response with confidence score and citations.
"""
from __future__ import annotations
import logging
from app.services.vector_store import similarity_search
from app.services.llm_service import get_llm_response

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are AIRA, an expert enterprise AI assistant. Your task is to answer the user's question STRICTLY based on the provided context passages.

Rules:
- If the context contains relevant information, use it to give a thorough, accurate answer.
- Always cite the source documents you used in your answer.
- If the context does NOT contain enough information, say so clearly rather than guessing.
- Format your response in clean, readable markdown.
- Be professional, precise, and concise.
"""


def run_rag_query(query: str, top_k: int = 5) -> dict:
    """
    Full RAG pipeline:
    1. Embed query and retrieve top_k relevant chunks
    2. Build grounded context
    3. Call LLM with context
    4. Return structured response with citations and confidence

    Returns:
        {
            answer: str,
            confidence: float,          # 0.0 - 1.0
            confidence_label: str,      # "High" | "Medium" | "Low"
            reasoning_steps: list[str],
            citations: list[{filename, chunk_index, excerpt, score}],
            chunks_found: int,
        }
    """
    reasoning_steps = []

    # Step 1: Semantic retrieval
    reasoning_steps.append(f"Searching knowledge base for: '{query}'")
    results = similarity_search(query, top_k=top_k)
    reasoning_steps.append(f"Retrieved {len(results)} relevant passages")

    if not results:
        return {
            "answer": "I couldn't find any relevant information in the knowledge base. Please upload documents first, then ask your question.",
            "confidence": 0.0,
            "confidence_label": "Low",
            "reasoning_steps": reasoning_steps,
            "citations": [],
            "chunks_found": 0,
        }

    # Step 2: Build context
    reasoning_steps.append("Analysing and ranking retrieved passages")
    context_parts = []
    for i, chunk in enumerate(results):
        context_parts.append(
            f"[Source {i+1}: {chunk['filename']} | Chunk {chunk['chunk_index']} | Relevance: {chunk['score']:.2%}]\n{chunk['text']}"
        )
    context = "\n\n---\n\n".join(context_parts)

    # Step 3: Build prompt
    user_prompt = f"""Context from the knowledge base:

{context}

---

User Question: {query}

Please answer the question based on the context above. Mention which sources you used."""

    # Step 4: Call LLM
    reasoning_steps.append("Generating grounded answer using LLM")
    answer = get_llm_response(SYSTEM_PROMPT, user_prompt, max_tokens=1024)

    # Step 5: Calculate confidence from top retrieval scores
    top_scores = [r["score"] for r in results[:3]]
    avg_score = sum(top_scores) / len(top_scores) if top_scores else 0.0
    confidence = round(min(avg_score * 1.15, 1.0), 3)  # slight boost, capped at 1.0

    if confidence >= 0.75:
        confidence_label = "High"
    elif confidence >= 0.45:
        confidence_label = "Medium"
    else:
        confidence_label = "Low"

    reasoning_steps.append(f"Confidence assessment: {confidence_label} ({confidence:.0%})")

    # Step 6: Format citations
    citations = [
        {
            "filename": r["filename"],
            "chunk_index": r["chunk_index"],
            "excerpt": r["text"][:200] + "..." if len(r["text"]) > 200 else r["text"],
            "score": r["score"],
        }
        for r in results
    ]

    return {
        "answer": answer,
        "confidence": confidence,
        "confidence_label": confidence_label,
        "reasoning_steps": reasoning_steps,
        "citations": citations,
        "chunks_found": len(results),
    }
