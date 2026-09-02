"""
Ingest Endpoint - File upload and document indexing.
POST /api/v1/ingest      - Upload and index a single file
GET  /api/v1/ingest/list - List all indexed documents
DELETE /api/v1/ingest/{filename} - Remove a document from index
"""
from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.document_processor import extract_text, chunk_text
from app.services.vector_store import add_documents, list_documents, delete_documents
from app.core.config import settings

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".rst"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/ingest")
async def ingest_document(file: UploadFile = File(...)):
    """Upload a document and index it into the vector store."""
    import os
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Max size is 10 MB.")
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    # Extract and chunk
    raw_text = extract_text(file_bytes, file.filename)
    if not raw_text.strip():
        raise HTTPException(status_code=422, detail="Could not extract any text from the document.")

    chunks = chunk_text(
        raw_text,
        filename=file.filename,
        chunk_size=settings.CHUNK_SIZE,
        chunk_overlap=settings.CHUNK_OVERLAP,
    )

    if not chunks:
        raise HTTPException(status_code=422, detail="Document produced no processable chunks.")

    # Store in vector DB
    stored = add_documents(chunks)

    return {
        "status": "success",
        "filename": file.filename,
        "file_size_kb": round(len(file_bytes) / 1024, 2),
        "chunks_created": len(chunks),
        "vectors_stored": stored,
        "message": f"Successfully indexed '{file.filename}' into {stored} vectors.",
    }


@router.get("/ingest/list")
async def list_indexed_documents():
    """Return a list of all indexed document filenames."""
    filenames = list_documents()
    return {
        "documents": filenames,
        "count": len(filenames),
    }


@router.delete("/ingest/{filename}")
async def delete_document(filename: str):
    """Remove all chunks belonging to a specific document."""
    removed = delete_documents(filename)
    return {
        "status": "success",
        "filename": filename,
        "chunks_removed": removed,
        "message": f"Removed '{filename}' from the knowledge base.",
    }
