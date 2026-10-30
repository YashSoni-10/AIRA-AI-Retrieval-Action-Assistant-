"""
Document Processor — AIRA AI Service
======================================
Extracts and chunks text from PDF, Markdown, and TXT files with
page-awareness, header/footer sanitization, and robust boundary-aware chunking.
"""
from __future__ import annotations

import io
import re
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def sanitize_mojibake(text: str) -> str:
    """
    Safely fix known UTF-8/CP1252 mojibake artifacts without speculative global replacements
    that could corrupt legitimate Unicode characters (e.g. French 'château', German 'über').
    """
    if not text:
        return ""

    exact_map = {
        "\u00e2\x80\x93": "–",      # UTF-8 en-dash (0xE2 0x80 0x93)
        "\u00e2\x80\x94": "—",      # UTF-8 em-dash (0xE2 0x80 0x94)
        "\u00e2\x80\x98": "‘",      # UTF-8 left single quote
        "\u00e2\x80\x99": "’",      # UTF-8 right single quote
        "\u00e2\x80\x9c": "“",      # UTF-8 left double quote
        "\u00e2\x80\x9d": "”",      # UTF-8 right double quote
        "\u00e2\x80\xa2": "•",      # UTF-8 bullet
        "\u00e2\ufffd\ufffd": "–",  # UTF-8 en-dash corrupted by replacement chars
        "\u00e2\ufffd": "-",        # corrupted dash
    }
    for bad, good in exact_map.items():
        if bad in text:
            text = text.replace(bad, good)

    specific_tokens = {
        "bearer\u00e2token": "bearer-token",
        "bearer\u00e2\ufffdtoken": "bearer-token",
        "Multi\u00e2level": "Multi-level",
        "Multi\u00e2\ufffdlevel": "Multi-level",
        "multi\u00e2level": "multi-level",
        "multi\u00e2\ufffdlevel": "multi-level",
        "Role\u00e2Based": "Role-Based",
        "Role\u00e2\ufffdBased": "Role-Based",
        "role\u00e2based": "role-based",
        "role\u00e2\ufffdbased": "role-based",
    }
    for bad, good in specific_tokens.items():
        if bad in text:
            text = text.replace(bad, good)

    return text


def clean_text(text: str) -> str:
    """
    Normalize extracted text:
    - Strip running slide headers/footers (e.g., 'EventPass Technical Documentation 2')
    - Sanitize known mojibake artifacts without corrupting valid Unicode
    - Remove standalone bullet noise ('•', '• •')
    - Normalize whitespace while preserving structural paragraph breaks
    """
    if not text:
        return ""

    text = sanitize_mojibake(text)

    # Remove common slide/page footers: 'EventPass Technical Documentation <num>', 'Page <num>'
    text = re.sub(
        r"(?:EventPass\s+Technical\s+Documentation\s+\d+|Page\s+\d+(?:\s+of\s+\d+)?)\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )

    # Filter standalone bullet artifacts or empty noise lines
    lines = text.splitlines()
    clean_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped in ("•", "• •", "• • •", "• • • •", "-", "*", ""):
            continue
        # Clean leading bullet symbol while keeping line content
        clean_line = re.sub(r"^[•\*\-]\s*", "", line)
        clean_lines.append(clean_line)

    text = "\n".join(clean_lines)
    # Collapse 3+ newlines to standard double newline (paragraph break)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def extract_text_with_pages(file_bytes: bytes, filename: str) -> list[tuple[int, str]]:
    """
    Extract raw text page-by-page from uploaded file bytes.
    Returns a list of (page_number, page_text) tuples (1-indexed).
    """
    ext = Path(filename).suffix.lower()

    if ext == ".pdf":
        return _extract_pdf_pages(file_bytes)
    elif ext in (".md", ".txt", ".rst"):
        try:
            content = file_bytes.decode("utf-8", errors="replace")
        except Exception:
            content = ""
        return [(1, clean_text(content))]
    else:
        try:
            content = file_bytes.decode("utf-8", errors="replace")
            return [(1, clean_text(content))]
        except Exception:
            return []


def _extract_pdf_pages(file_bytes: bytes) -> list[tuple[int, str]]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(file_bytes))
    pages: list[tuple[int, str]] = []
    for i, page in enumerate(reader.pages):
        raw = page.extract_text() or ""
        cleaned = clean_text(raw)
        if cleaned:
            pages.append((i + 1, cleaned))
    return pages


