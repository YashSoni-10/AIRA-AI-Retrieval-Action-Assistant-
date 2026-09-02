"""
Vector Store Service - Qdrant integration with in-memory fallback.
Handles document storage and semantic similarity search.
"""
from __future__ import annotations
import logging
import uuid
from app.core.config import settings
from app.services.embeddings_service import embed_texts, embed_query

logger = logging.getLogger(__name__)

# ── In-memory fallback store (used when Qdrant is not available) ──────────────
_memory_store: list[dict] = []
_use_memory_fallback: bool = False
_qdrant_client = None


def _get_qdrant():
    global _qdrant_client, _use_memory_fallback
    if _use_memory_fallback:
        return None
    if _qdrant_client is not None:
        return _qdrant_client
    try:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Distance, VectorParams, PointStruct

        client = QdrantClient(
            host=settings.QDRANT_HOST,
            port=settings.QDRANT_PORT,
            timeout=5,
        )
        # Ensure collection exists
        existing = [c.name for c in client.get_collections().collections]
        if settings.QDRANT_COLLECTION not in existing:
            client.create_collection(
                collection_name=settings.QDRANT_COLLECTION,
                vectors_config=VectorParams(
                    size=settings.EMBEDDING_DIM,
                    distance=Distance.COSINE,
                ),
            )
            logger.info(f"Created Qdrant collection: {settings.QDRANT_COLLECTION}")
        _qdrant_client = client
        logger.info("Connected to Qdrant successfully.")
        return _qdrant_client
    except Exception as exc:
        logger.warning(f"Qdrant unavailable ({exc}). Using in-memory vector store.")
        _use_memory_fallback = True
        return None


def add_documents(chunks: list[dict]) -> int:
    """
    Embed and store document chunks. Returns the number of stored vectors.
    Each chunk dict must have: text, filename, chunk_index
    """
    if not chunks:
        return 0

    texts = [c["text"] for c in chunks]
    vectors = embed_texts(texts)

    client = _get_qdrant()
    if client:
        return _qdrant_add(client, chunks, vectors)
    else:
        return _memory_add(chunks, vectors)


def _qdrant_add(client, chunks: list[dict], vectors: list[list[float]]) -> int:
    from qdrant_client.models import PointStruct
    points = []
    for chunk, vector in zip(chunks, vectors):
        points.append(PointStruct(
            id=str(uuid.uuid4()),
            vector=vector,
            payload={
                "text": chunk["text"],
                "filename": chunk["filename"],
                "chunk_index": chunk["chunk_index"],
            },
        ))
    client.upsert(collection_name=settings.QDRANT_COLLECTION, points=points)
    logger.info(f"Upserted {len(points)} vectors to Qdrant.")
    return len(points)


def _memory_add(chunks: list[dict], vectors: list[list[float]]) -> int:
    for chunk, vector in zip(chunks, vectors):
        _memory_store.append({
            "id": str(uuid.uuid4()),
            "vector": vector,
            "text": chunk["text"],
            "filename": chunk["filename"],
            "chunk_index": chunk["chunk_index"],
        })
    logger.info(f"Stored {len(chunks)} chunks in memory.")
    return len(chunks)


def similarity_search(query: str, top_k: int = 5) -> list[dict]:
    """
    Retrieve top_k most similar chunks for a query.
    Returns list of dicts: {text, filename, chunk_index, score}
    """
    query_vector = embed_query(query)
    client = _get_qdrant()
    if client:
        return _qdrant_search(client, query_vector, top_k)
    else:
        return _memory_search(query_vector, top_k)


def _qdrant_search(client, query_vector: list[float], top_k: int) -> list[dict]:
    results = client.search(
        collection_name=settings.QDRANT_COLLECTION,
        query_vector=query_vector,
        limit=top_k,
        with_payload=True,
    )
    return [
        {
            "text": r.payload.get("text", ""),
            "filename": r.payload.get("filename", "unknown"),
            "chunk_index": r.payload.get("chunk_index", 0),
            "score": round(float(r.score), 4),
        }
        for r in results
    ]


def _memory_search(query_vector: list[float], top_k: int) -> list[dict]:
    import numpy as np
    if not _memory_store:
        return []

    q = np.array(query_vector)
    scored = []
    for item in _memory_store:
        v = np.array(item["vector"])
        score = float(np.dot(q, v))  # cosine sim (vectors are normalised)
        scored.append({
            "text": item["text"],
            "filename": item["filename"],
            "chunk_index": item["chunk_index"],
            "score": round(score, 4),
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


def delete_documents(filename: str) -> int:
    """Remove all chunks belonging to a specific file."""
    client = _get_qdrant()
    if client:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        client.delete(
            collection_name=settings.QDRANT_COLLECTION,
            points_selector=Filter(
                must=[FieldCondition(key="filename", match=MatchValue(value=filename))]
            ),
        )
        return 1
    else:
        before = len(_memory_store)
        _memory_store[:] = [c for c in _memory_store if c["filename"] != filename]
        return before - len(_memory_store)


def get_document_count() -> int:
    """Return total number of indexed vectors."""
    client = _get_qdrant()
    if client:
        info = client.get_collection(settings.QDRANT_COLLECTION)
        return info.points_count or 0
    return len(_memory_store)


def list_documents() -> list[str]:
    """Return unique filenames in the vector store."""
    client = _get_qdrant()
    if client:
        # Scroll through all points to collect filenames
        filenames = set()
        offset = None
        while True:
            result, next_offset = client.scroll(
                collection_name=settings.QDRANT_COLLECTION,
                with_payload=True,
                limit=100,
                offset=offset,
            )
            for point in result:
                filenames.add(point.payload.get("filename", "unknown"))
            if next_offset is None:
                break
            offset = next_offset
        return list(filenames)
    else:
        return list({c["filename"] for c in _memory_store})
