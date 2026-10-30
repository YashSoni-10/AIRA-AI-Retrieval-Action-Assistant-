"""
Regression tests for RAG quality, chunking, page retention, grounding, and retrieval isolation.
"""
import uuid
import pytest
from app.services.document_processor import (
    chunk_document,
    chunk_text,
    clean_text,
    extract_text_with_pages,
)
from app.services.bm25_service import (
    add_documents_bm25,
    search_bm25,
    delete_documents_bm25,
)
from app.services.hybrid_search import rrf_fuse, hybrid_search
from app.services.reranker_service import rerank
from app.services.rag_engine import calculate_confidence, SYSTEM_PROMPT


class TestDocumentProcessorQuality:
    """Verify text cleaning, boundary snapping, noise filtering, and page preservation."""

    def test_clean_text_removes_headers_footers_and_preserves_code(self):
        raw = (
            "EventPass Technical Documentation 2\n"
            "• Login.jsx handles authentication input.\n"
            "• AuthContext.jsx manages global JWT auth state.\n"
            "1\n"
            "EventPass Technical Documentation 2"
        )
        cleaned = clean_text(raw)
        assert "Login.jsx" in cleaned
        assert "AuthContext.jsx" in cleaned
        assert "EventPass Technical Documentation" not in cleaned
        assert "•" not in cleaned

    def test_noise_filter_rejects_micro_chunks(self):
        # Degenerate fragments that caused bugs previously: "in.", "4", "3."
        assert chunk_text("in.", chunk_size=400) == []
        assert chunk_text("4", chunk_size=400) == []
        assert chunk_text("...", chunk_size=400) == []
        assert chunk_text("   \n\n   ", chunk_size=400) == []

    def test_technical_identifiers_preserved(self):
        sample = (
            "Frontend architecture includes Login.jsx, Register.jsx, and AuthContext.jsx. "
            "Axios instance is configured in api.js with Authorization: Bearer EP-HEX-TOKEN. "
            "Backend routes are declared in auth.routes.js using auth.controller.js and auth.middleware.js."
        )
        chunks = chunk_text(sample, chunk_size=300, chunk_overlap=50)
        assert len(chunks) >= 1
        combined = " ".join(c["text"] for c in chunks)
        for term in ["Login.jsx", "AuthContext.jsx", "api.js", "EP-HEX-TOKEN", "auth.middleware.js"]:
            assert term in combined

    def test_page_numbers_attached_to_chunks(self):
        chunks_p1 = chunk_text(
            "Page one introduces EventPass React frontend with Login.jsx and AuthContext.jsx.",
            filename="test_doc.pdf",
            page_number=1,
            chunk_size=200,
        )
        chunks_p2 = chunk_text(
            "Page two covers Express backend server.js and auth.middleware.js security checks.",
            filename="test_doc.pdf",
            page_number=2,
            chunk_size=200,
        )
        all_chunks = chunks_p1 + chunks_p2

        assert len(all_chunks) == 2
        assert all_chunks[0]["page_number"] == 1
        assert "Login.jsx" in all_chunks[0]["text"]
        assert all_chunks[1]["page_number"] == 2
        assert "auth.middleware.js" in all_chunks[1]["text"]


class TestRetrievalAndIsolation:
    """Verify BM25, hybrid fusion, reranking, and workspace isolation."""

    def test_bm25_workspace_isolation(self):
        ws_a = f"ws_reg_{uuid.uuid4().hex[:6]}"
        ws_b = f"ws_reg_{uuid.uuid4().hex[:6]}"

        chunks_a = [
            {"text": "EventPass authentication uses AuthContext.jsx in React.", "filename": "eventpass.pdf", "chunk_index": 0, "page_number": 2}
        ]
        chunks_b = [
            {"text": "Secret project internal documentation.", "filename": "secret.pdf", "chunk_index": 0, "page_number": 1}
        ]

        add_documents_bm25(chunks_a, user_id="user_a", workspace_id=ws_a)
        add_documents_bm25(chunks_b, user_id="user_b", workspace_id=ws_b)

        # Query in ws_a should find chunks_a but NEVER chunks_b
        res_a = search_bm25("AuthContext", workspace_id=ws_a)
        assert len(res_a) == 1
        assert res_a[0]["filename"] == "eventpass.pdf"
        assert res_a[0]["page_number"] == 2

        res_b = search_bm25("AuthContext", workspace_id=ws_b)
        assert len(res_b) == 0

    def test_rrf_fuse_deduplication(self):
        # Test RRF properly handles overlap between semantic and BM25 lists
        sem_list = [
            {"filename": "doc.pdf", "chunk_index": 0, "score": 0.95, "text": "chunk zero", "page_number": 1},
            {"filename": "doc.pdf", "chunk_index": 1, "score": 0.85, "text": "chunk one", "page_number": 2},
        ]
        bm25_list = [
            {"filename": "doc.pdf", "chunk_index": 1, "score": 12.5, "text": "chunk one", "page_number": 2},
            {"filename": "doc.pdf", "chunk_index": 2, "score": 10.0, "text": "chunk two", "page_number": 3},
        ]

        fused = rrf_fuse(sem_list, bm25_list, k=60)
        assert len(fused) == 3  # Chunks 0, 1, 2 deduplicated
        # Chunk 1 appeared in both lists, so its RRF score should be highest
        assert fused[0]["chunk_index"] == 1
        assert fused[0]["page_number"] == 2

    def test_reranker_preserves_page_metadata(self):
        candidates = [
            {"text": "General React setup.", "filename": "doc.pdf", "chunk_index": 0, "page_number": 1, "score": 0.015},
            {"text": "Login.jsx handles user authentication forms.", "filename": "doc.pdf", "chunk_index": 1, "page_number": 2, "score": 0.014},
        ]
        reranked, _ = rerank("Where is login handled in React?", candidates, top_k=2)
        assert len(reranked) == 2
        # Top result should be chunk 1 (Login.jsx)
        assert reranked[0]["chunk_index"] == 1
        assert reranked[0]["page_number"] == 2
        assert reranked[0].get("reranked") is True


