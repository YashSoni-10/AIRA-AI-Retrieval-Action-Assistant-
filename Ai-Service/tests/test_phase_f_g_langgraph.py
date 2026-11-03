"""
Tests for Phase F & G — LangGraph Agent Loop and Observability
==============================================================
Tests for:
  Phase F: LangGraph Agent Engine (StateGraph, bounded tool iterations, LLM tool selection, backend RBAC enforcement)
  Phase G: Agent Observability (tool_calls, citations, confidence scoring, task_created)
  Endpoints: GET /api/v1/agents and POST /api/v1/agents/execute

Run with:
    cd Ai-Service
    .\\venv\\Scripts\\python.exe -m pytest tests/test_phase_f_g_langgraph.py -v --tb=short
"""

import pytest
import unittest.mock as mock
import uuid
import httpx
from app.services.langgraph_agent import (
    MAX_TOOL_ITERATIONS,
    TOOL_SPECS,
    AgentState,
    _build_agent_graph,
    _run_tool_create_task,
    _run_tool_github_issues,
    _run_tool_github_pulls,
    _run_tool_github_repos,
    _run_tool_search_knowledge,
    _run_tool_summarize_document,
    execute_tool_node,
    finalize_node,
    run_langgraph_agent,
    should_continue,
)
from app.services.agent_service import execute_agent, list_agents


# ── Phase F1: LangGraph Graph Structure & Routing ─────────────────────────────

class TestLangGraphGraphCore:
    """Verify StateGraph architecture and routing logic."""

    def test_graph_builds_and_compiles(self):
        """Graph compiles cleanly with expected nodes."""
        graph = _build_agent_graph()
        assert graph is not None
        # Graph should have nodes defined
        assert "agent_reason" in graph.nodes
        assert "execute_tool" in graph.nodes
        assert "finalize" in graph.nodes

    def test_tool_specs_complete(self):
        """All 6 core tools are registered in TOOL_SPECS."""
        tool_names = {t["name"] for t in TOOL_SPECS}
        expected = {
            "search_knowledge",
            "summarize_document",
            "list_github_repos",
            "get_github_issues",
            "get_github_pulls",
            "create_task",
        }
        assert expected.issubset(tool_names)

    def test_should_continue_routing(self):
        """Routing function correctly determines continue vs finalize."""
        # 1. final_answer -> finalize
        state1: AgentState = {"next_action": "final_answer", "iterations": 1}  # type: ignore
        assert should_continue(state1) == "finalize"

        # 2. None or empty action -> finalize
        state2: AgentState = {"next_action": None, "iterations": 1}  # type: ignore
        assert should_continue(state2) == "finalize"

        # 3. Intermediate tool before limit -> continue
        state3: AgentState = {"next_action": "search_knowledge", "iterations": 2}  # type: ignore
        assert should_continue(state3) == "continue"

        # 4. At max iterations -> finalize (loop prevention)
        state4: AgentState = {"next_action": "search_knowledge", "iterations": MAX_TOOL_ITERATIONS}  # type: ignore
        assert should_continue(state4) == "finalize"

        # 5. Beyond max iterations -> finalize
        state5: AgentState = {"next_action": "search_knowledge", "iterations": MAX_TOOL_ITERATIONS + 2}  # type: ignore
        assert should_continue(state5) == "finalize"


# ── Phase F2: Tool Security & Execution ───────────────────────────────────────

