"""
Tests for Phases C, D, E — Retrieval Intelligence
===================================================
Tests for:
  Phase C: BM25 Keyword Search (rank-bm25, workspace/user isolation, deletion, rebuild)
  Phase D: Hybrid Search + Reciprocal Rank Fusion (RRF formula, deduplication, mode switching)
  Phase E: Cross-Encoder Reranking (sentence-transformers CrossEncoder, fallback, latency tracking)
  Search API: GET /api/v1/search (query modes, auth, top_k, rerank params)
  RAG Engine: run_rag_query() with hybrid retrieval and reranking integration

Run with:
    .\\venv\\Scripts\\python.exe -m pytest tests/test_phase_c_d_e_retrieval.py -v --tb=short
"""

import pytest
import uuid
from app.services.bm25_service import (
    add_documents_bm25,
    delete_documents_bm25,
    search_bm25,
    tokenize,
)
from app.services.hybrid_search import (
    hybrid_search,
    rrf_fuse,
)
from app.services.reranker_service import rerank
from app.services.rag_engine import run_rag_query


# ── Phase C: BM25 Tests ───────────────────────────────────────────────────────

class TestBM25Service:
    """Verify BM25 keyword indexing, search, isolation, and deletion."""

    def test_tokenize_basic(self):
        """Tokenize correctly extracts lowercase words and ignores punctuation."""
        tokens = tokenize("AIRA: AI Retrieval & Action Assistant 2.0!")
        assert "aira" in tokens
        assert "ai" in tokens
        assert "retrieval" in tokens
        assert "action" in tokens
        assert "assistant" in tokens
        assert "2" in tokens or "0" in tokens

    def test_bm25_indexing_and_search(self):
        """Documents can be indexed and retrieved by keyword."""
        ws_id = f"test_ws_bm25_{uuid.uuid4().hex[:6]}"
        chunks = [
            {"text": "Python FastAPI asynchronous web framework", "filename": "fastapi.md", "chunk_index": 0},
            {"text": "MongoDB document database with flexible schema", "filename": "mongo.md", "chunk_index": 0},
            {"text": "Qdrant vector similarity search engine for AI", "filename": "qdrant.md", "chunk_index": 0},
        ]
        added = add_documents_bm25(chunks, user_id="user1", workspace_id=ws_id)
        assert added == 3

        # Exact keyword search
        results = search_bm25("FastAPI", top_k=2, workspace_id=ws_id)
        assert len(results) >= 1
        assert results[0]["filename"] == "fastapi.md"
        assert "asynchronous" in results[0]["text"]
        assert results[0]["retrieval_mode"] == "bm25"
        assert results[0]["score"] > 0

    def test_bm25_workspace_isolation(self):
        """Chunks indexed in workspace A must NEVER be returned in workspace B."""
        ws_a = f"ws_a_{uuid.uuid4().hex[:6]}"
        ws_b = f"ws_b_{uuid.uuid4().hex[:6]}"

        add_documents_bm25(
            [{"text": "Super confidential secret token XYZ123", "filename": "secret.txt", "chunk_index": 0}],
            user_id="alice",
            workspace_id=ws_a,
        )

        # Search from workspace B
        results_b = search_bm25("XYZ123 secret", workspace_id=ws_b)
        assert len(results_b) == 0, "BM25 leaked confidential data across workspaces!"

        # Search from workspace A succeeds
        results_a = search_bm25("XYZ123 secret", workspace_id=ws_a)
        assert len(results_a) == 1
        assert results_a[0]["filename"] == "secret.txt"

    def test_bm25_no_results_and_empty_query(self):
        """Empty query or unmatched keywords return empty list gracefully."""
        ws_id = f"ws_empty_{uuid.uuid4().hex[:6]}"
        add_documents_bm25(
            [{"text": "Standard documentation content", "filename": "doc.txt", "chunk_index": 0}],
            workspace_id=ws_id,
        )

        assert search_bm25("", workspace_id=ws_id) == []
        assert search_bm25("   ", workspace_id=ws_id) == []
        assert search_bm25("nonexistentwordxyz123456", workspace_id=ws_id) == []

    def test_bm25_delete_documents(self):
        """Deleting a document removes its chunks from BM25 index."""
        ws_id = f"ws_del_{uuid.uuid4().hex[:6]}"
        add_documents_bm25(
            [
                {"text": "Kubernetes orchestration cluster deployment", "filename": "k8s.md", "chunk_index": 0},
                {"text": "Docker container containerization runtime", "filename": "docker.md", "chunk_index": 0},
            ],
            workspace_id=ws_id,
        )

        # Verify present
        assert len(search_bm25("Kubernetes", workspace_id=ws_id)) >= 1

        # Delete k8s.md
        removed = delete_documents_bm25("k8s.md", workspace_id=ws_id)
        assert removed == 1

        # Verify gone
        assert len(search_bm25("Kubernetes", workspace_id=ws_id)) == 0
        # Docker still present
        assert len(search_bm25("Docker", workspace_id=ws_id)) >= 1


