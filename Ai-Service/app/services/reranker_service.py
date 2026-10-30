"""
Cross-Encoder Reranking Service — AIRA AI Service (Phase E)
============================================================
Implements fine-grained neural reranking using sentence-transformers CrossEncoder.

Architecture:
    Hybrid Retrieval (Top 20 candidates)
             │
             ▼
    CrossEncoder.predict([(query, chunk.text), ...])
             │
             ▼
    Reranked Top-k (Top 5)
             │
             ▼
    RAG Context / LLM Synthesis

Key Features:
- Lazy singleton model initialization (loaded once, cached in memory).
- Configurable model name via `settings.RERANKER_MODEL`.
- Enable/disable toggle via `settings.ENABLE_RERANKER`.
- Graceful degradation: if model fails to load or inference fails, logs warning
  and returns input candidates intact.
- Preserves all document metadata, citations, and provenance fields.
- Records reranking latency in milliseconds.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# Singleton CrossEncoder model instance
_model = None
_model_load_attempted: bool = False
_model_available: bool = False


def _get_cross_encoder():
    """
    Lazy loader for CrossEncoder model.
    Loads once on first call and caches in memory.
    Returns None if loading fails, enabling graceful fallback.
    """
    global _model, _model_load_attempted, _model_available

    if not settings.ENABLE_RERANKER:
        return None

    if _model_load_attempted:
        return _model if _model_available else None

    _model_load_attempted = True
    model_name = settings.RERANKER_MODEL

    try:
        t0 = time.perf_counter()
        logger.info("Reranker: loading CrossEncoder model '%s'...", model_name)
        from sentence_transformers import CrossEncoder

        _model = CrossEncoder(model_name)
        _model_available = True
        elapsed_s = time.perf_counter() - t0
        logger.info("Reranker: CrossEncoder model loaded successfully in %.2fs", elapsed_s)
        return _model
    except Exception as exc:
        _model_available = False
        logger.warning(
            "Reranker: failed to load CrossEncoder model '%s' (%s). "
            "Falling back to un-reranked hybrid retrieval.",
            model_name, exc
        )
        return None


def warm_up_reranker() -> None:
    """
    Pre-load the CrossEncoder model during application startup.
    Calling this during the FastAPI lifespan avoids 8+ second cold-start
    on the first real user request.
    """
    model = _get_cross_encoder()
    if model is not None:
        logger.info("Reranker: warm-up complete — model is ready")
    else:
        logger.info("Reranker: warm-up skipped (model unavailable or disabled)")


import math
import re

def clean_retrieval_query(query: str) -> str:
    """
    Strip conversational prompts and meta-directives from the query before
    passing to keyword/vector retrieval and neural cross-encoders.
    """
    pattern = r"(?i)\b(using only the uploaded documentation|clearly separate documented steps from missing implementation details|give the complete|explain the complete|please explain|tell me the|based only on the uploaded document|step by step|in detail|using only uploaded document|according to the uploaded documentation)\b"
    cleaned = re.sub(pattern, " ", query)
    cleaned = re.sub(r"[^\w\s\.\-]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned if len(cleaned) >= 3 else query.strip()


def rerank(
    query: str,
    candidates: list[dict],
    top_k: int = 5,
) -> tuple[list[dict], float]:
    """
    Rerank a list of candidate chunks for a query using CrossEncoder.

    Parameters:
        query: User search query.
        candidates: List of chunk dicts from Hybrid/Semantic/BM25 retrieval.
        top_k: Number of top reranked items to return.

    Returns:
        tuple (reranked_chunks, latency_ms)
        If reranker is disabled or unavailable, returns candidates[:top_k] with 0.0 latency.
    """
    if not candidates or not query:
        return candidates[:top_k], 0.0

    model = _get_cross_encoder()
    if model is None:
        return candidates[:top_k], 0.0

    t0 = time.perf_counter()
    try:
        scoring_query = clean_retrieval_query(query)
        pairs = [[scoring_query, c.get("text", "")] for c in candidates]
        scores = model.predict(pairs)

        latency_ms = round((time.perf_counter() - t0) * 1000, 2)

        # Attach normalized cross-encoder scores (sigmoid) and retain raw logits
        scored: list[tuple[float, dict]] = []
        for idx, chunk in enumerate(candidates):
            raw_logit = float(scores[idx])
            prob = round(1.0 / (1.0 + math.exp(-raw_logit)), 4)

            chunk_copy = dict(chunk)
            chunk_copy["raw_score"] = round(raw_logit, 4)
            chunk_copy["reranker_score"] = round(raw_logit, 4)
            chunk_copy["pre_rerank_score"] = chunk.get("score")
            # Primary score is normalized probability in [0.0, 1.0]
            chunk_copy["score"] = prob
            chunk_copy["relevance_score"] = prob
            chunk_copy["score_type"] = "reranked_probability"
            chunk_copy["score_label"] = f"{int(round(prob * 100))}% Match"
            chunk_copy["reranked"] = True
            scored.append((raw_logit, chunk_copy))

        # Sort descending by raw CrossEncoder logit
        scored.sort(key=lambda x: x[0], reverse=True)
        reranked_items = [item[1] for item in scored[:top_k]]

        logger.info(
            "Reranker: reranked %d candidates to top %d in %.1fms (query: '%s')",
            len(candidates), len(reranked_items), latency_ms, scoring_query
        )
        return reranked_items, latency_ms

    except Exception as exc:
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        logger.warning(
            "Reranker: prediction error (%s). Falling back to original ranking.", exc
        )
        return candidates[:top_k], latency_ms
