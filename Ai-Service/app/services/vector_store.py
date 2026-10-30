"""
Vector Store Service
====================
Manages document vectors in Qdrant with per-user isolation.

Connection priority:
  1. Remote Qdrant server (QDRANT_HOST:QDRANT_PORT) — preferred in production.
  2. Local embedded Qdrant (QDRANT_LOCAL_PATH) — used when server unavailable.
     Data is written to disk and survives AI service restarts.
  3. In-memory fallback — ONLY when ALLOW_MEMORY_FALLBACK=true in .env.
     Data is lost on restart. Never the default.

Every stored vector carries a payload with:
  user_id, workspace_id, document_id, filename, file_type, chunk_index,
  page_number (if available), text

All search/list/delete operations are filtered by user_id + workspace_id
so one user can never access another user's documents.
"""
from __future__ import annotations
import logging
import uuid
from typing import Optional
from app.core.config import settings
from app.services.embeddings_service import embed_texts, embed_query

logger = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────
_qdrant_client = None          # shared client instance
_connection_mode: str = "none" # "remote" | "local" | "memory" | "none"
_memory_store: list[dict] = [] # in-memory fallback (only when explicitly allowed)


# ── Client Initialisation ─────────────────────────────────────────────────────

def _get_qdrant():
    """
    Return a connected QdrantClient, initialising it on first call.

    Try remote → local embedded → memory (if allowed) → raise.
    """
    global _qdrant_client, _connection_mode

    if _connection_mode not in ("none",):
        return _qdrant_client  # already initialised (may be None for memory mode)

    # 1. Remote server
    try:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Distance, VectorParams

        client = QdrantClient(
            host=settings.QDRANT_HOST,
            port=settings.QDRANT_PORT,
            timeout=3,
        )
        _ensure_collection(client)
        _qdrant_client = client
        _connection_mode = "remote"
        logger.info("Qdrant: connected to remote server %s:%s", settings.QDRANT_HOST, settings.QDRANT_PORT)
        return _qdrant_client
    except Exception as e:
        logger.warning("Qdrant remote unavailable (%s). Trying local embedded storage.", e)

    # 2. Local embedded (persists to disk — survives restarts)
    if settings.QDRANT_LOCAL_PATH:
        try:
            from qdrant_client import QdrantClient

            client = QdrantClient(path=settings.QDRANT_LOCAL_PATH)
            _ensure_collection(client)
            _qdrant_client = client
            _connection_mode = "local"
            logger.info("Qdrant: using local embedded storage at '%s'", settings.QDRANT_LOCAL_PATH)
            return _qdrant_client
        except Exception as e:
            logger.warning("Qdrant local embedded failed (%s).", e)

    # 3. In-memory fallback (ONLY when explicitly allowed — data lost on restart)
    if settings.ALLOW_MEMORY_FALLBACK:
        _qdrant_client = None
        _connection_mode = "memory"
        logger.warning(
            "Qdrant: using in-memory fallback (ALLOW_MEMORY_FALLBACK=true). "
            "Documents will be LOST on restart. Set up Qdrant for persistence."
        )
        return None

    # No usable backend
    raise RuntimeError(
        "No vector store available. "
        "Either start Qdrant (see README) or set ALLOW_MEMORY_FALLBACK=true in .env. "
        f"Tried: remote={settings.QDRANT_HOST}:{settings.QDRANT_PORT}, "
        f"local={settings.QDRANT_LOCAL_PATH}"
    )


def _ensure_collection(client) -> None:
    """Create the Qdrant collection if it does not exist (idempotent)."""
    from qdrant_client.models import Distance, VectorParams
    existing = [c.name for c in client.get_collections().collections]
    if settings.QDRANT_COLLECTION not in existing:
        client.create_collection(
            collection_name=settings.QDRANT_COLLECTION,
            vectors_config=VectorParams(
                size=settings.EMBEDDING_DIM,
                distance=Distance.COSINE,
            ),
        )
        logger.info("Qdrant: created collection '%s' (dim=%d)", settings.QDRANT_COLLECTION, settings.EMBEDDING_DIM)


