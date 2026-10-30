"""
Unit and regression tests for Document Content Preview (Phase 4C).
Tests:
1. Endpoint requires authentication (HTTP 401 without Bearer token).
2. Preview returns chunks and preview_text for an indexed document owned by user.
3. Strict user-scoping: user A cannot preview user B's documents (HTTP 404).
4. Non-existent document returns HTTP 404.
5. Max chunks parameter is respected.
"""
import pytest
import jwt
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
import app.services.vector_store as vs

client = TestClient(app)

USER_A = "test-preview-user-a"
USER_B = "test-preview-user-b"

TOKEN_A = jwt.encode({"id": USER_A, "role": "member"}, settings.JWT_SECRET, algorithm="HS256")
TOKEN_B = jwt.encode({"id": USER_B, "role": "member"}, settings.JWT_SECRET, algorithm="HS256")

HEADERS_A = {"Authorization": f"Bearer {TOKEN_A}"}
HEADERS_B = {"Authorization": f"Bearer {TOKEN_B}"}

SAMPLE_DOC = "architecture_preview_test.md"


@pytest.fixture(autouse=True)
def setup_teardown_docs():
    # Use memory mode for test isolation (avoids Qdrant file lock from running server)
    old_mode = vs._connection_mode
    old_store = list(vs._memory_store)
    vs._connection_mode = "memory"
    vs._memory_store = []

    # Ingest test chunks for User A
    chunks = [
        {
            "filename": SAMPLE_DOC,
            "file_type": ".md",
            "chunk_index": 0,
            "page_number": 1,
            "text": "This is chunk 1 of architecture preview test.",
        },
        {
            "filename": SAMPLE_DOC,
            "file_type": ".md",
            "chunk_index": 1,
            "page_number": 1,
            "text": "This is chunk 2 discussing Qdrant vector storage.",
        },
        {
            "filename": SAMPLE_DOC,
            "file_type": ".md",
            "chunk_index": 2,
            "page_number": 2,
            "text": "This is chunk 3 detailing user isolation policies.",
        },
    ]
    vs.add_documents(chunks, user_id=USER_A, workspace_id=USER_A, document_id="doc-test-123")
    yield
    # Restore previous state
    vs._connection_mode = old_mode
    vs._memory_store = old_store


def test_preview_requires_authentication():
    res = client.get(f"/api/v1/ingest/preview?filename={SAMPLE_DOC}")
    assert res.status_code == 401


def test_preview_returns_chunks_for_document_owner():
    res = client.get(
        f"/api/v1/ingest/preview?filename={SAMPLE_DOC}&max_chunks=5",
        headers=HEADERS_A,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["filename"] == SAMPLE_DOC
    assert len(data["chunks"]) == 3
    assert "chunk 1" in data["preview_text"]
    assert "chunk 2" in data["preview_text"]
    assert data["chunks"][0]["chunk_index"] == 0
    assert data["chunks"][1]["chunk_index"] == 1


def test_preview_strictly_isolated_from_other_users():
    # User B queries User A's document -> must be rejected with 404 (not accessible to User B)
    res = client.get(
        f"/api/v1/ingest/preview?filename={SAMPLE_DOC}",
        headers=HEADERS_B,
    )
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_preview_nonexistent_document_returns_404():
    res = client.get(
        "/api/v1/ingest/preview?filename=does_not_exist_at_all.txt",
        headers=HEADERS_A,
    )
    assert res.status_code == 404


def test_preview_respects_max_chunks():
    res = client.get(
        f"/api/v1/ingest/preview?filename={SAMPLE_DOC}&max_chunks=2",
        headers=HEADERS_A,
    )
    assert res.status_code == 200
    data = res.json()
    assert len(data["chunks"]) == 2
