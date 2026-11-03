"""
BM25 Keyword Retrieval Service — AIRA AI Service (Phase C)
===========================================================
Implements BM25Okapi keyword retrieval using `rank-bm25`.

Key features:
- Per-workspace index partitioning (strict workspace isolation).
- User-level filtering within workspace when user_id is provided.
- Persistent disk storage in `settings.BM25_STORAGE_PATH`. Survives restarts.
- Auto-recovery/rebuild from Qdrant scroll points when disk index is absent.
- Standardized chunk result schema matching `similarity_search()`.
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

from rank_bm25 import BM25Plus

from app.core.config import settings

logger = logging.getLogger(__name__)

# In-memory index cache: workspace_id -> (Optional[BM25Plus], list_of_chunk_dicts)
_cache: dict[str, tuple[Optional[BM25Plus], list[dict]]] = {}


def _get_storage_dir() -> Path:
    storage_dir = Path(settings.BM25_STORAGE_PATH)
    storage_dir.mkdir(parents=True, exist_ok=True)
    return storage_dir


def _get_workspace_file(workspace_id: str) -> Path:
    # Sanitize workspace_id for safe filenames
    safe_id = re.sub(r"[^a-zA-Z0-9_\-]", "_", workspace_id or "default")
    return _get_storage_dir() / f"bm25_{safe_id}.json"


def tokenize(text: str) -> list[str]:
    """Tokenize text into lowercase alphanumeric tokens."""
    if not text:
        return []
    return re.findall(r"\w+", text.lower())


def _build_bm25(chunks: list[dict]) -> Optional[BM25Plus]:
    """Build a BM25Plus instance from a list of chunk dicts."""
    if not chunks:
        return None
    tokenized_corpus = [tokenize(c.get("text", "")) for c in chunks]
    # BM25 requires non-empty token lists; handle all-empty gracefully
    if not any(tokenized_corpus):
        tokenized_corpus = [["empty"] for _ in chunks]
    return BM25Plus(tokenized_corpus)


def _load_chunks_from_disk(workspace_id: str) -> list[dict]:
    """Load chunk metadata list from JSON file on disk."""
    file_path = _get_workspace_file(workspace_id)
    if not file_path.exists():
        return []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("chunks", []) if isinstance(data, dict) else []
    except Exception as exc:
        logger.warning("Could not read BM25 index from %s: %s", file_path, exc)
        return []


def _save_chunks_to_disk(workspace_id: str, chunks: list[dict]) -> None:
    """Persist chunk metadata list to JSON file on disk."""
    file_path = _get_workspace_file(workspace_id)
    temp_path = file_path.with_suffix(".tmp")
    try:
        payload = {"workspace_id": workspace_id, "chunks": chunks}
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        temp_path.replace(file_path)
    except Exception as exc:
        logger.error("Failed to save BM25 index to %s: %s", file_path, exc)


def _recover_from_qdrant(workspace_id: str) -> list[dict]:
    """
    Recover all document chunks for a workspace by scrolling Qdrant points.
    Guarantees index can be rebuilt even if BM25 disk files were lost.
    """
    try:
        from app.services.vector_store import _get_qdrant, _connection_mode
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        client = _get_qdrant()
        if client is None or _connection_mode == "memory":
            return []

        scroll_filter = None
        if workspace_id:
            scroll_filter = Filter(
                must=[FieldCondition(key="workspace_id", match=MatchValue(value=workspace_id))]
            )

        chunks: list[dict] = []
        offset = None
        while True:
            result, next_offset = client.scroll(
                collection_name=settings.QDRANT_COLLECTION,
                scroll_filter=scroll_filter,
                with_payload=True,
                limit=100,
                offset=offset,
            )
            for point in result:
                payload = point.payload or {}
                if payload.get("text"):
                    chunks.append({
                        "text": payload.get("text", ""),
                        "filename": payload.get("filename", "unknown"),
                        "chunk_index": payload.get("chunk_index", 0),
                        "document_id": payload.get("document_id", ""),
                        "page_number": payload.get("page_number"),
                        "user_id": payload.get("user_id", ""),
                        "workspace_id": payload.get("workspace_id", workspace_id),
                    })
            if next_offset is None:
                break
            offset = next_offset

        if chunks:
            logger.info("BM25: recovered %d chunks from Qdrant for workspace '%s'", len(chunks), workspace_id)
            _save_chunks_to_disk(workspace_id, chunks)
        return chunks
    except Exception as exc:
        logger.warning("BM25 recovery from Qdrant failed for workspace '%s': %s", workspace_id, exc)
        return []


def _get_workspace_index(workspace_id: str) -> tuple[Optional[BM25Plus], list[dict]]:
    """Return cached or loaded (BM25Okapi, chunks) for the given workspace_id."""
    ws_key = workspace_id or "default"
    if ws_key in _cache:
        return _cache[ws_key]

    # Try loading from disk
    chunks = _load_chunks_from_disk(ws_key)
    if not chunks:
        # Try auto-recovery from Qdrant
        chunks = _recover_from_qdrant(ws_key)

    bm25 = _build_bm25(chunks)
    _cache[ws_key] = (bm25, chunks)
    return bm25, chunks


# ── Public BM25 API ───────────────────────────────────────────────────────────

def add_documents_bm25(
    chunks: list[dict],
    user_id: str = "",
    workspace_id: str = "",
    document_id: str = "",
) -> int:
    """
    Index document chunks in the workspace's BM25 index and save to disk.
    Each chunk dict must have: text, filename, chunk_index. Optional: page_number.
    """
    if not chunks:
        return 0

    ws_key = workspace_id or "default"
    _, existing_chunks = _get_workspace_index(ws_key)

    new_entries = []
    for c in chunks:
        new_entries.append({
            "text": c.get("text", ""),
            "filename": c.get("filename", "unknown"),
            "chunk_index": c.get("chunk_index", 0),
            "document_id": document_id or c.get("document_id", ""),
            "page_number": c.get("page_number"),
            "user_id": user_id,
            "workspace_id": ws_key,
        })

    combined = existing_chunks + new_entries
    bm25 = _build_bm25(combined)
    _cache[ws_key] = (bm25, combined)
    _save_chunks_to_disk(ws_key, combined)
    logger.info("BM25: indexed %d new chunks for workspace '%s' (total %d)", len(new_entries), ws_key, len(combined))
    return len(new_entries)


def delete_documents_bm25(
    filename: str,
    user_id: str = "",
    workspace_id: str = "",
) -> int:
    """
    Remove all chunks matching filename (and user_id if supplied) from the workspace's BM25 index.
    """
    ws_key = workspace_id or "default"
    _, existing_chunks = _get_workspace_index(ws_key)

    before = len(existing_chunks)
    remaining = [
        c for c in existing_chunks
        if not (
            c.get("filename") == filename
            and (not user_id or c.get("user_id") == user_id)
        )
    ]
    removed = before - len(remaining)
    if removed > 0:
        bm25 = _build_bm25(remaining)
        _cache[ws_key] = (bm25, remaining)
        _save_chunks_to_disk(ws_key, remaining)
        logger.info("BM25: removed %d chunks for file '%s' in workspace '%s'", removed, filename, ws_key)
    return removed


def search_bm25(
    query: str,
    top_k: int = 5,
    user_id: str = "",
    workspace_id: str = "",
) -> list[dict]:
    """
    Retrieve top_k most relevant chunks using BM25Okapi keyword matching.
    Scoped strictly to the specified workspace_id and optional user_id.

    Returns:
        list of dicts matching similarity_search format:
        { text, filename, chunk_index, score, document_id, page_number, retrieval_mode: "bm25" }
    """
    ws_key = workspace_id or "default"
    bm25, chunks = _get_workspace_index(ws_key)

    if not bm25 or not chunks:
        return []

    tokens = tokenize(query)
    if not tokens:
        return []

    raw_scores = bm25.get_scores(tokens)

    # Filter candidates by keyword match and user_id (preserve workspace & user isolation)
    query_set = set(tokens)
    scored_candidates = []
    for idx, score in enumerate(raw_scores):
        chunk = chunks[idx]
        if user_id and chunk.get("user_id") and chunk.get("user_id") != user_id:
            continue
        doc_tokens = set(tokenize(chunk.get("text", "")))
        if not query_set.intersection(doc_tokens):
            continue
        scored_candidates.append((float(score), chunk))

    if not scored_candidates:
        return []

    # Sort descending by BM25 score
    scored_candidates.sort(key=lambda x: x[0], reverse=True)
    top_candidates = scored_candidates[:top_k]

    # Normalize max score for consistency
    max_score = top_candidates[0][0] if top_candidates else 1.0

    results = []
    for score, chunk in top_candidates:
        # Normalized score between 0.0 and 1.0 (approximated)
        norm_score = round(min(score / (max_score + 1e-6), 1.0), 4)
        results.append({
            "text": chunk.get("text", ""),
            "filename": chunk.get("filename", "unknown"),
            "chunk_index": chunk.get("chunk_index", 0),
            "score": norm_score,
            "raw_bm25_score": round(score, 4),
            "document_id": chunk.get("document_id"),
            "page_number": chunk.get("page_number"),
            "retrieval_mode": "bm25",
        })

    return results
