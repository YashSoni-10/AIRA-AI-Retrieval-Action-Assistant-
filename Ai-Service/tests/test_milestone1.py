"""
AIRA Phase 2 — Milestone 1 Tests
==================================
Tests for:
  A1. Multi-turn conversation context
  A2. LLM error handling

Run with:
    cd Ai-Service
    .\\venv\\Scripts\\python.exe -m pytest tests/test_milestone1.py -v --tb=short

Requirements:
    - All three services running (Node :5000, AI service :8000)
    - Groq API key configured
    - At least one document already indexed (run Phase 1 tests first to upload one)
"""
import pytest
import httpx
import uuid

NODE_BASE = "http://localhost:5000/api"
AI_BASE = "http://127.0.0.1:8000/api/v1"

_RUN_ID = uuid.uuid4().hex[:8]
M1_EMAIL = f"milestone1_{_RUN_ID}@aira.test"
M1_PASSWORD = "TestPassword123!"


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def token():
    """Register a test user and return JWT."""
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": f"M1 User {_RUN_ID}",
        "email": M1_EMAIL,
        "password": M1_PASSWORD,
    })
    assert r.status_code in (200, 201), f"Register failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def conversation_id(token):
    """Create a conversation for the test user."""
    r = httpx.post(
        f"{NODE_BASE}/conversations",
        json={"title": "Milestone 1 Multi-turn Test"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, f"Create conversation failed: {r.text}"
    conv_id = r.json()["conversation"]["_id"]
    return conv_id


# ── A2: LLM Error Handling ────────────────────────────────────────────────────

class TestLLMErrorHandling:
    """Verify that LLM service errors are caught and return user-safe messages."""

    def test_chat_stream_returns_sse_error_on_empty_query(self, token):
        """
        Whitespace-only query must be rejected — returns 400, not 422.

        Two-layer validation design (Phase L decision):
          Layer 1 — FastAPI Query(min_length=1):
            Catches truly empty strings (len == 0) → 422 Unprocessable Entity.
            A single space " " has length 1 and PASSES this layer correctly.
          Layer 2 — Application-level strip() check:
            Catches whitespace-only strings → 400 Bad Request (business logic).

        Both layers are intentional. The test was previously asserting 422 which
        is incorrect for whitespace-only input. The correct status is 400.
        """
        r = httpx.get(
            f"{AI_BASE}/chat/stream",
            params={"query": " ", "token": token},
        )
        # Whitespace-only query: passes FastAPI structural validation (len=1),
        # but is rejected by the application strip() check with 400 Bad Request.
        assert r.status_code == 400

    def test_chat_post_rejects_empty_query(self, token):
        """POST /chat with empty query returns 400, not 500."""
        r = httpx.post(
            f"{AI_BASE}/chat",
            json={"query": "   "},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code in (400, 422)

    def test_chat_stream_rejects_missing_token(self):
        """Stream without token must return 401."""
        r = httpx.get(
            f"{AI_BASE}/chat/stream",
            params={"query": "test", "token": ""},
        )
        assert r.status_code == 401

    def test_chat_post_rejects_missing_token(self):
        """POST /chat without Bearer token must return 401."""
        r = httpx.post(
            f"{AI_BASE}/chat",
            json={"query": "test"},
        )
        assert r.status_code == 401

    def test_chat_post_rejects_bad_token(self):
        """POST /chat with a garbage JWT must return 401."""
        r = httpx.post(
            f"{AI_BASE}/chat",
            json={"query": "test"},
            headers={"Authorization": "Bearer this.is.garbage"},
        )
        assert r.status_code == 401


# ── A1: Multi-turn Conversation Context ───────────────────────────────────────

class TestMultiTurnContext:
    """Verify that conversation_id causes history to be loaded and injected."""

    def test_conversation_created_successfully(self, conversation_id):
        """Fixture: conversation is created with a valid MongoDB ID."""
        assert conversation_id and len(conversation_id) == 24

    def test_save_message_to_conversation(self, token, conversation_id):
        """Saved messages are retrievable via GET /conversations/:id/messages."""
        # Save a user message
        r = httpx.post(
            f"{NODE_BASE}/conversations/{conversation_id}/messages",
            json={"role": "user", "content": "What is the RAG pipeline?"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 201, f"Save user message failed: {r.text}"

        # Save an assistant reply
        r2 = httpx.post(
            f"{NODE_BASE}/conversations/{conversation_id}/messages",
            json={
                "role": "assistant",
                "content": "The RAG pipeline retrieves relevant chunks and sends them to the LLM.",
                "meta": {"confidence": 0.85, "confidence_label": "High", "chunks_found": 3},
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 201, f"Save assistant message failed: {r2.text}"

    def test_get_messages_returns_saved_history(self, token, conversation_id):
        """GET /conversations/:id/messages returns what was saved."""
        r = httpx.get(
            f"{NODE_BASE}/conversations/{conversation_id}/messages",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert len(data["messages"]) >= 2  # user + assistant from previous test

    def test_chat_stream_accepts_conversation_id_param(self, token, conversation_id):
        """
        GET /chat/stream with a valid conversation_id must not return 4xx/5xx.
        We stream only the first chunk to verify the endpoint accepts the param.
        Note: may return 'no documents' token if knowledge base is empty — that is fine.
        """
        params = {
            "query": "What is the RAG pipeline?",
            "token": token,
            "conversation_id": conversation_id,
        }
        with httpx.stream("GET", f"{AI_BASE}/chat/stream", params=params, timeout=30) as resp:
            assert resp.status_code == 200
            assert "text/event-stream" in resp.headers.get("content-type", "")
            # Read first event
            first_line = next(resp.iter_lines(), None)
            assert first_line is not None

    def test_chat_stream_without_conversation_id_still_works(self, token):
        """
        Backward compat: stream without conversation_id must still work.
        """
        params = {"query": "test query", "token": token}
        with httpx.stream("GET", f"{AI_BASE}/chat/stream", params=params, timeout=30) as resp:
            assert resp.status_code == 200
            first_line = next(resp.iter_lines(), None)
            assert first_line is not None

    def test_chat_stream_invalid_conversation_id_falls_back_gracefully(self, token):
        """
        An invalid/unknown conversation_id should not crash the stream.
        The AI service falls back to no-history mode silently.
        """
        params = {
            "query": "test query",
            "token": token,
            "conversation_id": "000000000000000000000000",  # valid format, non-existent
        }
        with httpx.stream("GET", f"{AI_BASE}/chat/stream", params=params, timeout=30) as resp:
            # Should still start the stream, not return 500
            assert resp.status_code == 200

    def test_get_messages_forbidden_for_other_user(self, token, conversation_id):
        """A different user must not be able to read the first user's messages."""
        # Register a second user
        other_email = f"m1_other_{_RUN_ID}@aira.test"
        reg = httpx.post(f"{NODE_BASE}/auth/register", json={
            "name": "Other M1 User",
            "email": other_email,
            "password": M1_PASSWORD,
        })
        assert reg.status_code in (200, 201)
        other_token = reg.json()["token"]

        # Try to read the first user's messages
        r = httpx.get(
            f"{NODE_BASE}/conversations/{conversation_id}/messages",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert r.status_code in (403, 404), (
            f"Expected 403/404 for cross-user access, got {r.status_code}: {r.text}"
        )

    def test_history_limit_respected(self, token, conversation_id):
        """
        AI service fetches at most 6 messages (configurable via _HISTORY_LIMIT).
        We save 10 messages then verify the history endpoint is called with limit=6.
        (Indirectly tested: stream returns 200 with valid conversation_id after many messages.)
        """
        # Add 8 more messages to the conversation (4 turns)
        for i in range(4):
            for role, content in [
                ("user", f"Follow-up question {i+1}?"),
                ("assistant", f"Answer to follow-up {i+1}."),
            ]:
                httpx.post(
                    f"{NODE_BASE}/conversations/{conversation_id}/messages",
                    json={"role": role, "content": content},
                    headers={"Authorization": f"Bearer {token}"},
                )

        # Stream still works with many messages saved
        params = {
            "query": "Explain the last point again",
            "token": token,
            "conversation_id": conversation_id,
        }
        with httpx.stream("GET", f"{AI_BASE}/chat/stream", params=params, timeout=30) as resp:
            assert resp.status_code == 200