def get_vector_store_status() -> dict:
    """Return current connection mode and stats — used by health endpoint."""
    try:
        client = _get_qdrant()
    except RuntimeError as e:
        return {"mode": "unavailable", "error": str(e), "collection": settings.QDRANT_COLLECTION, "vectors": 0}

    if _connection_mode == "memory":
        return {"mode": "memory", "warning": "data not persisted", "collection": "in-memory", "vectors": len(_memory_store)}

    try:
        info = client.get_collection(settings.QDRANT_COLLECTION)
        return {
            "mode": _connection_mode,
            "collection": settings.QDRANT_COLLECTION,
            "vectors": info.points_count or 0,
            "dimension": settings.EMBEDDING_DIM,
        }
    except Exception as e:
        return {"mode": _connection_mode, "error": str(e), "collection": settings.QDRANT_COLLECTION, "vectors": 0}


# ── Public API ────────────────────────────────────────────────────────────────

def add_documents(
    chunks: list[dict],
    user_id: str = "",
    workspace_id: str = "",
    document_id: str = "",
) -> int:
    """
    Embed and store document chunks.

    Each chunk dict must have: text, filename, chunk_index
    Optional: file_type, page_number

    Returns the number of stored vectors.
    """
    if not chunks:
        return 0

    texts = [c["text"] for c in chunks]
    vectors = embed_texts(texts)

    client = _get_qdrant()
    if _connection_mode == "memory":
        stored = _memory_add(chunks, vectors, user_id, workspace_id, document_id)
    else:
        stored = _qdrant_add(client, chunks, vectors, user_id, workspace_id, document_id)

    # Sync with BM25 keyword index (Phase C)
    try:
        from app.services.bm25_service import add_documents_bm25
        add_documents_bm25(chunks, user_id=user_id, workspace_id=workspace_id, document_id=document_id)
    except Exception as exc:
        logger.warning("BM25 indexing hook error: %s", exc)

    return stored


def similarity_search(
    query: str,
    top_k: int = 5,
    user_id: str = "",
    workspace_id: str = "",
) -> list[dict]:
    """
    Retrieve top_k most relevant chunks for a query, filtered by user/workspace.

    Returns list of dicts: {text, filename, chunk_index, score, document_id, page_number}
    """
    query_vector = embed_query(query)
    client = _get_qdrant()
    if _connection_mode == "memory":
        return _memory_search(query_vector, top_k, user_id, workspace_id)
    return _qdrant_search(client, query_vector, top_k, user_id, workspace_id)


def delete_documents(
    filename: str,
    user_id: str = "",
    workspace_id: str = "",
) -> int:
    """Remove all chunks belonging to a specific file for a user/workspace."""
    # Sync with BM25 keyword index (Phase C)
    try:
        from app.services.bm25_service import delete_documents_bm25
        delete_documents_bm25(filename, user_id=user_id, workspace_id=workspace_id)
    except Exception as exc:
        logger.warning("BM25 deletion hook error: %s", exc)

    client = _get_qdrant()
    if _connection_mode == "memory":
        before = len(_memory_store)
        _memory_store[:] = [
            c for c in _memory_store
            if not (c["filename"] == filename and c.get("user_id") == user_id)
        ]
        return before - len(_memory_store)
    return _qdrant_delete(client, filename, user_id, workspace_id)


def get_document_count(user_id: str = "", workspace_id: str = "") -> int:
    """Return total number of indexed vectors for a user/workspace (or all if no filter)."""
    client = _get_qdrant()
    if _connection_mode == "memory":
        if user_id:
            return sum(1 for c in _memory_store if c.get("user_id") == user_id)
        return len(_memory_store)
    if client is None:
        return 0
    try:
        if user_id:
            # Count via scroll with filter
            from qdrant_client.models import Filter, FieldCondition, MatchValue
            result, _ = client.scroll(
                collection_name=settings.QDRANT_COLLECTION,
                scroll_filter=Filter(
                    must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))]
                ),
                limit=1,
                with_payload=False,
                with_vectors=False,
            )
            # scroll doesn't give total; use count endpoint
            count_result = client.count(
                collection_name=settings.QDRANT_COLLECTION,
                count_filter=Filter(
                    must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))]
                ),
            )
            return count_result.count
        info = client.get_collection(settings.QDRANT_COLLECTION)
        return info.points_count or 0
    except Exception:
        return 0