def extract_text(file_bytes: bytes, filename: str) -> str:
    """
    Backward-compatible text extraction returning a single concatenated string.
    """
    pages = extract_text_with_pages(file_bytes, filename)
    if not pages:
        return ""
    if len(pages) == 1 and pages[0][0] == 1:
        return pages[0][1]
    return "\n\n".join(f"[Page {p_num}]\n{text}" for p_num, text in pages)


def chunk_text(
    text: str,
    filename: str = "document",
    chunk_size: int = 550,
    chunk_overlap: int = 80,
    page_number: Optional[int] = None,
    start_chunk_idx: int = 0,
    min_chunk_len: int = 40,
) -> list[dict]:
    """
    Split text into overlapping chunks with precise boundaries and metadata.

    Guarantees:
    - Never shifts by 1-2 characters (prevents degenerate micro-chunks).
    - Breaks on clean linguistic boundaries (paragraphs, sentences, or word breaks).
    - Snaps overlap to complete word boundaries.
    - Absorbs small terminal fragments into the final chunk instead of creating noise.
    - Filters out chunks below min_chunk_len.
    """
    cleaned = clean_text(text)
    if not cleaned or len(cleaned) < min_chunk_len:
        return []

    # If the text fits in a single window, return it as one cohesive chunk
    if len(cleaned) <= int(chunk_size * 1.25):
        return [{
            "text": cleaned,
            "filename": filename,
            "page_number": page_number,
            "chunk_index": start_chunk_idx,
            "char_start": 0,
            "char_end": len(cleaned),
        }]

    chunks = []
    start = 0
    chunk_idx = start_chunk_idx
    text_len = len(cleaned)

    while start < text_len:
        # If what remains is reasonably close to chunk_size, absorb it completely
        if text_len - start <= int(chunk_size * 1.25):
            end = text_len
        else:
            end = min(start + chunk_size, text_len)
            # Search for natural break in the trailing 35% of the window
            search_start = max(start + int(chunk_size * 0.65), start + 1)
            best_boundary = -1

            for sep in ("\n\n", ".\n", "\n", ". ", "? ", "! ", "; ", ", "):
                b = cleaned.rfind(sep, search_start, end)
                if b != -1:
                    best_boundary = b + len(sep)
                    break

            if best_boundary != -1 and best_boundary > start:
                end = best_boundary

        chunk_str = cleaned[start:end].strip()

        if len(chunk_str) >= min_chunk_len:
            chunks.append({
                "text": chunk_str,
                "filename": filename,
                "page_number": page_number,
                "chunk_index": chunk_idx,
                "char_start": start,
                "char_end": end,
            })
            chunk_idx += 1

        if end >= text_len:
            break

        # Compute next start position with overlap
        raw_next_start = end - chunk_overlap
        if raw_next_start <= start:
            raw_next_start = start + max(int(chunk_size * 0.4), chunk_overlap)

        # Snap next start forward to the next clean word boundary (space or newline)
        if raw_next_start < end:
            space_pos = cleaned.find(" ", raw_next_start)
            newline_pos = cleaned.find("\n", raw_next_start)
            candidates = [p for p in (space_pos, newline_pos) if p != -1 and p < end]
            if candidates:
                raw_next_start = min(candidates) + 1

        start = raw_next_start

    logger.debug("Chunked text for '%s' (page %s) into %d chunks", filename, page_number, len(chunks))
    return chunks


def chunk_document(
    file_bytes: bytes,
    filename: str,
    chunk_size: int = 550,
    chunk_overlap: int = 80,
) -> list[dict]:
    """
    High-level document chunker: extracts pages, cleans each page,
    chunks page-by-page preserving accurate page_number metadata,
    and returns a sequential list of chunk dicts.
    """
    pages = extract_text_with_pages(file_bytes, filename)
    all_chunks: list[dict] = []
    chunk_idx = 0

    for page_num, page_text in pages:
        p_chunks = chunk_text(
            page_text,
            filename=filename,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            page_number=page_num,
            start_chunk_idx=chunk_idx,
        )
        chunk_idx += len(p_chunks)
        all_chunks.extend(p_chunks)

    logger.info("chunk_document: '%s' produced %d high-quality chunks across %d pages", filename, len(all_chunks), len(pages))
    return all_chunks