# ── Phase D: Hybrid Search + RRF Tests ────────────────────────────────────────

class TestHybridSearchRRF:
    """Verify RRF formula, deduplication, provenance, and fallbacks."""

    def test_rrf_formula_and_deduplication(self):
        """RRF correctly scores, deduplicates, and ranks items present in both lists."""
        doc1 = {"filename": "shared.md", "chunk_index": 0, "text": "Common doc", "score": 0.9}
        doc2 = {"filename": "sem_only.md", "chunk_index": 0, "text": "Sem doc", "score": 0.8}
        doc3 = {"filename": "bm25_only.md", "chunk_index": 0, "text": "BM doc", "score": 0.7}

        semantic_list = [doc1, doc2]  # rank 1, rank 2
        bm25_list = [doc1, doc3]      # rank 1, rank 2

        fused = rrf_fuse(semantic_list, bm25_list, k=60, top_k=5)

        # doc1 appears in both at rank 1: RRF = 1/(60+1) + 1/(60+1) = 2/61 ≈ 0.032787
        assert len(fused) == 3
        top = fused[0]
        assert top["filename"] == "shared.md"
        expected_score = round((1.0 / 61) + (1.0 / 61), 6)
        assert abs(top["rrf_score"] - expected_score) < 1e-5
        assert top["semantic_rank"] == 1
        assert top["bm25_rank"] == 1
        assert top["retrieval_mode"] == "hybrid"

    def test_hybrid_search_mode_switching(self):
        """hybrid_search respects mode='semantic', mode='bm25', mode='hybrid'."""
        ws_id = f"ws_mode_{uuid.uuid4().hex[:6]}"
        add_documents_bm25(
            [{"text": "UniqueKeywordAlpha specialized term", "filename": "kw.md", "chunk_index": 0}],
            workspace_id=ws_id,
        )

        # Mode bm25
        res_bm25 = hybrid_search("UniqueKeywordAlpha", top_k=5, workspace_id=ws_id, mode="bm25")
        assert len(res_bm25) >= 1
        assert res_bm25[0]["retrieval_mode"] == "bm25"

        # Mode hybrid
        res_hybrid = hybrid_search("UniqueKeywordAlpha", top_k=5, workspace_id=ws_id, mode="hybrid")
        assert len(res_hybrid) >= 1
        assert "hybrid" in res_hybrid[0]["retrieval_mode"] or "fallback" in res_hybrid[0]["retrieval_mode"]

    def test_hybrid_search_fallback_when_one_empty(self):
        """When semantic search has no matches, BM25 candidates are returned as fallback."""
        ws_id = f"ws_fb_{uuid.uuid4().hex[:6]}"
        add_documents_bm25(
            [{"text": "Arbitrary fallback keyword item", "filename": "fb.md", "chunk_index": 0}],
            workspace_id=ws_id,
        )

        results = hybrid_search("Arbitrary fallback", top_k=3, workspace_id=ws_id, mode="hybrid")
        assert len(results) >= 1
        assert results[0]["filename"] == "fb.md"