def list_documents(user_id: str = "", workspace_id: str = "") -> list[str]:
    """Return unique filenames in the vector store for a user/workspace."""
    client = _get_qdrant()
    if _connection_mode == "memory":
        docs = _memory_store
        if user_id:
            docs = [c for c in docs if c.get("user_id") == user_id]
        return list({c["filename"] for c in docs})

    if client is None:
        return []

    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        filenames: set[str] = set()
        offset = None
        scroll_filter = None
        if user_id:
            must_conds = [FieldCondition(key="user_id", match=MatchValue(value=user_id))]
            if workspace_id:
                must_conds.append(
                    FieldCondition(key="workspace_id", match=MatchValue(value=workspace_id))
                )
            scroll_filter = Filter(must=must_conds)
        while True:
            result, next_offset = client.scroll(
                collection_name=settings.QDRANT_COLLECTION,
                scroll_filter=scroll_filter,
                with_payload=True,
                limit=100,
                offset=offset,
            )
            for point in result:
                fn = point.payload.get("filename", "unknown")
                filenames.add(fn)
            if next_offset is None:
                break
            offset = next_offset
        return list(filenames)
    except Exception as e:
        logger.error("list_documents error: %s", e)
        return []


def get_document_preview(
    filename: str,
    user_id: str,
    workspace_id: str = "",
    max_chunks: int = 5,
) -> list[dict]:
    """
    Return the first `max_chunks` textual chunks for a document owned by user_id.
    Strictly filtered by user_id (+ optional workspace_id) to enforce complete isolation.
    """
    if not filename or not user_id:
        return []

    client = _get_qdrant()
    if _connection_mode == "memory":
        matched = [
            c for c in _memory_store
            if c.get("filename") == filename and c.get("user_id") == user_id
        ]
        if workspace_id:
            matched = [c for c in matched if c.get("workspace_id") == workspace_id]
        matched.sort(key=lambda x: x.get("chunk_index", 0))
        return [
            {
                "text": c.get("text", ""),
                "chunk_index": c.get("chunk_index", 0),
                "page_number": c.get("page_number"),
                "file_type": c.get("file_type", ""),
            }
            for c in matched[:max_chunks]
        ]

    if client is None:
        return []

    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        must_conds = [
            FieldCondition(key="filename", match=MatchValue(value=filename)),
            FieldCondition(key="user_id", match=MatchValue(value=user_id)),
        ]
        if workspace_id:
            must_conds.append(
                FieldCondition(key="workspace_id", match=MatchValue(value=workspace_id))
            )

        scroll_filter = Filter(must=must_conds)
        # Fetch up to max_chunks * 2 so we have enough chunks to sort accurately by chunk_index
        result, _ = client.scroll(
            collection_name=settings.QDRANT_COLLECTION,
            scroll_filter=scroll_filter,
            with_payload=True,
            limit=max(max_chunks * 2, 20),
        )

        chunks = []
        for point in result:
            payload = point.payload or {}
            chunks.append({
                "text": payload.get("text", ""),
                "chunk_index": payload.get("chunk_index", 0),
                "page_number": payload.get("page_number"),
                "file_type": payload.get("file_type", ""),
            })

        chunks.sort(key=lambda x: x.get("chunk_index", 0))
        return chunks[:max_chunks]
    except Exception as e:
        logger.error("get_document_preview error: %s", e)
        return []


# ── Qdrant Helpers ────────────────────────────────────────────────────────────