class TestLangGraphToolExecutions:
    """Verify tool execution behavior, error handling, and RBAC enforcement."""

    def test_search_knowledge_tool_empty(self):
        """search_knowledge returns found=False when no chunks match."""
        state: AgentState = {
            "query": "nonexistent query xyz 999",
            "user_id": "test_user",
            "workspace_id": "test_ws",
        }  # type: ignore
        with mock.patch("app.services.langgraph_agent.hybrid_search", return_value=[]):
            res = _run_tool_search_knowledge(state, {"query": "nonexistent query xyz 999"})
            assert res["found"] is False
            assert res["results"] == []

    def test_search_knowledge_tool_with_results(self):
        """search_knowledge formats retrieved chunks cleanly."""
        state: AgentState = {
            "query": "deployment",
            "user_id": "test_user",
            "workspace_id": "test_ws",
        }  # type: ignore
        mock_chunks = [
            {"filename": "deploy.md", "chunk_index": 0, "text": "Deploying via Docker", "score": 0.88},
            {"filename": "deploy.md", "chunk_index": 1, "text": "Kubernetes cluster configuration", "score": 0.75},
        ]
        with mock.patch("app.services.langgraph_agent.hybrid_search", return_value=mock_chunks):
            res = _run_tool_search_knowledge(state, {"query": "deployment"})
            assert res["found"] is True
            assert res["count"] == 2
            assert res["results"][0]["filename"] == "deploy.md"
            assert res["results"][0]["score"] == 0.88

    def test_summarize_document_missing_filename(self):
        """summarize_document requires filename argument."""
        state: AgentState = {"user_id": "u1", "workspace_id": "w1"}  # type: ignore
        res = _run_tool_summarize_document(state, {})
        assert "error" in res

    def test_summarize_document_success(self):
        """summarize_document calls LLM on matched document chunks."""
        state: AgentState = {"user_id": "u1", "workspace_id": "w1"}  # type: ignore
        mock_chunks = [
            {"filename": "spec.md", "chunk_index": 0, "text": "The spec explains system architecture."},
        ]
        with mock.patch("app.services.langgraph_agent.search_bm25", return_value=mock_chunks):
            with mock.patch("app.services.langgraph_agent.get_llm_response", return_value="Summary of spec."):
                res = _run_tool_summarize_document(state, {"filename": "spec.md"})
                assert res["filename"] == "spec.md"
                assert res["summary"] == "Summary of spec."
                assert res["chunks_used"] == 1

    def test_create_task_viewer_forbidden(self):
        """Viewers are strictly forbidden from creating tasks via agent tool."""
        state: AgentState = {
            "query": "Create a task to audit database",
            "user_id": "viewer_1",
            "workspace_id": "ws_1",
            "role": "viewer",
            "raw_token": "mock_jwt",
        }  # type: ignore
        res = _run_tool_create_task(state, {"title": "Audit DB"})
        assert res["task_created"] is False
        assert "Forbidden" in res["error"]

    def test_create_task_member_allowed(self):
        """Members/Admins can create tasks via agent tool."""
        state: AgentState = {
            "query": "Create a task to audit database",
            "user_id": "member_1",
            "workspace_id": "ws_1",
            "role": "member",
            "raw_token": "mock_jwt",
            "conversation_id": None,
        }  # type: ignore
        with mock.patch("app.services.agent_service.tool_create_task") as mock_tool:
            mock_tool.return_value = {
                "task_created": True,
                "task_id": "60d5ec49f1b2c8a123456789",
                "title": "Audit DB",
            }
            res = _run_tool_create_task(state, {"title": "Audit DB", "priority": "high"})
            assert res["task_created"] is True
            assert res["task_id"] == "60d5ec49f1b2c8a123456789"
            mock_tool.assert_called_once()

    def test_execute_tool_node_unknown_tool(self):
        """execute_tool_node handles unknown tools safely without throwing."""
        state: AgentState = {
            "next_action": "non_existent_tool_xyz",
            "next_action_input": {},
            "steps": [],
            "tool_calls": [],
            "tool_results": [],
        }  # type: ignore
        out = execute_tool_node(state)
        assert len(out["tool_results"]) == 1
        assert "Unknown tool" in out["tool_results"][0]["result"]["error"]


# ── Phase F3 & G: Bounded Loop & Observability Schema ─────────────────────────

