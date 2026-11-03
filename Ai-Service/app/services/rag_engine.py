"""
RAG Engine — Retrieval Augmented Generation with grounding and citations.
==========================================================================
Retrieves relevant chunks using Hybrid Search (Semantic + BM25 + RRF),
applies neural Cross-Encoder reranking, builds grounded context,
calls LLM, and returns a structured response with confidence and citations.
"""
from __future__ import annotations
import logging
from app.services.hybrid_search import hybrid_search
from app.services.reranker_service import rerank
from app.services.vector_store import similarity_search
from app.services.llm_service import get_llm_response

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are AIRA, an enterprise AI knowledge assistant. Answer based STRICTLY on the provided context passages. Do not invent information.

Response format:
1. **Direct answer** first (1–3 sentences).
2. **Numbered steps** for workflows or processes.
3. **Key technologies/files** only if supported by the sources.
4. **Citations** — mention which source (filename, page if available) you used.
5. **Gaps** — briefly note any missing implementation details not covered by the sources.

Rules:
- Be concise. Prefer numbered lists over long paragraphs.
- Use tables ONLY when comparing 2+ items side-by-side.
- If a topic is not in the context, say so — never fabricate.
- Cite sources inline: e.g. (Source 1: filename.pdf, Page 3).
"""


def calculate_confidence(results: list[dict]) -> tuple[float, str]:
    """
    Compute a statistically grounded confidence score (0.0 to 1.0) and label
    ('High' | 'Medium' | 'Low') based on top retrieval and reranking scores.
    """
    if not results:
        return 0.0, "Low"

    top_scores = [r.get("score", 0.0) for r in results[:3]]
    best_score = top_scores[0] if top_scores else 0.0

    if any(r.get("reranked") for r in results):
        # Raw Cross-Encoder logit is stored in raw_score (or score if legacy)
        best_logit = max((r.get("raw_score", r.get("score", 0.0)) for r in results[:3]), default=0.0)
        best_prob = max((r.get("relevance_score", r.get("score", 0.0)) for r in results[:3]), default=0.0)

        # Calibrated multi-tier confidence combining logit and probability
        if best_logit >= 1.0 or best_prob >= 0.73:
            prob_bonus = max(0.0, (best_prob - 0.73) / 0.27) * 0.15
            logit_bonus = max(0.0, best_logit - 1.0) * 0.04
            confidence = min(round(0.80 + max(prob_bonus, logit_bonus), 2), 0.98)
        elif best_logit >= -1.5 or best_prob >= 0.18:
            confidence = round(0.50 + ((best_logit + 1.5) / 2.5) * 0.25, 2)
        elif best_logit >= -5.0 or best_prob >= 0.01:
            confidence = round(0.20 + ((best_logit + 5.0) / 3.5) * 0.22, 2)
        else:
            confidence = max(0.10, round(0.10 + ((best_logit + 10.0) / 5.0) * 0.10, 2))
    elif any(r.get("retrieval_mode") == "hybrid" for r in results) or any("rrf_score" in r for r in results):
        # RRF score: 1/(60+rank1) + 1/(60+rank2), theoretical maximum ~ 0.0328
        norm = best_score / 0.0328
        if norm >= 0.8:
            confidence = min(round(0.80 + (norm - 0.8) * 0.75, 2), 0.95)
        elif norm >= 0.45:
            confidence = round(0.60 + (norm - 0.45) * 0.55, 2)
        elif norm >= 0.25:
            confidence = round(0.40 + (norm - 0.25) * 0.80, 2)
        else:
            confidence = max(round(norm * 1.5, 2), 0.20)
    else:
        # Pure semantic cosine similarity [0.0 - 1.0]
        if best_score >= 0.75:
            confidence = min(round(best_score * 1.05, 2), 0.98)
        elif best_score >= 0.55:
            confidence = round(best_score * 0.95, 2)
        else:
            confidence = round(max(best_score * 0.8, 0.1), 2)

    confidence = max(0.0, min(1.0, confidence))
    if confidence >= 0.75:
        label = "High"
    elif confidence >= 0.45:
        label = "Medium"
    else:
        label = "Low"

    return confidence, label


def run_rag_query(
    query: str,
    top_k: int = 5,
    user_id: str = "",
    workspace_id: str = "",
    history: list[dict] | None = None,
    mode: str = "hybrid",
    enable_rerank: bool = True,
) -> dict:
    """
    Full RAG pipeline, scoped to a specific user/workspace:
    1. Hybrid retrieval (Semantic + BM25 + RRF)
    2. Neural Cross-Encoder reranking
    3. Build grounded context
    4. Call LLM with context
    5. Return structured response with citations and confidence
    """
    reasoning_steps = []
    effective_workspace_id = workspace_id or user_id

    # Retrieve sufficient context chunks (at least 5 for multi-component architectural breadth)
    context_k = max(top_k, 5) if enable_rerank else top_k

    # Step 1: Hybrid retrieval (Semantic + BM25 + RRF)
    reasoning_steps.append(f"Searching knowledge base for: '{query}' (mode={mode})")
    try:
        candidate_k = max(context_k * 2, 12) if enable_rerank else context_k
        candidates = hybrid_search(
            query,
            top_k=candidate_k,
            user_id=user_id,
            workspace_id=effective_workspace_id,
            mode=mode,
        )

        if enable_rerank and candidates:
            reasoning_steps.append("Applying neural Cross-Encoder reranking")
            results, rerank_lat = rerank(query, candidates, top_k=context_k)
            if rerank_lat > 0:
                reasoning_steps.append(f"Reranking completed in {rerank_lat:.1f}ms")
        else:
            results = candidates[:context_k]

    except Exception as e:
        logger.error("Hybrid retrieval failed during RAG query, falling back to pure vector: %s", e)
        try:
            results = similarity_search(
                query,
                top_k=context_k,
                user_id=user_id,
                workspace_id=effective_workspace_id,
            )
        except RuntimeError as sem_err:
            logger.error("Vector store unavailable during RAG query fallback: %s", sem_err)
            return {
                "answer": "The knowledge base is currently unavailable. Please try again later.",
                "confidence": 0.0,
                "confidence_label": "Low",
                "reasoning_steps": ["Vector store error: " + str(sem_err)],
                "citations": [],
                "chunks_found": 0,
                "query": query,
            }

    reasoning_steps.append(f"Retrieved {len(results)} relevant passages")

    if not results:
        return {
            "answer": "I couldn't find any relevant information in your knowledge base. Please upload documents first, then ask your question.",
            "confidence": 0.0,
            "confidence_label": "Low",
            "reasoning_steps": reasoning_steps,
            "citations": [],
            "chunks_found": 0,
            "query": query,
        }

    # Step 2: Build context
    reasoning_steps.append("Analysing and ranking retrieved passages")
    context_parts = []
    for i, chunk in enumerate(results):
        page_info = f" | Page {chunk['page_number']}" if chunk.get("page_number") else ""
        label = chunk.get("score_label") or (f"{int(chunk['score'] * 100)}% Match" if isinstance(chunk.get("score"), (int, float)) and 0.0 <= chunk["score"] <= 1.0 else "")
        label_str = f" | {label}" if label else ""
        context_parts.append(
            f"[Source {i+1}: {chunk['filename']}{page_info} | Chunk {chunk['chunk_index']}{label_str}]\n{chunk['text']}"
        )
    context = "\n\n---\n\n".join(context_parts)

    # Step 3: Build prompt
    user_prompt = f"""Context from the knowledge base:

{context}

---

User Question: {query}

Please answer the question based on the context above. Mention which sources you used."""

    # Step 4: Call LLM with expanded max_tokens for complete flows
    reasoning_steps.append("Generating grounded answer using LLM")
    try:
        answer = get_llm_response(SYSTEM_PROMPT, user_prompt, max_tokens=1024, history=history or [])
    except Exception as e:
        logger.error("LLM call failed: %s", e)
        return {
            "answer": "The AI model is currently unavailable. Please try again in a moment.",
            "confidence": 0.0,
            "confidence_label": "Low",
            "reasoning_steps": reasoning_steps + ["LLM error — response unavailable"],
            "citations": [],
            "chunks_found": len(results),
            "query": query,
        }

    # Step 5: Calculate confidence from top retrieval scores
    confidence, confidence_label = calculate_confidence(results)
    reasoning_steps.append(f"Confidence assessment: {confidence_label} ({confidence:.0%})")

    # Step 6: Format citations with clean score metadata
    citations = [
        {
            "filename": r["filename"],
            "chunk_index": r["chunk_index"],
            "page_number": r.get("page_number"),
            "excerpt": r["text"][:200] + "..." if len(r["text"]) > 200 else r["text"],
            "score": r["score"],
            "raw_score": r.get("raw_score"),
            "score_label": r.get("score_label"),
            "score_type": r.get("score_type"),
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
        "query": query,
    }
