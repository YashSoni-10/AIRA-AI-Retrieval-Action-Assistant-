"""
Tests for reranker warm-up and streaming LLM functionality.
"""
import pytest
from unittest.mock import patch, MagicMock


class TestRerankerWarmup:
    def test_warm_up_reranker_calls_get_cross_encoder(self):
        """warm_up_reranker() should call _get_cross_encoder() exactly once."""
        from app.services import reranker_service
        with patch.object(reranker_service, "_get_cross_encoder", return_value=MagicMock()) as mock_get:
            reranker_service.warm_up_reranker()
            mock_get.assert_called_once()

    def test_warm_up_reranker_handles_none_model(self):
        """warm_up_reranker() should not raise even if model is None."""
        from app.services import reranker_service
        with patch.object(reranker_service, "_get_cross_encoder", return_value=None):
            reranker_service.warm_up_reranker()  # must not raise

    def test_reranker_singleton_loaded_once(self):
        """_get_cross_encoder should not reload the model on repeated calls."""
        from app.services import reranker_service
        # Reset state
        reranker_service._model_load_attempted = False
        reranker_service._model_available = False
        reranker_service._model = None

        call_count = 0
        original_init = None

        class FakeCrossEncoder:
            def __init__(self, name):
                nonlocal call_count
                call_count += 1

        with patch("app.services.reranker_service.settings") as mock_settings:
            mock_settings.ENABLE_RERANKER = True
            mock_settings.RERANKER_MODEL = "fake-model"
            with patch.dict("sys.modules", {"sentence_transformers": MagicMock(CrossEncoder=FakeCrossEncoder)}):
                reranker_service._get_cross_encoder()
                reranker_service._get_cross_encoder()
                reranker_service._get_cross_encoder()

        assert call_count == 1, f"Expected model to be initialized once, got {call_count}"
        # Reset for other tests
        reranker_service._model_load_attempted = False
        reranker_service._model_available = False
        reranker_service._model = None


class TestStreamingLLM:
    def test_stream_llm_response_yields_chunks(self):
        """stream_llm_response should yield text chunks from Groq streaming."""
        from app.services.llm_service import stream_llm_response

        fake_chunks = [
            MagicMock(choices=[MagicMock(delta=MagicMock(content="Hello"))]),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=" world"))]),
            MagicMock(choices=[MagicMock(delta=MagicMock(content=None))]),  # empty chunk
        ]

        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = iter(fake_chunks)

        with patch("app.services.llm_service.settings") as mock_settings:
            mock_settings.LLM_PROVIDER = "groq"
            mock_settings.GROQ_API_KEY = "test-key"
            mock_settings.GROQ_MODEL = "test-model"
            with patch("app.services.llm_service._HISTORY_CONTENT_LIMIT", 800):
                with patch("groq.Groq", return_value=mock_client):
                    chunks = list(stream_llm_response("sys", "user", max_tokens=100))

        assert "Hello" in chunks
        assert " world" in chunks
        # None content chunk should not be yielded
        assert None not in chunks

    def test_stream_llm_response_fallback_gemini(self):
        """stream_llm_response for Gemini provider yields full buffered response."""
        from app.services.llm_service import stream_llm_response

        with patch("app.services.llm_service.settings") as mock_settings:
            mock_settings.LLM_PROVIDER = "gemini"
            mock_settings.GEMINI_API_KEY = "test-key"
            mock_settings.GROQ_API_KEY = ""
            with patch("app.services.llm_service._call_gemini", return_value="Gemini answer"):
                chunks = list(stream_llm_response("sys", "user", max_tokens=100))

        assert chunks == ["Gemini answer"]
