"""
Ingest Endpoint - File upload and document indexing.
POST   /api/v1/ingest          - Upload and index a single file
GET    /api/v1/ingest/list     - List user's indexed documents
DELETE /api/v1/ingest/{filename} - Remove a document from the user's index

All endpoints require a valid Bearer JWT (issued by the Node.js auth backend).
Documents are stored with user_id so one user cannot access another's documents.

After successful vector ingestion, this endpoint calls the Node backend
POST /api/documents to persist document metadata (filename, chunk_count, status)
in MongoDB.  The call is best-effort — if the Node backend is unavailable the
ingest still succeeds; the document remains searchable via Qdrant.
"""
import os
import uuid
import logging
import httpx
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query, Request
from app.services.document_processor import extract_text, chunk_text, chunk_document
from app.services.vector_store import add_documents, list_documents, delete_documents, get_vector_store_status, get_document_preview
from app.core.config import settings
from app.core.auth import get_current_user_id, require_roles

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".rst"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def _save_document_to_mongodb(
    *,
    token: str,
    filename: str,
    file_type: str,
    file_size_bytes: int,
    chunk_count: int,
    vectors_stored: int,
    document_id: str,
    workspace_id: str,
) -> None:
    """
    Call the Node backend to persist document metadata in MongoDB.

    Best-effort: failures are logged but do NOT cause the ingest to fail.
    The document remains searchable via Qdrant even if this call fails.
    The JWT token is forwarded so the Node backend can authenticate + identify
    the user — the user_id is extracted there from the same verified JWT.
    """
    try:
        url = f"{settings.NODE_BACKEND_URL}/api/documents"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        payload = {
            "filename": filename,
            "original_filename": filename,
            "file_type": file_type,
            "file_size_bytes": file_size_bytes,
            "chunk_count": chunk_count,
            "vectors_stored": vectors_stored,
            "document_id": document_id,
            "workspace_id": workspace_id if workspace_id else "",
        }
        # Use httpx sync client with a short timeout so we don't block the response
        with httpx.Client(timeout=5.0) as client:
            response = client.post(url, json=payload, headers=headers)
        if response.status_code in (200, 201):
            logger.info("Document metadata saved to MongoDB: %s", filename)
        else:
            logger.warning(
                "MongoDB document record failed (HTTP %d): %s — document still indexed in Qdrant.",
                response.status_code,
                response.text[:200],
            )
    except Exception as exc:
        logger.warning(
            "Could not save document metadata to MongoDB (%s: %s). "
            "Document '%s' is still searchable via Qdrant.",
            type(exc).__name__, exc, filename,
        )


def _delete_document_metadata_from_mongodb(*, token: str, filename: str) -> None:
    """
    Best-effort: ask the Node backend to delete the MongoDB document record for
    the given filename (owned by the authenticated user).

    Strategy:
      1. GET /api/documents  — find the record whose filename matches
      2. DELETE /api/documents/:id  — remove it by MongoDB _id

    Failures are logged but never bubble up to the caller.
    """
    try:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        with httpx.Client(timeout=5.0) as client:
            # Step 1 — list user's documents and find the matching _id
            list_url = f"{settings.NODE_BACKEND_URL}/api/documents"
            list_resp = client.get(list_url, headers=headers)
            if list_resp.status_code != 200:
                logger.warning(
                    "Could not list documents from Node backend for cleanup (HTTP %d).",
                    list_resp.status_code,
                )
                return

            data = list_resp.json()
            documents = data.get("documents", [])
            doc_id = None
            for doc in documents:
                if doc.get("filename") == filename or doc.get("original_filename") == filename:
                    doc_id = doc.get("_id")
                    break

            if not doc_id:
                logger.info(
                    "No MongoDB record found for filename '%s' — nothing to delete.", filename
                )
                return

            # Step 2 — delete the record by id
            del_url = f"{settings.NODE_BACKEND_URL}/api/documents/{doc_id}"
            del_resp = client.delete(del_url, headers=headers)
            if del_resp.status_code in (200, 204):
                logger.info("MongoDB document record deleted for '%s' (id=%s).", filename, doc_id)
            else:
                logger.warning(
                    "MongoDB document delete failed for '%s' id=%s (HTTP %d): %s",
                    filename, doc_id, del_resp.status_code, del_resp.text[:200],
                )
    except Exception as exc:
        logger.warning(
            "Could not delete MongoDB metadata for '%s' (%s: %s).",
            filename, type(exc).__name__, exc,
        )