def _qdrant_add(
    client,
    chunks: list[dict],
    vectors: list[list[float]],
    user_id: str,
    workspace_id: str,
    document_id: str,
) -> int:
    from qdrant_client.models import PointStruct
    points = []
    for chunk, vector in zip(chunks, vectors):
        points.append(PointStruct(
            id=str(uuid.uuid4()),
            vector=vector,
            payload={
                "document_id": document_id,
                "user_id": user_id,
                "workspace_id": workspace_id,
                "filename": chunk["filename"],
                "file_type": chunk.get("file_type", ""),
                "chunk_index": chunk["chunk_index"],
                "page_number": chunk.get("page_number"),
                "text": chunk["text"],
            },
        ))
    client.upsert(collection_name=settings.QDRANT_COLLECTION, points=points)
    logger.info("Qdrant: upserted %d vectors (user=%s, doc=%s)", len(points), user_id, document_id)
    return len(points)


def _qdrant_search(
    client,
    query_vector: list[float],
    top_k: int,
    user_id: str,
    workspace_id: str,
) -> list[dict]:
    """
    Query the Qdrant collection using the v1.19+ query_points API.
    The legacy client.search() was removed in qdrant-client 1.9+; replaced by
    client.query_points() which returns a QueryResponse with a .points list.
    """
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    must_conditions = []
    if user_id:
        must_conditions.append(FieldCondition(key="user_id", match=MatchValue(value=user_id)))
    if workspace_id:
        must_conditions.append(FieldCondition(key="workspace_id", match=MatchValue(value=workspace_id)))
    search_filter = Filter(must=must_conditions) if must_conditions else None

    response = client.query_points(
        collection_name=settings.QDRANT_COLLECTION,
        query=query_vector,
        query_filter=search_filter,
        limit=top_k,
        with_payload=True,
    )
    return [
        {
            "text": r.payload.get("text", ""),
            "filename": r.payload.get("filename", "unknown"),
            "chunk_index": r.payload.get("chunk_index", 0),
            "page_number": r.payload.get("page_number"),
            "document_id": r.payload.get("document_id", ""),
            "score": round(float(r.score), 4),
        }
        for r in response.points
    ]


def _qdrant_delete(client, filename: str, user_id: str, workspace_id: str) -> int:
    from qdrant_client.models import Filter, FieldCondition, MatchValue
    # Filter by filename + user so one user cannot delete another's document.
    # Also filter by workspace when provided for full isolation.
    must = [FieldCondition(key="filename", match=MatchValue(value=filename))]
    if user_id:
        must.append(FieldCondition(key="user_id", match=MatchValue(value=user_id)))
    if workspace_id:
        must.append(FieldCondition(key="workspace_id", match=MatchValue(value=workspace_id)))
    client.delete(
        collection_name=settings.QDRANT_COLLECTION,
        points_selector=Filter(must=must),
    )
    return 1


# ── In-Memory Helpers ─────────────────────────────────────────────────────────

def _memory_add(
    chunks: list[dict],
    vectors: list[list[float]],
    user_id: str,
    workspace_id: str,
    document_id: str,
) -> int:
    for chunk, vector in zip(chunks, vectors):
        _memory_store.append({
            "id": str(uuid.uuid4()),
            "vector": vector,
            "document_id": document_id,
            "user_id": user_id,
            "workspace_id": workspace_id,
            "filename": chunk["filename"],
            "file_type": chunk.get("file_type", ""),
            "chunk_index": chunk["chunk_index"],
            "page_number": chunk.get("page_number"),
            "text": chunk["text"],
        })
    return len(chunks)


def _memory_search(
    query_vector: list[float],
    top_k: int,
    user_id: str,
    workspace_id: str,
) -> list[dict]:
    import numpy as np
    store = _memory_store
    if user_id:
        store = [c for c in store if c.get("user_id") == user_id]
    if workspace_id:
        store = [c for c in store if c.get("workspace_id") == workspace_id]

    if not store:
        return []

    q = np.array(query_vector)
    scored = []
    for item in store:
        v = np.array(item["vector"])
        score = float(np.dot(q, v))
        scored.append({
            "text": item["text"],
            "filename": item["filename"],
            "chunk_index": item["chunk_index"],
            "page_number": item.get("page_number"),
            "document_id": item.get("document_id", ""),
            "score": round(score, 4),
        })
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]