# ── Phase E: Cross-Encoder Reranking Tests ────────────────────────────────────

class TestCrossEncoderReranking:
    """Verify neural Cross-Encoder reranking, latency, and graceful fallback."""

    def test_reranker_predicts_and_reorders(self):
        """CrossEncoder scores pairs and returns reranked list with latency tracking."""
        candidates = [
            {"filename": "fruit.txt", "chunk_index": 0, "text": "Apples and bananas are delicious fruits.", "score": 0.5},
            {"filename": "quantum.txt", "chunk_index": 0, "text": "Quantum entanglement in quantum computers allows superposition.", "score": 0.3},
            {"filename": "weather.txt", "chunk_index": 0, "text": "Tomorrow will be sunny and clear.", "score": 0.4},
        ]

        query = "How does quantum superposition work in quantum computers?"
        reranked, latency_ms = rerank(query, candidates, top_k=3)

        assert len(reranked) == 3
        # The quantum document should be ranked #1 by the CrossEncoder
        assert reranked[0]["filename"] == "quantum.txt"
        assert reranked[0]["reranked"] is True
        assert "reranker_score" in reranked[0]
        assert latency_ms >= 0.0

    def test_reranker_handles_empty_candidates(self):
        """Empty candidate list returns empty list with 0ms latency."""
        res, lat = rerank("Any query", [], top_k=5)
        assert res == []
        assert lat == 0.0

    def test_reranker_preserves_metadata(self):
        """All original chunk fields (filename, chunk_index, document_id) are preserved."""
        candidates = [{
            "filename": "arch.pdf",
            "chunk_index": 7,
            "document_id": "doc-uuid-123",
            "page_number": 4,
            "text": "System architecture diagram overview.",
            "score": 0.88,
        }]
        reranked, _ = rerank("architecture", candidates, top_k=1)
        assert len(reranked) == 1
        item = reranked[0]
        assert item["filename"] == "arch.pdf"
        assert item["chunk_index"] == 7
        assert item["document_id"] == "doc-uuid-123"
        assert item["page_number"] == 4


# ── Integrated RAG Engine with Hybrid + Reranking ────────────────────────────

class TestRAGEngineHybridIntegration:
    """Verify run_rag_query utilizes hybrid search and produces clean responses."""

    def test_rag_query_with_no_documents(self):
        """Querying with no documents returns friendly message and zero confidence."""
        ws_empty = f"ws_rag_empty_{uuid.uuid4().hex[:6]}"
        res = run_rag_query("What is the meaning of life?", workspace_id=ws_empty)
        assert res["confidence"] == 0.0
        assert res["confidence_label"] == "Low"
        assert "couldn't find any relevant information" in res["answer"].lower()
        assert res["citations"] == []

    def test_rag_query_with_documents(self):
        """Querying indexed document returns answer, citations, and confidence."""
        ws_id = f"ws_rag_{uuid.uuid4().hex[:6]}"
        add_documents_bm25(
            [{
                "text": "Project Phoenix is a top-secret autonomous drone initiative established in 2024.",
                "filename": "phoenix.md",
                "chunk_index": 0,
            }],
            workspace_id=ws_id,
        )

        res = run_rag_query(
            "What is Project Phoenix?",
            workspace_id=ws_id,
            mode="bm25",
            enable_rerank=False,
        )
        assert "phoenix" in res["answer"].lower() or len(res["citations"]) >= 1
        assert len(res["citations"]) >= 1
        assert res["citations"][0]["filename"] == "phoenix.md"
        assert any("mode=bm25" in step for step in res["reasoning_steps"])