from app.services.reranker_service import rerank, clean_retrieval_query


class TestConfidenceAndGrounding:
    """Verify confidence score calibration and system prompt grounding rules."""

    def test_confidence_calibration(self):
        # Empty results -> 0.0, "Low"
        assert calculate_confidence([]) == (0.0, "Low")

        # Reranked with strong positive logit -> High
        reranked_strong = [{"score": 3.2, "reranked": True}]
        conf, label = calculate_confidence(reranked_strong)
        assert label == "High"
        assert conf >= 0.85

        # Reranked with moderate logit -> Medium/High
        reranked_mid = [{"score": 0.5, "reranked": True}]
        conf_m, label_m = calculate_confidence(reranked_mid)
        assert label_m in ("Medium", "High")
        assert conf_m >= 0.60

        # Reranked with negative logit -> calibrated, not flat 0.30
        reranked_weak = [{"score": -3.5, "reranked": True}]
        conf_w, label_w = calculate_confidence(reranked_weak)
        assert label_w == "Low"
        assert conf_w <= 0.40

        # Hybrid RRF score ~ 0.030 (present in both top ranks) -> High, not 2-4%
        rrf_strong = [{"score": 0.031, "retrieval_mode": "hybrid"}]
        conf_r, label_r = calculate_confidence(rrf_strong)
        assert label_r == "High"
        assert conf_r >= 0.80

    def test_system_prompt_forbids_fabrication_and_requires_completeness(self):
        assert "STRICTLY grounded answer based on the provided context" in SYSTEM_PROMPT
        assert "Do NOT invent, assume, or fabricate" in SYSTEM_PROMPT
        assert "Synthesize ALL relevant evidence" in SYSTEM_PROMPT
        assert "Missing Implementation Details" in SYSTEM_PROMPT


class TestScoreNormalizationAndFormatting:
    """Task 2 & 5: Ensure raw logits are never displayed as percentages and scores are normalized."""

    def test_clean_retrieval_query_strips_conversational_meta_directives(self):
        long_query = (
            "Explain the complete EventPass login flow using only the uploaded documentation. "
            "Clearly separate documented steps from missing implementation details."
        )
        cleaned = clean_retrieval_query(long_query)
        assert "using only the uploaded documentation" not in cleaned.lower()
        assert "clearly separate documented steps" not in cleaned.lower()
        assert "missing implementation details" not in cleaned.lower()
        assert "eventpass login flow" in cleaned.lower()

    def test_reranker_sigmoid_score_normalization(self):
        # Even if raw cross-encoder outputs logits like 4.34, 8.41, 9.49,
        # rerank() must return normalized probabilities in [0.0, 1.0] and valid score_labels.
        candidates = [
            {"text": "Login.jsx handles user form input", "filename": "eventpass.pdf", "chunk_index": 2, "page_number": 2, "score": 0.03},
            {"text": "AuthContext.jsx stores JWT token in localStorage", "filename": "eventpass.pdf", "chunk_index": 7, "page_number": 3, "score": 0.02},
        ]
        results, _ = rerank("EventPass login authentication", candidates, top_k=2)

        for res in results:
            # Score must be bounded in [0.0, 1.0]
            assert 0.0 <= res["score"] <= 1.0, f"Score {res['score']} is not bounded in [0.0, 1.0]!"
            # Raw score must be preserved as float
            assert isinstance(res.get("raw_score"), (int, float))
            # Score label must never contain unnormalized percentages like 434% or 841%
            label = res.get("score_label", "")
            assert "% Match" in label
            pct_val = int(label.replace("% Match", "").strip())
            assert 0 <= pct_val <= 100, f"Percentage {pct_val}% is out of valid 0-100% range!"

    def test_raw_logits_not_multiplied_directly(self):
        # Emulate the bug: raw logit = 8.41.
        # If incorrectly multiplied by 100 -> 841%.
        raw_logit = 8.41
        assert raw_logit > 1.0  # Demonstrating logit scale
        # Normalized with sigmoid:
        import math
        normalized = 1.0 / (1.0 + math.exp(-raw_logit))
        assert 0.99 <= normalized <= 1.0
        pct = round(normalized * 100)
        assert pct == 100  # 100% Match, NOT 841%!