class TestLangGraphLoopAndObservability:
    """Verify bounded execution loop and rich response schema."""

    def test_finalize_node_extracts_citations_and_confidence(self):
        """finalize_node extracts citations from knowledge results and computes confidence."""
        state: AgentState = {
            "query": "How does auth work?",
            "agent_name": "Knowledge Agent",
            "next_action": "final_answer",
            "next_action_input": {"answer": "Authentication is handled via JWT tokens."},
            "steps": ["Step 1"],
            "tool_calls": [{"tool": "search_knowledge", "arguments": {}, "result_summary": "Found 1 passage"}],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {
                        "results": [
                            {"filename": "auth.md", "chunk_index": 0, "text": "JWT tokens are signed by Node.", "score": 0.95}
                        ]
                    },
                }
            ],
        }  # type: ignore
        out = finalize_node(state)
        assert out["final_answer"] == "Authentication is handled via JWT tokens."
        assert len(out["citations"]) == 1
        assert out["citations"][0]["filename"] == "auth.md"
        assert out["citations"][0]["score"] == 0.95
        assert out["confidence"] >= 0.85
        assert out["status"] == "success"

    def test_bounded_iterations_prevents_infinite_loop(self):
        """Agent stops after MAX_TOOL_ITERATIONS even if LLM keeps requesting tools."""
        call_count = 0

        def mock_llm(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            # Always request another tool
            return '{"thought": "Need more info", "action": "search_knowledge", "action_input": {"query": "test"}}'

        with mock.patch("app.services.langgraph_agent.get_llm_response", side_effect=mock_llm):
            with mock.patch("app.services.langgraph_agent.hybrid_search", return_value=[]):
                res = run_langgraph_agent(
                    agent_id="knowledge",
                    query="Keep searching forever",
                    user_id="user1",
                )
                assert res is not None
                assert res["status"] in ("success", "notice")
                # Iterations should be bounded at MAX_TOOL_ITERATIONS
                assert len(res["tool_calls"]) <= MAX_TOOL_ITERATIONS

    def test_run_langgraph_agent_full_flow(self):
        """Simulate a complete 2-step agent flow: tool call then final answer."""
        steps_outputs = [
            '{"thought": "I should search knowledge base", "action": "search_knowledge", "action_input": {"query": "API rate limits"}}',
            '{"thought": "I have the answer", "action": "final_answer", "action_input": {"answer": "The rate limits are 100 req/min for general API."}}',
        ]
        step_idx = 0

        def mock_llm_flow(*args, **kwargs):
            nonlocal step_idx
            ans = steps_outputs[min(step_idx, len(steps_outputs) - 1)]
            step_idx += 1
            return ans

        mock_chunks = [
            {"filename": "rate_limits.md", "chunk_index": 0, "text": "API rate limits are 100 req/min.", "score": 0.92}
        ]

        with mock.patch("app.services.langgraph_agent.get_llm_response", side_effect=mock_llm_flow):
            with mock.patch("app.services.langgraph_agent.hybrid_search", return_value=mock_chunks):
                result = run_langgraph_agent(
                    agent_id="knowledge",
                    query="What are the API rate limits?",
                    user_id="user_test",
                    workspace_id="ws_test",
                )

                assert result["agent_id"] == "knowledge"
                assert "rate limits are 100 req/min" in result["answer"]
                assert len(result["tool_calls"]) == 1
                assert result["tool_calls"][0]["tool"] == "search_knowledge"
                assert len(result["citations"]) == 1
                assert result["citations"][0]["filename"] == "rate_limits.md"
                assert result["confidence"] >= 0.85


# ── Phase G: End-to-End API Integration ───────────────────────────────────────

class TestAgentServiceAndAPI:
    """Verify execute_agent service and FastAPI /agents endpoints."""

    def test_list_agents(self):
        """list_agents returns the 3 standard AIRA agents."""
        agents = list_agents()
        assert len(agents) == 3
        ids = [a["id"] for a in agents]
        assert "knowledge" in ids
        assert "engineering" in ids
        assert "task" in ids

    def test_execute_agent_unknown(self):
        """execute_agent returns error for unknown agent id."""
        res = execute_agent("unknown_robot", "hello")
        assert "error" in res

    def test_execute_agent_fallback_on_crash(self):
        """execute_agent falls back gracefully if LangGraph fails."""
        with mock.patch("app.services.langgraph_agent.run_langgraph_agent", side_effect=RuntimeError("LangGraph crash")):
            with mock.patch("app.services.agent_service.get_llm_response", return_value="Direct fallback response"):
                res = execute_agent("knowledge", "Explain architecture")
                assert res["status"] == "success"
                assert res["answer"] == "Direct fallback response"
                assert any("Falling back" in s for s in res["steps"])

    def test_api_agents_endpoints_live(self):
        """Test GET /api/v1/agents and POST /api/v1/agents/execute over HTTP."""
        import jwt
        from app.core.config import settings

        secret = settings.JWT_SECRET
        token = jwt.encode(
            {"id": "test_user_123", "email": "test@aira.io", "role": "member", "workspace_id": "ws_123"},
            secret,
            algorithm="HS256",
        )
        headers = {"Authorization": f"Bearer {token}"}

        # 1. GET /api/v1/agents
        r_list = httpx.get("http://127.0.0.1:8000/api/v1/agents", headers=headers, timeout=10.0)
        assert r_list.status_code == 200, f"GET /agents failed: {r_list.text}"
        data = r_list.json()
        assert data["count"] == 3
        assert len(data["agents"]) == 3

        # 2. POST /api/v1/agents/execute
        r_exec = httpx.post(
            "http://127.0.0.1:8000/api/v1/agents/execute",
            headers=headers,
            json={"agent_id": "knowledge", "query": "What is the mission of AIRA?"},
            timeout=60.0,
        )
        assert r_exec.status_code == 200, f"POST /agents/execute failed: {r_exec.text}"
        res = r_exec.json()
        assert res["agent_id"] == "knowledge"
        assert res["query"] == "What is the mission of AIRA?"
        assert "answer" in res and len(res["answer"]) > 0
        assert "steps" in res and len(res["steps"]) > 0
        assert "tool_calls" in res
        assert "citations" in res
        assert "confidence" in res