@router.post("/ingest")
async def ingest_document(
    request: Request,
    file: UploadFile = File(...),
    workspace_id: str = Query(default="", description="Workspace ID (optional; defaults to user's default workspace)"),
    user_id: str = Depends(require_roles("admin", "member")),
):
    """Upload a document and index it into the vector store. Requires authentication."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename cannot be empty.")
    filename = file.filename

    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 10 MB.")
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    # Check vector store availability before doing expensive processing
    vs_status = get_vector_store_status()
    if vs_status.get("mode") == "unavailable":
        raise HTTPException(
            status_code=503,
            detail="Vector store is not available. Please start Qdrant or configure QDRANT_LOCAL_PATH.",
        )

    # Extract and chunk document with page-awareness
    try:
        chunks = chunk_document(
            file_bytes,
            filename=filename,
            chunk_size=settings.CHUNK_SIZE,
            chunk_overlap=settings.CHUNK_OVERLAP,
        )
    except Exception:
        logger.exception("Text extraction failed for file: %s", filename)
        raise HTTPException(status_code=422, detail="Could not extract text from this document.")

    if not chunks:
        raise HTTPException(status_code=422, detail="No readable text found in this document.")

    # Workspace ID: use user_id as default workspace when none provided (Phase 1)
    effective_workspace_id = workspace_id or user_id

    # Deduplication: remove any previously indexed chunks for this filename by this user
    try:
        delete_documents(filename, user_id=user_id, workspace_id=effective_workspace_id)
    except Exception:
        logger.warning("Could not remove existing chunks for '%s' (user=%s). Proceeding.", filename, user_id)

    # Generate a unique document ID for this ingestion
    document_id = str(uuid.uuid4())

    # Store vectors with full metadata
    try:
        stored = add_documents(
            chunks,
            user_id=user_id,
            workspace_id=effective_workspace_id,
            document_id=document_id,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("Vector storage failed for '%s'", file.filename)
        raise HTTPException(status_code=500, detail="Failed to store document vectors.")

    logger.info("Ingested '%s': %d vectors (user=%s, doc=%s)", file.filename, stored, user_id, document_id)

    # ── Persist document metadata to MongoDB (best-effort) ────────────────────
    # Extract raw JWT from the Authorization header to forward to Node backend.
    # The token was already validated by get_current_user_id above.
    raw_token = ""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        raw_token = auth_header[7:]

    if raw_token:
        _save_document_to_mongodb(
            token=raw_token,
            filename=filename,
            file_type=ext,
            file_size_bytes=len(file_bytes),
            chunk_count=len(chunks),
            vectors_stored=stored,
            document_id=document_id,
            workspace_id=effective_workspace_id,
        )
    else:
        logger.warning(
            "Could not forward JWT to Node backend for document '%s' — MongoDB record skipped.",
            file.filename,
        )

    return {
        "status": "success",
        "document_id": document_id,
        "filename": file.filename,
        "file_size_kb": round(len(file_bytes) / 1024, 2),
        "chunks_created": len(chunks),
        "vectors_stored": stored,
        "message": f"Successfully indexed '{file.filename}' into {stored} vectors.",
    }


@router.get("/ingest/list")
async def list_indexed_documents(
    workspace_id: str = Query(default="", description="Workspace ID filter (optional)"),
    user_id: str = Depends(get_current_user_id),
):
    """Return a list of all indexed document filenames for this user. Requires authentication."""
    effective_workspace_id = workspace_id or user_id
    filenames = list_documents(user_id=user_id, workspace_id=effective_workspace_id)
    return {
        "documents": filenames,
        "count": len(filenames),
    }


@router.get("/ingest/preview")
async def preview_document(
    filename: str = Query(..., min_length=1, description="Document filename to preview"),
    workspace_id: str = Query(default="", description="Workspace ID (optional)"),
    max_chunks: int = Query(default=5, ge=1, le=20, description="Max chunks to retrieve"),
    user_id: str = Depends(get_current_user_id),
):
    """
    Retrieve preview content for a specific document owned by the authenticated user.
    Strictly isolated: does not reveal or return content for documents belonging to other users.
    """
    clean_filename = filename.strip()
    if not clean_filename:
        raise HTTPException(status_code=400, detail="Filename cannot be empty.")

    effective_workspace_id = workspace_id or user_id
    chunks = get_document_preview(
        filename=clean_filename,
        user_id=user_id,
        workspace_id=effective_workspace_id,
        max_chunks=max_chunks,
    )

    if not chunks and effective_workspace_id:
        # Fallback check without workspace constraint (in case document was stored with different workspace_id)
        chunks = get_document_preview(
            filename=clean_filename,
            user_id=user_id,
            workspace_id="",
            max_chunks=max_chunks,
        )

    if not chunks:
        # Check if the document belongs to this user at all
        user_docs = list_documents(user_id=user_id)
        if clean_filename not in user_docs:
            raise HTTPException(
                status_code=404,
                detail=f"Document '{clean_filename}' not found for authenticated user.",
            )
        return {
            "status": "empty",
            "filename": clean_filename,
            "chunks": [],
            "total_chunks": 0,
            "preview_text": "",
            "message": f"Document '{clean_filename}' is indexed but contains no readable text preview.",
        }

    preview_text = "\n\n---\n\n".join(c["text"] for c in chunks if c.get("text"))
    return {
        "status": "success",
        "filename": clean_filename,
        "chunks": chunks,
        "total_chunks": len(chunks),
        "preview_text": preview_text,
    }


@router.delete("/ingest/{filename}")
async def delete_document(
    filename: str,
    request: Request,
    workspace_id: str = Query(default="", description="Workspace ID (optional)"),
    user_id: str = Depends(require_roles("admin", "member")),
):
    """
    Remove all chunks belonging to a specific document for this user from Qdrant,
    then notify the Node backend to delete the corresponding MongoDB metadata record.
    Requires authentication.
    """
    effective_workspace_id = workspace_id or user_id
    try:
        delete_documents(filename, user_id=user_id, workspace_id=effective_workspace_id)
    except Exception:
        logger.exception("Delete failed for '%s' (user=%s)", filename, user_id)
        raise HTTPException(status_code=500, detail="Failed to remove document.")

    # Best-effort: ask Node backend to delete the matching MongoDB document record.
    # The Node DELETE /api/documents/:id endpoint requires a MongoDB _id, so we
    # ask the list endpoint first to discover the record, then delete it by id.
    raw_token = ""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        raw_token = auth_header[7:]

    if raw_token:
        _delete_document_metadata_from_mongodb(
            token=raw_token,
            filename=filename,
        )
    else:
        logger.warning(
            "No JWT available — MongoDB metadata record for '%s' was not cleaned up.",
            filename,
        )

    return {
        "status": "success",
        "filename": filename,
        "message": f"Removed '{filename}' from the knowledge base.",
    }


class ReindexDocumentRequest(BaseModel):
    filename: str
    file_path: Optional[str] = None
    workspace_id: Optional[str] = None


@router.post("/ingest/reindex")
async def reindex_document(
    data: ReindexDocumentRequest,
    request: Request,
    user_id: str = Depends(require_roles("admin", "member")),
):
    """
    Safely reprocess and reindex a document, replacing any stale or corrupt chunks
    with clean, page-aware chunks.
    Preserves workspace/user isolation and synchronizes both Qdrant and BM25 indexes.
    """
    filename = data.filename.strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required.")

    effective_workspace_id = data.workspace_id or user_id

    # Locate source bytes: from provided path, Downloads, or local directories
    candidate_paths = []
    if data.file_path:
        candidate_paths.append(data.file_path)
    candidate_paths.extend([
        os.path.join(r"C:\Users\HP\Downloads", filename),
        os.path.join(r"C:\Users\HP\Documents", filename),
        os.path.join(r"C:\Users\HP\Desktop", filename),
        filename,
    ])

    file_bytes = None
    found_path = None
    for p in candidate_paths:
        if p and os.path.isfile(p):
            try:
                with open(p, "rb") as f:
                    file_bytes = f.read()
                found_path = p
                break
            except Exception:
                continue

    if not file_bytes:
        raise HTTPException(
            status_code=404,
            detail=f"Could not locate source file for '{filename}' to reprocess. Please re-upload via Documents page.",
        )

    # 1. Safely remove previous chunks from Qdrant and BM25 for this document
    try:
        delete_documents(filename, user_id=user_id, workspace_id=effective_workspace_id)
    except Exception as exc:
        logger.warning("Could not clear previous chunks during reindex of '%s': %s", filename, exc)

    # 2. Extract and chunk with page-awareness
    chunks = chunk_document(
        file_bytes,
        filename=filename,
        chunk_size=settings.CHUNK_SIZE,
        chunk_overlap=settings.CHUNK_OVERLAP,
    )
    if not chunks:
        raise HTTPException(status_code=422, detail="No readable chunks produced from file.")

    # 3. Store new vectors and sync BM25
    document_id = str(uuid.uuid4())
    stored = add_documents(
        chunks,
        user_id=user_id,
        workspace_id=effective_workspace_id,
        document_id=document_id,
    )

    # 4. Update MongoDB metadata if token is present
    auth_header = request.headers.get("Authorization", "")
    raw_token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
    ext = os.path.splitext(filename)[1].lower()
    if raw_token:
        _save_document_to_mongodb(
            token=raw_token,
            filename=filename,
            file_type=ext,
            file_size_bytes=len(file_bytes),
            chunk_count=len(chunks),
            vectors_stored=stored,
            document_id=document_id,
            workspace_id=effective_workspace_id,
        )

    logger.info(
        "Reindexed '%s' (%s): %d vectors, %d chunks (user=%s, ws=%s)",
        filename, found_path, stored, len(chunks), user_id, effective_workspace_id,
    )
    return {
        "status": "success",
        "document_id": document_id,
        "filename": filename,
        "file_size_kb": round(len(file_bytes) / 1024, 2),
        "chunks_created": len(chunks),
        "vectors_stored": stored,
        "source_path": found_path,
        "message": f"Successfully reindexed '{filename}' into {stored} high-quality vectors.",
    }
