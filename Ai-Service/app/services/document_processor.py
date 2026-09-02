"""
Document Processor - Extracts and chunks text from PDF, Markdown, and TXT files.
"""
from __future__ import annotations
import io
import re
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def extract_text(file_bytes: bytes, filename: str) -> str:
    """Extract raw text from uploaded file bytes based on extension."""
    ext = Path(filename).suffix.lower()

    if ext == ".pdf":
        return _extract_pdf(file_bytes)
    elif ext in (".md", ".txt", ".rst"):
        return file_bytes.decode("utf-8", errors="replace")
    else:
        # Try UTF-8 decode as fallback
        try:
            return file_bytes.decode("utf-8", errors="replace")
        except Exception:
            return ""


def _extract_pdf(file_bytes: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(file_bytes))
    pages_text = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        pages_text.append(f"[Page {i + 1}]\n{text}")
    return "\n\n".join(pages_text)


def chunk_text(
    text: str,
    filename: str,
    chunk_size: int = 500,
    chunk_overlap: int = 50,
) -> list[dict]:
    """
    Split text into overlapping chunks with metadata.
    Returns a list of dicts: {text, filename, chunk_index, char_start, char_end}
    """
    # Normalise whitespace
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    if not text:
        return []

    chunks = []
    start = 0
    chunk_index = 0

    while start < len(text):
        end = min(start + chunk_size, len(text))

        # Try to break at a sentence/paragraph boundary
        if end < len(text):
            for sep in ("\n\n", ". ", "? ", "! ", "\n", " "):
                boundary = text.rfind(sep, start, end)
                if boundary != -1 and boundary > start:
                    end = boundary + len(sep)
                    break

        chunk_text_str = text[start:end].strip()

        if chunk_text_str:
            chunks.append({
                "text": chunk_text_str,
                "filename": filename,
                "chunk_index": chunk_index,
                "char_start": start,
                "char_end": end,
            })
            chunk_index += 1

        start = max(start + 1, end - chunk_overlap)

    logger.info(f"Chunked '{filename}' into {len(chunks)} chunks")
    return chunks
