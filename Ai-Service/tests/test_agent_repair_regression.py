"""
Regression tests for Agent Repair, GitHub Argument Resolution, Task Retrieval,
Raw Tool JSON Leakage Prevention, and RAG Deduplication.
"""

import json
import re
import pytest
from unittest.mock import MagicMock, patch

from app.services.langgraph_agent import (
    is_raw_tool_json,
    is_answer_incomplete,
    _extract_text_from_answer,
    _unescape_json_string,
    sanitize_mojibake,
    clean_parser_artifacts,
    _clean_repo_slug,
    _resolve_repo_argument,
    _run_tool_search_knowledge,
    _run_tool_create_task,
    _run_tool_update_task,
    _run_tool_delete_task,
    _run_tool_list_tasks,
    _run_tool_get_task,
    _run_tool_search_tasks,
    _run_tool_github_repos,
    _run_tool_github_issues,
    _run_tool_github_pulls,
    agent_reason_node,
    execute_tool_node,
    finalize_node,
    TOOL_SPECS,
    TOOL_RUNNERS,
    ACTION_ALIASES,
    normalize_action_name,
    AgentState,
)
from app.services.document_processor import sanitize_mojibake as doc_sanitize_mojibake
from app.services.agent_service import AGENTS


class TestRawToolJsonPrevention:
    """Tests ensuring internal provider tool-call payloads never leak to users."""

    def test_is_raw_tool_json_detects_browser_open(self):
        raw_payload = '{"name": "browser.open", "arguments": {"cursor": 0, "id": 0}}'
        assert is_raw_tool_json(raw_payload) is True

    def test_is_raw_tool_json_detects_action_dict(self):
        raw_action = '{"action": "search_knowledge", "action_input": {"query": "architecture"}}'
        assert is_raw_tool_json(raw_action) is True

    def test_is_raw_tool_json_ignores_legitimate_markdown(self):
        markdown_text = "Here is the EventPass architecture overview:\n- Frontend: React\n- Backend: Express"
        assert is_raw_tool_json(markdown_text) is False

    def test_is_raw_tool_json_empty_and_none(self):
        assert is_raw_tool_json("") is False
        assert is_raw_tool_json(None) is False

    def test_agent_reason_node_rejects_unsupported_tool(self):
        """If the LLM returns an unsupported action (e.g. browser.open), reject it."""
        mock_raw = '{"name": "browser.open", "arguments": {"cursor": 0, "id": 0}}'
        state: AgentState = {
            "query": "Summarize EventPass",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        with patch("app.services.langgraph_agent.get_llm_response", return_value=mock_raw):
            res = agent_reason_node(state)
            assert res["next_action"] == "final_answer"
            # Must not leak the raw JSON in next_action_input
            ans = res["next_action_input"].get("answer", "")
            assert "browser.open" not in ans or "do not have access" in ans

    def test_finalize_node_replaces_raw_tool_json_with_synthesized_answer(self):
        """If final answer contains raw JSON, finalize_node must re-synthesize user-facing answer."""
        state: AgentState = {
            "query": "Summarize architecture",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {"results": [{"filename": "eventpass.pdf", "chunk_index": 1, "text": "EventPass uses React and Node."}]}
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {"answer": '{"name": "browser.open", "arguments": {"cursor": 0}}'},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        with patch("app.services.langgraph_agent.get_llm_response", return_value="The EventPass architecture consists of React and Node.js."):
            res = finalize_node(state)
            assert is_raw_tool_json(res["final_answer"]) is False
            assert "EventPass architecture" in res["final_answer"]
            assert res["status"] == "success"


class TestGitHubArgumentResolution:
    """Tests resolving repo arguments and preventing HTTP 400 errors."""

    def test_direct_valid_repo_passed(self):
        state = {"tool_results": []}
        repo, err = _resolve_repo_argument(state, {"repo": "myorg/myrepo"})
        assert repo == "myorg/myrepo"
        assert err is None

    def test_single_repo_resolved_from_prior_list_call(self):
        state = {
            "tool_results": [
                {
                    "tool": "list_github_repos",
                    "result": {
                        "connected": True,
                        "repos": [{"full_name": "aira-ai/backend", "name": "backend"}],
                    },
                }
            ]
        }
        repo, err = _resolve_repo_argument(state, {"state": "open"})
        assert repo == "aira-ai/backend"
        assert err is None

    def test_multiple_repos_returns_helpful_error_not_400(self):
        state = {
            "tool_results": [
                {
                    "tool": "list_github_repos",
                    "result": {
                        "connected": True,
                        "repos": [
                            {"full_name": "aira-ai/frontend", "name": "frontend"},
                            {"full_name": "aira-ai/backend", "name": "backend"},
                        ],
                    },
                }
            ]
        }
        repo, err = _resolve_repo_argument(state, {"state": "open"})
        assert repo is None
        assert err is not None
        assert "Multiple repositories found" in err["error"]
        assert "aira-ai/frontend" in err["error"]

    def test_partial_repo_matching(self):
        state = {
            "tool_results": [
                {
                    "tool": "list_github_repos",
                    "result": {
                        "connected": True,
                        "repos": [
                            {"full_name": "aira-ai/frontend", "name": "frontend"},
                            {"full_name": "aira-ai/backend", "name": "backend"},
                        ],
                    },
                }
            ]
        }
        repo, err = _resolve_repo_argument(state, {"repo": "backend"})
        assert repo == "aira-ai/backend"
        assert err is None


class TestTaskAgentRetrievalTools:
    """Tests verifying Task Agent tools in LangGraph and Agent Service."""

    def test_tool_specs_contain_all_task_crud_tools(self):
        tool_names = [t["name"] for t in TOOL_SPECS]
        assert "create_task" in tool_names
        assert "list_tasks" in tool_names
        assert "get_task" in tool_names
        assert "search_tasks" in tool_names
        assert "update_task" in tool_names

    def test_tool_runners_contain_all_task_crud_tools(self):
        assert "create_task" in TOOL_RUNNERS
        assert "list_tasks" in TOOL_RUNNERS
        assert "get_task" in TOOL_RUNNERS
        assert "search_tasks" in TOOL_RUNNERS
        assert "update_task" in TOOL_RUNNERS

    def test_task_agent_definition_has_retrieval_tools(self):
        task_agent = AGENTS["task"]
        assert "list_tasks" in task_agent["tools"]
        assert "get_task" in task_agent["tools"]
        assert "search_tasks" in task_agent["tools"]
        assert "update_task" in task_agent["tools"]

    def test_viewer_role_blocks_create_update_delete(self):
        state = {
            "role": "viewer",
            "query": "Create regression test task",
            "raw_token": "token",
        }
        res_create = _run_tool_create_task(state, {"title": "Test"})
        assert res_create["task_created"] is False
        assert "Forbidden" in res_create["error"]

        res_update = _run_tool_update_task(state, {"task_id": "123", "status": "done"})
        assert res_update["task_updated"] is False
        assert "Forbidden" in res_update["error"]

        res_delete = _run_tool_delete_task(state, {"task_id": "123"})
        assert res_delete["deleted"] is False
        assert "Forbidden" in res_delete["error"]

    @patch("httpx.Client.get")
    def test_run_tool_list_tasks(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "tasks": [
                {"_id": "t1", "title": "AIRA Agent Regression Test", "priority": "medium", "status": "todo"}
            ]
        }
        mock_get.return_value = mock_resp

        state = {"raw_token": "test_token"}
        res = _run_tool_list_tasks(state, {"status": "todo"})
        assert res["count"] == 1
        assert res["tasks"][0]["title"] == "AIRA Agent Regression Test"

    @patch("httpx.Client.get")
    def test_run_tool_search_tasks(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "tasks": [
                {"_id": "t1", "title": "AIRA Agent Regression Test", "priority": "medium", "status": "todo"}
            ]
        }
        mock_get.return_value = mock_resp

        state = {"raw_token": "test_token", "query": "find task"}
        res = _run_tool_search_tasks(state, {"query": "Regression Test"})
        assert res["count"] == 1
        assert res["tasks"][0]["title"] == "AIRA Agent Regression Test"
        assert "Found 1 matching task" in res["message"]


class TestSearchDeduplicationAndCitations:
    """Tests verifying search deduplication and citation deduplication."""

    def test_search_deduplication_in_same_run(self):
        prior_result = {
            "query": "EventPass architecture overview",
            "results": [{"filename": "arch.pdf", "chunk_index": 0, "text": "React frontend"}],
            "count": 1,
            "found": True,
        }
        state: AgentState = {
            "query": "EventPass architecture overview",
            "user_id": "u1",
            "workspace_id": "w1",
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": prior_result,
                }
            ],
        }

        # Calling _run_tool_search_knowledge with essentially identical query should return cached deduplicated result
        res = _run_tool_search_knowledge(state, {"query": "EventPass architecture overview"})
        assert res.get("deduplicated") is True
        assert res["count"] == 1

    def test_citation_deduplication_in_finalize_node(self):
        state: AgentState = {
            "query": "Summarize architecture",
            "agent_id": "knowledge",
            "agent_name": "Knowledge Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {
                        "results": [
                            {"filename": "doc.pdf", "chunk_index": 1, "text": "Chunk 1 text", "score": 0.95},
                            {"filename": "doc.pdf", "chunk_index": 2, "text": "Chunk 2 text", "score": 0.85},
                        ]
                    },
                },
                {
                    "tool": "search_knowledge",
                    "result": {
                        "results": [
                            # Duplicate of chunk 1
                            {"filename": "doc.pdf", "chunk_index": 1, "text": "Chunk 1 text", "score": 0.95},
                            {"filename": "doc.pdf", "chunk_index": 3, "text": "Chunk 3 text", "score": 0.75},
                        ]
                    },
                },
            ],
            "steps": [],
            "iterations": 2,
            "next_action": "final_answer",
            "next_action_input": {"answer": "The architecture is well documented."},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        res = finalize_node(state)
        # Should deduplicate 4 chunks down to 3 unique chunks (chunk 1, 2, 3)
        assert len(res["citations"]) == 3
        chunk_indices = [c["chunk_index"] for c in res["citations"]]
        assert chunk_indices == [1, 2, 3]


class TestAgentConsolidatedRegressionFixes:
    """Consolidated regression tests for Task updates, GitHub repo resolution, and calibrated confidence."""

    def test_resolve_repo_with_repositories_key(self):
        state = {
            "tool_results": [
                {
                    "tool": "list_github_repos",
                    "result": {
                        "connected": True,
                        "repositories": [{"full_name": "aira-ai/backend", "name": "backend"}],
                    },
                }
            ]
        }
        repo, err = _resolve_repo_argument(state, {"state": "open"})
        assert repo == "aira-ai/backend"
        assert err is None

    @patch("app.services.langgraph_agent.get_github_repos")
    def test_resolve_repo_live_auto_resolve_when_not_previously_called(self, mock_get_repos):
        mock_get_repos.return_value = {
            "connected": True,
            "repositories": [{"full_name": "aira-workspace/AIRA", "name": "AIRA"}],
        }
        state = {"tool_results": [], "raw_token": "valid_token"}
        repo, err = _resolve_repo_argument(state, {"state": "open"})
        assert repo == "aira-workspace/AIRA"
        assert err is None

    @patch("httpx.Client.patch")
    def test_update_task_normalizes_hyphenated_status(self, mock_patch):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "task": {
                "_id": "670c1234567890abcdef1234",
                "title": "Fix login bug",
                "status": "in_progress",
                "priority": "high",
            }
        }
        mock_patch.return_value = mock_resp

        state = {
            "role": "member",
            "raw_token": "jwt_token_123",
            "tool_results": [],
        }
        res = _run_tool_update_task(state, {
            "task_id": "670c1234567890abcdef1234",
            "status": "in-progress",
        })
        assert res["task_updated"] is True
        assert res["status"] == "in_progress"
        # Verify patch was called with normalized status in_progress
        call_kwargs = mock_patch.call_args.kwargs
        assert call_kwargs["json"]["status"] == "in_progress"

    def test_update_task_rejects_invalid_status_without_mentioning_auth_token(self):
        state = {
            "role": "member",
            "raw_token": "jwt_token_123",
            "tool_results": [],
        }
        res = _run_tool_update_task(state, {
            "task_id": "670c1234567890abcdef1234",
            "status": "invalid-status-xyz",
        })
        assert res["task_updated"] is False
        assert "Invalid status" in res["error"]
        assert "auth token" not in res["error"].lower()

    @patch("httpx.Client.patch")
    def test_update_task_resolves_task_id_from_id_or_previous_tool_result(self, mock_patch):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "task": {
                "_id": "task_from_create_123",
                "title": "Test task",
                "status": "completed",
                "priority": "low",
            }
        }
        mock_patch.return_value = mock_resp

        # State where create_task just executed
        state = {
            "role": "member",
            "raw_token": "jwt_token_123",
            "task_created": {"task_id": "task_from_create_123", "title": "Test task"},
            "tool_results": [
                {"tool": "create_task", "result": {"task_id": "task_from_create_123"}}
            ],
        }
        # LLM calls update_task with id: <task_id> or no task_id
        res = _run_tool_update_task(state, {"id": "<task_id>", "status": "completed"})
        assert res["task_updated"] is True
        assert res["task_id"] == "task_from_create_123"

    def test_finalize_node_high_confidence_with_reranked_citations(self):
        state: AgentState = {
            "query": "Explain EventPass login flow",
            "agent_id": "knowledge",
            "agent_name": "Knowledge Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [{"tool": "search_knowledge", "arguments": {}, "result_summary": "ok"}],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {
                        "results": [
                            {
                                "filename": "EventPass.pdf",
                                "chunk_index": 0,
                                "text": "EventPass authentication uses JWT tokens and AuthContext.jsx with api.js.",
                                "score": 0.028,
                                "rerank_score": 1.85,
                                "raw_score": 1.85,
                                "relevance_score": 0.86,
                                "reranked": True,
                            }
                        ]
                    },
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {
                "answer": "### Documented Login Flow\nEventPass uses AuthContext and JWT tokens stored in localStorage."
            },
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.5,
            "error": None,
            "status": "in_progress",
        }

        res = finalize_node(state)
        # Confidence must be statistically calibrated (> 0.75 / High) rather than low 10%
        assert res["confidence"] >= 0.75
        assert len(res["citations"]) == 1
        assert res["citations"][0]["reranked"] is True

    @patch("app.services.langgraph_agent.get_llm_response")
    def test_finalize_node_never_outputs_generic_cop_out_on_raw_json(self, mock_llm):
        # LLM returns a raw JSON action payload even when prompted for answer
        mock_llm.return_value = '{"name": "browser.open", "arguments": {"cursor": 0}}'
        state: AgentState = {
            "query": "Update task status to completed",
            "agent_id": "task",
            "agent_name": "Task Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [
                {
                    "tool": "update_task",
                    "result": {
                        "task_updated": True,
                        "task_id": "task_abc",
                        "status": "completed",
                    },
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {"answer": ""},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.5,
            "error": None,
            "status": "in_progress",
        }

        res = finalize_node(state)
        ans = res["final_answer"]
        # Must never return the cop-out sentence
        assert "I executed the requested operations and gathered the workspace data. Please review the execution log above for details." not in ans
        # Must summarize authoritative task outcome
        assert "task_abc" in ans or "completed" in ans


class TestKnowledgeAgentSynthesisRegression:
    """
    Automated regression tests for the Knowledge Agent answer-synthesis bug:
    - Valid synthesized markdown extraction
    - Markdown-fenced and JSON-wrapped answers
    - Literal unescaped newlines in model JSON
    - Varied answer keys (explanation, content, response, text)
    - Distinguishing raw tool payloads from structured answers
    - Redundant search suppression when knowledge is already retrieved
    - Full synthesis path preserving user request, citations, and honest grounding
    - Transparent fallback notices when synthesis generation fails
    """

    def test_extract_text_valid_markdown_unchanged(self):
        text = "### Architecture\nThis is a standard markdown explanation.\n- Step 1\n- Step 2"
        assert _extract_text_from_answer(text) == text

    def test_extract_text_markdown_fenced_json(self):
        payload = """```json
{
  "thought": "I have completed the synthesis",
  "action": "final_answer",
  "action_input": {
    "answer": "### Frontend\\nLogin request initiated via AuthContext.\\n\\n### Backend\\nExpress router handles /api/auth/login."
  }
}
```"""
        extracted = _extract_text_from_answer(payload)
        assert "### Frontend" in extracted
        assert "Express router handles" in extracted
        assert "```json" not in extracted

    def test_extract_text_json_with_literal_unescaped_newlines(self):
        # Raw string with actual newline characters inside the quotes (invalid standard JSON, common LLM quirk)
        payload = '{\n  "thought": "Synthesizing",\n  "answer": "Line one\\nLine two\\nLine three"\n}'
        extracted = _extract_text_from_answer(payload)
        assert "Line one" in extracted
        assert "Line two" in extracted

    def test_extract_text_varied_answer_keys(self):
        for key in ("explanation", "content", "response", "text", "summary"):
            payload = json.dumps({key: f"This is substantive content provided under the {key} field."})
            assert f"under the {key} field" in _extract_text_from_answer(payload)

    def test_extract_text_from_string_action_input(self):
        payload = json.dumps({
            "action": "final_answer",
            "action_input": "Direct explanation provided as a raw string inside action_input."
        })
        assert "Direct explanation provided as a raw string" in _extract_text_from_answer(payload)

    def test_is_raw_tool_json_discrimination(self):
        # Actual tool call stubs must be flagged
        assert is_raw_tool_json('{"name": "browser.open", "arguments": {"cursor": 0}}') is True
        assert is_raw_tool_json('{"action": "browser.open", "action_input": {}}') is True
        assert is_raw_tool_json('{"action": "search_knowledge", "action_input": {"query": "login"}}') is True

        # Synthesized answers in JSON wrappers must NOT be flagged as raw tool JSON
        assert is_raw_tool_json('{"action": "final_answer", "action_input": {"answer": "This is a detailed synthesized answer that explains the entire login flow."}}') is False
        assert is_raw_tool_json('{"thought": "Synthesizing answer", "explanation": "This is a comprehensive technical explanation addressing the user request."}') is False
        assert is_raw_tool_json("### Documented Architecture\nHere is the full markdown explanation.") is False

    @patch("app.services.langgraph_agent.get_llm_response")
    def test_agent_reason_node_redirects_redundant_search_when_knowledge_retrieved(self, mock_llm):
        # LLM attempts to propose another search_knowledge call
        mock_llm.return_value = json.dumps({
            "thought": "Let me search again for login details",
            "action": "search_knowledge",
            "action_input": {"query": "EventPass login flow documentation"}
        })

        state: AgentState = {
            "query": "Explain EventPass login flow",
            "agent_id": "knowledge",
            "agent_name": "Knowledge Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [{"tool": "search_knowledge", "arguments": {"query": "login"}, "result_summary": "ok"}],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {
                        "found": True,
                        "results": [
                            {"filename": "EventPass_Project_Documentation.pdf", "chunk_index": 0, "text": "Auth flow details"}
                        ]
                    }
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.5,
            "error": None,
            "status": "in_progress",
        }

        res = agent_reason_node(state)
        # Must be redirected to final_answer synthesis rather than repeating search_knowledge
        assert res["next_action"] == "final_answer"

    @patch("app.services.langgraph_agent.get_llm_response")
    def test_finalize_node_synthesizes_eventpass_login_flow_without_repeating_retrieved_knowledge(self, mock_llm):
        """
        Exact bug reproduction test:
        Verifies that when the user asks for a structured login flow explanation,
        finalize_node does NOT return '- **Retrieved Knowledge**: 3 relevant passages found',
        but rather passes the user's query and evidence to the LLM and produces the structured answer.
        """
        user_query = (
            "Using only my uploaded EventPass_Project_Documentation.pdf, explain how a login request "
            "travels from the frontend through backend authentication and database access. Structure the answer into "
            "Frontend, Backend, Database, Authentication, and Request Flow. Cite the relevant document passages. "
            "Clearly mention anything the document does not establish. Do not invent missing details."
        )

        mock_llm.return_value = """### Frontend
The login form in `Login.jsx` collects user credentials and dispatches a request via `api.js`.

### Backend
The request arrives at `POST /api/auth/login` where `authController.js` validates credentials.

### Database
Mongoose queries the User collection in MongoDB to verify the user account.

### Authentication
A JWT token is signed and returned upon successful validation.

### Request Flow
1. User enters email/password.
2. `api.post('/auth/login')` dispatches request.
3. Express server authenticates against MongoDB.
4. JWT token returned to client and stored in localStorage.

### Missing or Undocumented Details
The document does not establish the specific password-hashing algorithm (e.g. bcrypt salt rounds), database query timeouts, or refresh token rotation mechanism."""

        state: AgentState = {
            "query": user_query,
            "agent_id": "knowledge",
            "agent_name": "Knowledge Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [{"tool": "search_knowledge", "arguments": {}, "result_summary": "3 passages"}],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {
                        "found": True,
                        "results": [
                            {
                                "filename": "EventPass_Project_Documentation.pdf",
                                "chunk_index": 0,
                                "text": "Frontend uses AuthContext and api.js to submit login credentials.",
                                "score": 0.03,
                                "rerank_score": 1.9,
                                "raw_score": 1.9,
                                "relevance_score": 0.9,
                                "reranked": True,
                            },
                            {
                                "filename": "EventPass_Project_Documentation.pdf",
                                "chunk_index": 1,
                                "text": "Backend handles authentication at POST /api/auth/login with Express and JWT.",
                                "score": 0.028,
                                "rerank_score": 1.8,
                                "raw_score": 1.8,
                                "relevance_score": 0.85,
                                "reranked": True,
                            },
                            {
                                "filename": "EventPass_Project_Documentation.pdf",
                                "chunk_index": 2,
                                "text": "Database is MongoDB with Mongoose User schema.",
                                "score": 0.025,
                                "rerank_score": 1.7,
                                "raw_score": 1.7,
                                "relevance_score": 0.8,
                                "reranked": True,
                            },
                        ],
                    },
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {"answer": ""},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.5,
            "error": None,
            "status": "in_progress",
        }

        res = finalize_node(state)
        final_ans = res["final_answer"]

        # MUST NOT reproduce the bug: repeating 'Retrieved Knowledge: 3 relevant passages found'
        assert "- **Retrieved Knowledge**: 3 relevant passages found" not in final_ans

        # MUST contain the requested structured sections
        assert "### Frontend" in final_ans
        assert "### Backend" in final_ans
        assert "### Database" in final_ans
        assert "### Authentication" in final_ans
        assert "### Request Flow" in final_ans
        assert "### Missing or Undocumented Details" in final_ans

        # Citations must be preserved and deduplicated
        assert len(res["citations"]) == 3
        assert res["citations"][0]["filename"] == "EventPass_Project_Documentation.pdf"

        # Verify LLM call received original user query and evidence
        mock_llm.assert_called_once()
        prompt_passed = mock_llm.call_args[0][1]
        assert "EventPass_Project_Documentation.pdf" in prompt_passed
        assert "explain how a login request travels" in prompt_passed

    @patch("app.services.langgraph_agent.get_llm_response")
    def test_finalize_node_fallback_transparent_notice_when_synthesis_fails(self, mock_llm):
        """
        When model synthesis produces empty output or raw leaked tool JSON,
        finalize_node must return a transparent, clearly labeled fallback notice
        instead of presenting retrieval excerpts as if they were a completed answer.
        """
        mock_llm.return_value = '{"name": "browser.open", "arguments": {}}'

        state: AgentState = {
            "query": "Explain system architecture",
            "agent_id": "knowledge",
            "agent_name": "Knowledge Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {
                        "results": [
                            {
                                "filename": "Spec.pdf",
                                "chunk_index": 0,
                                "text": "System architecture uses microservices.",
                                "score": 0.05,
                                "rerank_score": 1.2,
                                "reranked": True,
                            }
                        ]
                    },
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {"answer": ""},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.5,
            "error": None,
            "status": "in_progress",
        }

        res = finalize_node(state)
        final_ans = res["final_answer"]

        # Must never return raw 'Retrieved Knowledge: 1 relevant passages found' masquerading as completed answer
        assert "- **Retrieved Knowledge**: 1 relevant passages found" not in final_ans

        # Must display transparent fallback notice
        assert "Synthesis Notice" in final_ans
        assert "Retrieved Workspace Evidence" in final_ans
        assert "Spec.pdf" in final_ans
        assert "System architecture uses microservices." in final_ans

    def test_is_answer_incomplete_detection(self):
        query = (
            "Using only my uploaded EventPass_Project_Documentation.pdf, explain how a login request "
            "travels from the frontend through backend authentication and database access. Structure the answer into "
            "Frontend, Backend, Database, Authentication, and Request Flow. Clearly mention anything the document does not establish."
        )

        # Truncated answer stopping midway through Backend
        partial_backend = (
            "### Frontend\n"
            "The login form submits user credentials via api.js.\n\n"
            "### Backend\n"
            "The Express router forwards the POST /api/auth/login request to the auth controller where"
        )
        assert is_answer_incomplete(query, partial_backend) is True

        # Answer with unclosed code block
        unclosed_code = (
            "### Frontend\nLogin form.\n```javascript\nconst token = login();\n"
        )
        assert is_answer_incomplete(query, unclosed_code) is True

        # Answer ending with dangling conjunction
        dangling_ending = (
            "### Frontend\nLogin form submits.\n### Backend\nController handles request and"
        )
        assert is_answer_incomplete(query, dangling_ending) is True

        # Complete answer with all 6 requested sections
        complete_answer = (
            "### Frontend\nLogin form in React dispatches credentials.\n\n"
            "### Backend\nExpress authController handles /api/auth/login.\n\n"
            "### Database\nMongoose queries the User collection.\n\n"
            "### Authentication\nJWT token signed and verified.\n\n"
            "### Request Flow\n1. Form -> 2. Route -> 3. DB -> 4. JWT.\n\n"
            "### Missing or Undocumented Details\nThe document does not establish password hashing algorithms or DB connection pool limits."
        )
        assert is_answer_incomplete(query, complete_answer) is False

    @patch("app.services.langgraph_agent.get_llm_response")
    def test_finalize_node_recovers_from_truncated_reason_answer(self, mock_llm):
        """
        Exact bug reproduction:
        agent_reason_node returned an answer that cut off partway through the Backend section.
        finalize_node must recognize that the answer is incomplete and trigger synthesis,
        ensuring all requested sections are produced and grounded in evidence.
        """
        user_query = (
            "Using only my uploaded EventPass_Project_Documentation.pdf, explain how a login request "
            "travels from the frontend through backend authentication and database access. Structure the answer into "
            "Frontend, Backend, Database, Authentication, and Request Flow. Cite the relevant document passages. "
            "Clearly mention anything the document does not establish. Do not invent missing details."
        )

        # Truncated answer from agent_reason_node that stopped in Backend
        truncated_answer = (
            "### Frontend\n"
            "The login form in Login.jsx collects user credentials and dispatches via api.js.\n\n"
            "### Backend\n"
            "The Express backend receives the request at POST /api/auth/login where authController.js"
        )

        # Synthesis completes all 6 sections
        mock_llm.return_value = (
            "### Frontend\n"
            "The login form in `Login.jsx` collects credentials and calls `api.js`.\n\n"
            "### Backend\n"
            "The Express backend receives the request at `POST /api/auth/login`.\n\n"
            "### Database\n"
            "MongoDB is queried via Mongoose User model.\n\n"
            "### Authentication\n"
            "JWT token is issued upon successful verification.\n\n"
            "### Request Flow\n"
            "1. Client form submits. 2. Backend validates. 3. DB queries user. 4. Token returned.\n\n"
            "### Missing or Undocumented Details\n"
            "The document does not establish the password hashing algorithm or session timeout."
        )

        state: AgentState = {
            "query": user_query,
            "agent_id": "knowledge",
            "agent_name": "Knowledge Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [{"tool": "search_knowledge", "arguments": {}, "result_summary": "3 passages"}],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {
                        "found": True,
                        "results": [
                            {
                                "filename": "EventPass_Project_Documentation.pdf",
                                "chunk_index": 0,
                                "text": "Frontend uses AuthContext and api.js to submit login credentials.",
                                "score": 0.03,
                                "rerank_score": 1.9,
                                "raw_score": 1.9,
                                "relevance_score": 0.9,
                                "reranked": True,
                            },
                            {
                                "filename": "EventPass_Project_Documentation.pdf",
                                "chunk_index": 1,
                                "text": "Backend handles authentication at POST /api/auth/login with Express and JWT.",
                                "score": 0.028,
                                "rerank_score": 1.8,
                                "raw_score": 1.8,
                                "relevance_score": 0.85,
                                "reranked": True,
                            },
                            {
                                "filename": "EventPass_Project_Documentation.pdf",
                                "chunk_index": 2,
                                "text": "Database is MongoDB with Mongoose User schema.",
                                "score": 0.025,
                                "rerank_score": 1.7,
                                "raw_score": 1.7,
                                "relevance_score": 0.8,
                                "reranked": True,
                            },
                        ],
                    },
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {"answer": truncated_answer},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.5,
            "error": None,
            "status": "in_progress",
        }

        res = finalize_node(state)
        final_ans = res["final_answer"]

        # Synthesis must have been triggered because input was incomplete
        mock_llm.assert_called_once()
        assert "### Frontend" in final_ans
        assert "### Backend" in final_ans
        assert "### Database" in final_ans
        assert "### Authentication" in final_ans
        assert "### Request Flow" in final_ans
        assert "### Missing or Undocumented Details" in final_ans

    @patch("app.services.langgraph_agent.get_llm_response")
    def test_finalize_node_appends_warning_if_synthesis_itself_truncated(self, mock_llm):
        """
        When the model synthesis itself cuts off due to token limit,
        finalize_node must append a transparent warning notice and never silently
        present the partial output as complete.
        """
        user_query = (
            "Structure the answer into Frontend, Backend, Database, Authentication, and Request Flow."
        )

        # Model synthesis cuts off midway through Backend
        mock_llm.return_value = (
            "### Frontend\n"
            "The user interface renders a login form.\n\n"
            "### Backend\n"
            "The backend router handles the POST /api/auth/login request and"
        )

        state: AgentState = {
            "query": user_query,
            "agent_id": "knowledge",
            "agent_name": "Knowledge Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [{"tool": "search_knowledge", "arguments": {}, "result_summary": "1 passage"}],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {
                        "results": [
                            {"filename": "Doc.pdf", "chunk_index": 0, "text": "Login flow info", "score": 0.9}
                        ]
                    }
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {"answer": ""},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.5,
            "error": None,
            "status": "in_progress",
        }

        res = finalize_node(state)
        final_ans = res["final_answer"]

        # Must contain the incomplete output warning banner
        assert "Incomplete Output Warning" in final_ans
        assert "⚠️" in final_ans


class TestEngineeringAgentGitHubRepair:
    """
    Regression test suite for Engineering Agent GitHub tool integration:
    - repository-listing action name mismatch (repo_list_github_repos -> list_github_repos)
    - successful live repository tool dispatch
    - exact repository name, owner, and HTML URL mapping
    - unsupported actions being rejected safely
    - GitHub authentication failures
    - workspace isolation and role authorization
    - no mock data for a connected workspace
    - issues and pull requests action aliases
    """

    def test_repo_list_github_repos_mismatch_resolved(self):
        """Action 'repo_list_github_repos' is normalized to 'list_github_repos' and not rejected as unsupported."""
        state: AgentState = {
            "query": "List live GitHub repositories",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u_eng",
            "workspace_id": "ws_eng",
            "role": "member",
            "raw_token": "valid_token",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        # Model outputs repo_list_github_repos
        model_output = json.dumps({
            "thought": "I should list the workspace repositories",
            "action": "repo_list_github_repos",
            "action_input": {}
        })

        with patch("app.services.langgraph_agent.get_llm_response", return_value=model_output):
            reason_res = agent_reason_node(state)

        # Must resolve to list_github_repos
        assert reason_res["next_action"] == "list_github_repos"
        # Must NOT be rejected as unsupported action
        assert not any("Unsupported action" in step for step in reason_res["steps"])

    @patch("httpx.Client.get")
    def test_successful_live_repository_tool_dispatch_and_mapping(self, mock_get):
        """Live repository call succeeds and accurately maps name, owner.login, and html_url."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "repositories": [
                {
                    "id": 1001,
                    "name": "AIRA-Workspace",
                    "full_name": "darpan-soni/AIRA-Workspace",
                    "description": "Production workspace",
                    "html_url": "https://github.com/darpan-soni/AIRA-Workspace",
                    "owner": {"login": "darpan-soni", "avatar_url": "https://avatars.github.com/u/1"},
                    "is_mock": False,
                    "source": "live_github"
                }
            ],
            "count": 1,
            "is_mock": False,
            "source": "live_github"
        }
        mock_get.return_value = mock_resp

        state: AgentState = {
            "query": "List live GitHub repositories",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u_eng",
            "workspace_id": "ws_123",
            "role": "member",
            "raw_token": "valid_token",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": "list_github_repos",
            "next_action_input": {},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        # 1. Test runner direct execution
        runner_res = _run_tool_github_repos(state, {})
        assert runner_res.get("error") is None
        assert runner_res["count"] == 1
        assert runner_res["source"] == "live"
        assert runner_res["is_mock"] is False
        repo = runner_res["repositories"][0]
        assert repo["name"] == "AIRA-Workspace"
        assert repo["owner"]["login"] == "darpan-soni"
        assert repo["html_url"] == "https://github.com/darpan-soni/AIRA-Workspace"

        # 2. Test execute_tool_node dispatch
        tool_node_res = execute_tool_node(state)
        assert any("Executing tool 'list_github_repos'" in s for s in tool_node_res["steps"])
        assert any("✓" in s for s in tool_node_res["steps"])
        assert not any("❌" in s for s in tool_node_res["steps"])

    def test_unsupported_actions_safely_rejected(self):
        """Truly unsupported action is safely rejected and warning is recorded."""
        state: AgentState = {
            "query": "Delete the entire database",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u_eng",
            "workspace_id": "ws_eng",
            "role": "member",
            "raw_token": "valid_token",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        model_output = json.dumps({
            "thought": "I should execute delete database",
            "action": "delete_all_databases_danger",
            "action_input": {}
        })

        with patch("app.services.langgraph_agent.get_llm_response", return_value=model_output):
            reason_res = agent_reason_node(state)

        # Must be rejected safely with warning in steps
        assert reason_res["next_action"] == "final_answer"
        assert any("Unsupported action 'delete_all_databases_danger' rejected" in s for s in reason_res["steps"])
        assert "do not have access to an external tool" in reason_res["next_action_input"]["answer"]

    @patch("httpx.Client.get")
    def test_github_authentication_failure_handling(self, mock_get):
        """When GitHub returns 401, error is surfaced and not concealed or claimed as success."""
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.json.return_value = {
            "success": False,
            "message": "GitHub authentication failed. Your access token has expired.",
            "code": "GITHUB_AUTH_EXPIRED"
        }
        mock_get.return_value = mock_resp

        state: AgentState = {
            "query": "Show my repositories",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u_eng",
            "workspace_id": "ws_123",
            "role": "member",
            "raw_token": "expired_token",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": "list_github_repos",
            "next_action_input": {},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        # 1. Runner returns error object, does not crash
        runner_res = _run_tool_github_repos(state, {})
        assert "error" in runner_res
        assert "GitHub authentication failed" in runner_res["error"]

        # 2. Tool node records failure step with ❌
        tool_node_res = execute_tool_node(state)
        assert any("❌ Failed: GitHub authentication failed" in s for s in tool_node_res["steps"])
        assert not any("✓ Completed list_github_repos" in s for s in tool_node_res["steps"])

    @patch("httpx.Client.get")
    def test_workspace_isolation_and_role_authorization(self, mock_get):
        """Workspace ID is forwarded to Node backend and isolation is preserved."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"repositories": [], "count": 0, "is_mock": False}
        mock_get.return_value = mock_resp

        state: AgentState = {
            "query": "Show repositories",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u_member",
            "workspace_id": "ws_secure_999",
            "role": "viewer",
            "raw_token": "bearer_jwt",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": "list_github_repos",
            "next_action_input": {},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        _run_tool_github_repos(state, {})
        call_kwargs = mock_get.call_args.kwargs
        assert call_kwargs["params"] == {"workspace_id": "ws_secure_999"}
        assert call_kwargs["headers"]["Authorization"] == "Bearer bearer_jwt"

    @patch("httpx.Client.get")
    def test_no_mock_data_for_connected_workspace(self, mock_get):
        """When workspace is connected, mock fallback is never substituted if GitHub fails."""
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.json.return_value = {"message": "Resource protected by SAML"}
        mock_get.return_value = mock_resp

        state: AgentState = {
            "query": "List my repos",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u_member",
            "workspace_id": "ws_connected",
            "role": "member",
            "raw_token": "valid_user_jwt",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": "list_github_repos",
            "next_action_input": {},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        res = _run_tool_github_repos(state, {})
        # Must return an error, NEVER fabricate mock repos
        assert "error" in res
        assert res.get("is_mock") is not True
        assert len(res.get("repositories", [])) == 0

    def test_issues_and_pulls_action_aliases(self):
        """Aliases for get_github_issues and get_github_pulls resolve accurately."""
        state: AgentState = {
            "query": "Check issues and PRs",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u_eng",
            "workspace_id": "ws_eng",
            "role": "member",
            "raw_token": "valid_token",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        # 1. repo_get_github_issues
        with patch("app.services.langgraph_agent.get_llm_response", return_value=json.dumps({
            "thought": "Get issues",
            "action": "repo_get_github_issues",
            "action_input": {"repo": "owner/repo"}
        })):
            res_issues = agent_reason_node(state)
            assert res_issues["next_action"] == "get_github_issues"

        # 2. repo_get_github_pulls
        with patch("app.services.langgraph_agent.get_llm_response", return_value=json.dumps({
            "thought": "Get PRs",
            "action": "repo_get_github_pulls",
            "action_input": {"repo": "owner/repo"}
        })):
            res_pulls = agent_reason_node(state)
            assert res_pulls["next_action"] == "get_github_pulls"


class TestEngineeringAgentIssuesAndPRsRegression:
    """
    10 Comprehensive regression tests for Engineering Agent GitHub issues & PRs:
    1. Live-tool dispatch for get_github_issues
    2. Live-tool dispatch for get_github_pulls
    3. Alias normalization
    4. Correct owner/repository parsing (including trailing hyphen)
    5. Authenticated workspace and role isolation
    6. Valid empty results (zero issues/PRs)
    7. GitHub API 401/403/429 handling without mock substitution
    8. LLM provider failure after successful tool execution
    9. Malformed tool-call output
    10. Existing repository listing still works
    """

    @patch("app.services.langgraph_agent.get_github_issues")
    def test_live_tool_dispatch_get_github_issues(self, mock_get_issues):
        mock_get_issues.return_value = {
            "issues": [
                {
                    "number": 1,
                    "title": "Bug in auth flow",
                    "state": "open",
                    "user": {"login": "YashSoni-10"},
                    "html_url": "https://github.com/YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-/issues/1",
                }
            ],
            "count": 1,
            "source": "live",
            "is_mock": False,
            "repository": "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-",
        }

        state: AgentState = {
            "query": "Check issues in YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "ws1",
            "role": "member",
            "raw_token": "valid_token",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": "get_github_issues",
            "next_action_input": {"repo": "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        res = execute_tool_node(state)
        assert len(res["tool_results"]) == 1
        assert res["tool_results"][0]["tool"] == "get_github_issues"
        assert res["tool_results"][0]["result"]["count"] == 1
        assert any("Completed get_github_issues" in s for s in res["steps"])

    @patch("app.services.langgraph_agent.get_github_pulls")
    def test_live_tool_dispatch_get_github_pulls(self, mock_get_pulls):
        mock_get_pulls.return_value = {
            "pulls": [
                {
                    "number": 5,
                    "title": "Add LangGraph Orchestrator",
                    "state": "open",
                    "user": {"login": "YashSoni-10"},
                    "html_url": "https://github.com/YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-/pull/5",
                }
            ],
            "count": 1,
            "source": "live",
            "is_mock": False,
            "repository": "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-",
        }

        state: AgentState = {
            "query": "Show pull requests for YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "ws1",
            "role": "member",
            "raw_token": "valid_token",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": "get_github_pulls",
            "next_action_input": {"repo": "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        res = execute_tool_node(state)
        assert len(res["tool_results"]) == 1
        assert res["tool_results"][0]["tool"] == "get_github_pulls"
        assert res["tool_results"][0]["result"]["count"] == 1
        assert any("Completed get_github_pulls" in s for s in res["steps"])

    def test_alias_normalization(self):
        aliases_to_issues = [
            "repo_issues",
            "get_repo_issues",
            "list_repo_issues",
            "fetch_issues",
            "fetch_github_issues",
            "repo_browser.get_github_issues",
            "browser.get_github_issues",
        ]
        for a in aliases_to_issues:
            assert normalize_action_name(a) == "get_github_issues", f"Failed for alias: {a}"

        aliases_to_pulls = [
            "get_pull_requests",
            "list_pull_requests",
            "get_github_pull_requests",
            "list_github_pull_requests",
            "repo_pulls",
            "repo_prs",
            "repo_pull_requests",
            "fetch_pulls",
            "fetch_prs",
            "repo_browser.get_github_pulls",
            "browser.get_github_pulls",
        ]
        for a in aliases_to_pulls:
            assert normalize_action_name(a) == "get_github_pulls", f"Failed for alias: {a}"

    def test_correct_owner_repository_parsing(self):
        from app.services.langgraph_agent import _clean_repo_slug, _resolve_repo_argument

        # 1. Exact string with trailing hyphen
        assert _clean_repo_slug("YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-") == "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"

        # 2. Full URL
        assert _clean_repo_slug("https://github.com/YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-") == "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"

        # 3. Full URL with .git
        assert _clean_repo_slug("https://github.com/YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-.git") == "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"

        # 4. Full URL with subpath
        assert _clean_repo_slug("https://github.com/YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-/pulls") == "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"

        # 5. Extract from state query when omitted from args
        state = {
            "query": "Check issues in YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-",
            "tool_results": [],
            "raw_token": "",
            "workspace_id": "",
        }
        repo, err = _resolve_repo_argument(state, {})
        assert err is None
        assert repo == "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"

    @patch("httpx.Client.get")
    def test_authenticated_workspace_and_role_isolation(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "issues": [],
            "count": 0,
            "repository": "owner/repo",
            "is_mock": False,
        }
        mock_get.return_value = mock_resp

        state: AgentState = {
            "query": "Check issues in owner/repo",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u_viewer",
            "workspace_id": "ws_secure_123",
            "role": "viewer",
            "raw_token": "viewer_jwt_token",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": "get_github_issues",
            "next_action_input": {"repo": "owner/repo"},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        _run_tool_github_issues(state, {"repo": "owner/repo"})
        kwargs = mock_get.call_args.kwargs
        assert kwargs["params"]["workspace_id"] == "ws_secure_123"
        assert kwargs["params"]["repo"] == "owner/repo"
        assert kwargs["headers"]["Authorization"] == "Bearer viewer_jwt_token"

    def test_valid_empty_results_zero_issues_and_prs(self):
        state: AgentState = {
            "query": "Check issues for owner/repo",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "ws1",
            "role": "member",
            "raw_token": "jwt",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [
                {
                    "tool": "get_github_issues",
                    "result": {
                        "issues": [],
                        "count": 0,
                        "repository": "owner/repo",
                        "source": "live",
                        "is_mock": False,
                    },
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {"answer": ""},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        with patch("app.services.langgraph_agent.get_llm_response", side_effect=RuntimeError("rate limit")):
            res = finalize_node(state)
            ans = res["final_answer"]
            # Must state 0 issues cleanly without claiming error
            assert "0 issues" in ans or "No issues found" in ans
            assert "❌ GitHub Issues Error" not in ans

    @patch("httpx.Client.get")
    def test_github_api_401_403_429_handling_without_mock_substitution(self, mock_get):
        state: AgentState = {
            "query": "Check issues",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "ws_live",
            "role": "member",
            "raw_token": "valid_token",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": "get_github_issues",
            "next_action_input": {"repo": "owner/repo"},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        # Test 401
        mock_401 = MagicMock(status_code=401)
        mock_401.json.return_value = {"message": "Bad credentials"}
        mock_get.return_value = mock_401
        res_401 = _run_tool_github_issues(state, {"repo": "owner/repo"})
        assert "error" in res_401
        assert res_401.get("is_mock") is not True

        # Test 429
        mock_429 = MagicMock(status_code=429)
        mock_429.json.return_value = {"message": "API rate limit exceeded"}
        mock_get.return_value = mock_429
        res_429 = _run_tool_github_issues(state, {"repo": "owner/repo"})
        assert "error" in res_429
        assert "rate limit" in res_429["error"].lower()
        assert res_429.get("is_mock") is not True

    def test_llm_provider_failure_after_successful_tool_execution(self):
        state: AgentState = {
            "query": "Check issues in owner/repo",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "ws1",
            "role": "member",
            "raw_token": "jwt",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [{"tool": "get_github_issues", "arguments": {"repo": "owner/repo"}, "result_summary": "1 issue"}],
            "tool_results": [
                {
                    "tool": "get_github_issues",
                    "result": {
                        "issues": [
                            {
                                "number": 101,
                                "title": "Memory leak in socket handler",
                                "state": "open",
                                "user": {"login": "octocat"},
                                "html_url": "https://github.com/owner/repo/issues/101",
                            }
                        ],
                        "count": 1,
                        "repository": "owner/repo",
                        "source": "live",
                        "is_mock": False,
                    },
                }
            ],
            "steps": ["⚡ Executing tool 'get_github_issues' with args {}", "✓ Completed get_github_issues successfully."],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {"answer": ""},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        # When synthesis throws RuntimeError, finalize_node must NOT crash and MUST return the issue data
        with patch("app.services.langgraph_agent.get_llm_response", side_effect=RuntimeError("Groq 429 quota exhausted")):
            res = finalize_node(state)
            ans = res["final_answer"]
            assert "#101" in ans
            assert "Memory leak in socket handler" in ans
            assert "@octocat" in ans
            assert "https://github.com/owner/repo/issues/101" in ans
            assert "Engineering Agent Synthesis Notice" in ans

    def test_malformed_tool_call_output(self):
        state: AgentState = {
            "query": "Check issues in YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "ws1",
            "role": "member",
            "raw_token": "jwt",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        # 1. Non-JSON string mentioning the tool
        with patch("app.services.langgraph_agent.get_llm_response", return_value="I will now call get_github_issues to inspect open issues."):
            res = agent_reason_node(state)
            assert res["next_action"] == "get_github_issues"

        # 2. Total LLM exception (e.g. rate limit / network drop) -> deterministic intent inference
        with patch("app.services.langgraph_agent.get_llm_response", side_effect=RuntimeError("Connection reset")):
            res_err = agent_reason_node(state)
            assert res_err["next_action"] == "get_github_issues"
            assert res_err["next_action_input"]["repo"] == "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"

    @patch("httpx.Client.get")
    def test_existing_repository_listing_still_works(self, mock_get):
        mock_resp = MagicMock(status_code=200)
        mock_resp.json.return_value = {
            "repositories": [
                {
                    "name": "AIRA-AI-Retrieval-Action-Assistant-",
                    "full_name": "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-",
                    "owner": {"login": "YashSoni-10"},
                    "html_url": "https://github.com/YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-",
                }
            ],
            "count": 1,
            "is_mock": False,
        }
        mock_get.return_value = mock_resp

        state: AgentState = {
            "query": "List all repositories in my workspace",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "ws1",
            "role": "member",
            "raw_token": "jwt",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": "list_github_repos",
            "next_action_input": {},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        res = _run_tool_github_repos(state, {})
        assert len(res["repositories"]) == 1
        assert res["repositories"][0]["name"] == "AIRA-AI-Retrieval-Action-Assistant-"
        assert res["repositories"][0]["owner"]["login"] == "YashSoni-10"


class TestKnowledgeAgentEncodingAndArtifactsRegression:
    """
    Regression tests for Knowledge Agent text encoding preservation,
    mojibake sanitation, parser artifact stripping (standalone '{'),
    code-block brace preservation, and truthful execution status.
    """

    def test_exact_corrupted_strings_repaired(self):
        """
        Exact corrupted strings from manual testing must be repaired cleanly:
        - 'bearerâtoken' -> 'bearer-token'
        - 'Multiâlevel' -> 'Multi-level'
        - 'RoleâBased' -> 'Role-Based'
        - 'RoleâBased' -> 'Role-Based'
        """
        raw_samples = [
            ("bearer\u00e2token", "bearer-token"),
            ("bearer\u00e2\ufffdtoken", "bearer-token"),
            ("Multi\u00e2level", "Multi-level"),
            ("Multi\u00e2\ufffdlevel", "Multi-level"),
            ("multi\u00e2level", "multi-level"),
            ("Role\u00e2Based", "Role-Based"),
            ("Role\u00e2\ufffdBased", "Role-Based"),
            ("role\u00e2based", "role-based"),
            # Direct UTF-8 byte mojibake patterns
            ("Text with \u00e2\x80\x93 dash", "Text with – dash"),
            ("Text with \u00e2\x80\x94 em-dash", "Text with — em-dash"),
            ("\u00e2\x80\x98quoted\u00e2\x80\x99", "‘quoted’"),
            ("\u00e2\x80\x9cdouble quoted\u00e2\x80\x9d", "“double quoted”"),
        ]
        for corrupted, expected in raw_samples:
            fixed_agent = sanitize_mojibake(corrupted)
            assert fixed_agent == expected, f"Failed agent sanitize: {corrupted} -> {fixed_agent} != {expected}"
            fixed_doc = doc_sanitize_mojibake(corrupted)
            assert fixed_doc == expected, f"Failed doc sanitize: {corrupted} -> {fixed_doc} != {expected}"

    def test_legitimate_unicode_text_preserved_without_corruption(self):
        """
        Valid Unicode text must NEVER be mangled or replaced:
        French: château, naïve, café
        German: Überprüfung, Größe, schön
        Spanish: año, señor
        Japanese: 日本語, 東京
        Real UTF-8 en-dash and em-dash: Multi–level, Role–Based
        """
        valid_unicode_samples = [
            "Le château de Chambord propose un café exceptionnel.",
            "Eine gründliche Überprüfung der Größe und Schönheit.",
            "Este año el señor González visitó el país.",
            "日本語のドキュメントと東京のオフィス",
            "Multi–level access with Role–Based authorization.",
            "Temperature is 20°C with 100% compliance © 2026.",
        ]
        for sample in valid_unicode_samples:
            assert sanitize_mojibake(sample) == sample
            assert doc_sanitize_mojibake(sample) == sample

    def test_unescape_json_string_preserves_multibyte_utf8(self):
        """
        Root cause regression test:
        Previous implementation used m.group(1).encode('utf-8').decode('unicode_escape')
        which converted UTF-8 multibyte characters into Latin-1 mojibake (e.g. '–' into 'â\x80\x93').
        _unescape_json_string must handle JSON escapes without altering UTF-8 characters.
        """
        # String containing JSON escapes (\n, \", \\) AND real multibyte UTF-8 characters
        raw = r'### Heading\nMulti\u2013level Role\u2013Based authentication for château: \"bearer-token\"\\path'
        unescaped = _unescape_json_string(raw)
        assert "Multi–level" in unescaped
        assert "Role–Based" in unescaped
        assert "château" in unescaped
        assert '"bearer-token"' in unescaped
        assert "\\path" in unescaped
        # Corrupted mojibake patterns must NOT appear
        assert "\u00e2\x80" not in unescaped
        assert "\u00e2\ufffd" not in unescaped
        assert "bearer\u00e2" not in unescaped
        assert "Multi\u00e2" not in unescaped
        assert "Role\u00e2" not in unescaped

    def test_extract_text_from_answer_does_not_produce_mojibake(self):
        """
        _extract_text_from_answer on a JSON payload with UTF-8 characters must never produce mojibake.
        """
        payload = json.dumps({
            "thought": "Synthesizing answer",
            "action": "final_answer",
            "action_input": {
                "answer": "Multi–level Role–Based security with château token."
            }
        })
        extracted = _extract_text_from_answer(payload)
        assert "Multi–level Role–Based" in extracted
        assert "château" in extracted
        assert "\u00e2\x80" not in extracted
        assert "\u00e2\ufffd" not in extracted
        assert "Multi\u00e2" not in extracted
        assert "Role\u00e2" not in extracted

    def test_standalone_brace_after_summary_stripped(self):
        """
        A response ending with a standalone '{' or unclosed tool call fragment outside code blocks
        must be cleanly stripped without trailing artifacts.
        """
        corrupted_outputs = [
            # Ending with newline and standalone {
            ("### Summary\nThe authentication system uses JWT tokens.\n\n{",
             "### Summary\nThe authentication system uses JWT tokens."),
            # Ending with trailing spaces and {
            ("### Summary\nThe authentication system uses JWT tokens. {",
             "### Summary\nThe authentication system uses JWT tokens."),
            # Ending with unclosed tool-call JSON stub
            ("### Summary\nAll endpoints require tokens.\n\n{\"action\": \"search_knowledge\"",
             "### Summary\nAll endpoints require tokens."),
            # Ending with empty ```json\n{
            ("### Summary\nComplete answer.\n\n```json\n{",
             "### Summary\nComplete answer."),
        ]
        for input_text, expected_cleaned in corrupted_outputs:
            cleaned = clean_parser_artifacts(input_text)
            assert cleaned == expected_cleaned, f"Expected '{expected_cleaned}', got '{cleaned}'"

    def test_legitimate_braces_in_code_examples_preserved(self):
        """
        Code blocks and inline code containing legitimate braces must NOT be stripped or damaged.
        """
        # Code block with JSON object
        code_block = """### Code Example
```json
{
  "token": "bearer-token",
  "user": {
    "id": 1,
    "roles": ["admin"]
  }
}
```"""
        cleaned = clean_parser_artifacts(code_block)
        assert cleaned == code_block
        assert '"token": "bearer-token"' in cleaned
        assert '"id": 1' in cleaned

        # Inline code with braces
        inline_code = "Use the header `{ Authorization: 'Bearer token' }` in your request."
        assert clean_parser_artifacts(inline_code) == inline_code

        # Unclosed code block ending with code containing braces:
        # Must close the code block cleanly, preserving the internal code braces!
        unclosed_code = """### Implementation
```typescript
interface AuthConfig {
  secret: string;
  expiresIn: number;
}"""
        cleaned_unclosed = clean_parser_artifacts(unclosed_code)
        assert cleaned_unclosed.endswith("```")
        assert "interface AuthConfig {" in cleaned_unclosed
        assert "expiresIn: number;" in cleaned_unclosed

    def test_truthful_status_reporting_on_incomplete_output(self):
        """
        When an answer is incomplete (e.g. missing required sections or truncated by finish reason),
        finalize_node must report status='partial' with an honest warning step,
        and NEVER label it as '✓ Response generated successfully.'
        """
        state_incomplete: AgentState = {
            "query": (
                "Using EventPass.pdf, explain the login flow. Structure into "
                "Frontend, Backend, Database, Authentication, and Request Flow. "
                "Cite relevant document passages."
            ),
            "agent_id": "knowledge",
            "agent_name": "Knowledge Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [{"tool": "search_knowledge", "arguments": {}, "result_summary": "ok"}],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {
                        "results": [
                            {"filename": "EventPass.pdf", "chunk_index": 0, "text": "Auth flow details", "score": 0.9}
                        ]
                    }
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            # Answer only provides Frontend and Backend, omitting Database, Authentication, and Request Flow
            "next_action_input": {
                "answer": "### Frontend\nLogin form dispatches credentials.\n\n### Backend\nExpress router validates user."
            },
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.5,
            "error": None,
            "status": "in_progress",
        }

        incomplete_answer = "### Frontend\nLogin form dispatches credentials.\n\n### Backend\nExpress router validates user."
        with patch("app.services.langgraph_agent.get_llm_response", return_value=incomplete_answer):
            res = finalize_node(state_incomplete)
            # Truthful status: must be partial, not success
            assert res["status"] == "partial"
            # Steps must NOT claim success
            step_texts = " ".join(res["steps"])
            assert "Response generated successfully" not in step_texts
            assert "partial output" in step_texts

    def test_truthful_status_reporting_on_complete_output(self):
        """
        When an answer satisfies all requested sections, finalize_node reports status='success'
        and includes '✓ Response generated successfully.'
        """
        state_complete: AgentState = {
            "query": (
                "Explain login flow with Frontend, Backend, Database, Authentication, and Request Flow."
            ),
            "agent_id": "knowledge",
            "agent_name": "Knowledge Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [{"tool": "search_knowledge", "arguments": {}, "result_summary": "ok"}],
            "tool_results": [
                {
                    "tool": "search_knowledge",
                    "result": {
                        "results": [
                            {"filename": "EventPass.pdf", "chunk_index": 0, "text": "Auth details", "score": 0.9}
                        ]
                    }
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {
                "answer": (
                    "### Frontend\nDispatches credentials.\n\n"
                    "### Backend\nValidates login.\n\n"
                    "### Database\nQueries user table.\n\n"
                    "### Authentication\nIssues JWT.\n\n"
                    "### Request Flow\nEnd to end request steps.\n\n"
                    "### Missing or Undocumented Details\nPassword hashing rounds not stated."
                )
            },
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.5,
            "error": None,
            "status": "in_progress",
        }

        complete_answer = (
            "### Frontend\nDispatches credentials.\n\n"
            "### Backend\nValidates login.\n\n"
            "### Database\nQueries user table.\n\n"
            "### Authentication\nIssues JWT.\n\n"
            "### Request Flow\nEnd to end request steps.\n\n"
            "### Missing or Undocumented Details\nPassword hashing rounds not stated."
        )
        with patch("app.services.langgraph_agent.get_llm_response", return_value=complete_answer):
            res = finalize_node(state_complete)
            assert res["status"] == "success"
            step_texts = " ".join(res["steps"])
            assert "Response generated successfully" in step_texts

    def test_synth_prompt_contains_factual_grounding_and_missing_details_instructions(self):
        """
        Verify that synthesis prompt enforces grounding, forbids presenting common industry practices
        as facts, and requires explicit missing/undocumented details sections.
        """
        import inspect
        src = inspect.getsource(finalize_node)
        assert "Strictly distinguish between DOCUMENTED FACTS" in src
        assert "DO NOT present standard industry practices" in src
        assert "Missing or Undocumented Details" in src


class TestGitHubRepoSlugAndErrorHandlingRegression:
    """
    Regression tests for:
    - Normalizing punctuation around repository identifiers (periods, commas, backticks, quotes, URLs)
    - Preserving legitimate repository characters (trailing hyphens, multi-hyphen names)
    - Preferring exact full_name from live workspace repository list
    - Truthful error reporting for GitHub API failures (never mask errors as zero issues/PRs)
    - Reporting zero only when GitHub successfully returns an empty list
    """

    def test_repo_slug_normalization_punctuation(self):
        """
        Verify that _clean_repo_slug strips trailing periods, commas, colons,
        quotes, backticks, brackets, and URLs while strictly preserving
        valid trailing hyphens and names containing multiple hyphens.
        """
        exact_repo = "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"

        test_cases = [
            # Trailing period (sentence-ending punctuation)
            (f"{exact_repo}.", exact_repo),
            # Trailing comma
            (f"{exact_repo},", exact_repo),
            # Backticks
            (f"`{exact_repo}`", exact_repo),
            # Single and double quotes
            (f"'{exact_repo}'", exact_repo),
            (f'"{exact_repo}"', exact_repo),
            # Quoted with trailing period
            (f"'{exact_repo}'.", exact_repo),
            # Parentheses and colon
            (f"({exact_repo}):", exact_repo),
            # Question mark and exclamation
            (f"{exact_repo}?", exact_repo),
            (f"{exact_repo}!", exact_repo),
            # Full URL with trailing period
            (f"https://github.com/{exact_repo}.", exact_repo),
            # Full URL with .git
            (f"https://github.com/{exact_repo}.git", exact_repo),
            # Full URL with /issues or /pulls
            (f"https://github.com/{exact_repo}/issues", exact_repo),
            (f"https://github.com/{exact_repo}/pulls", exact_repo),
            # Multiple hyphens and trailing hyphen
            ("owner/my-multi-hyphen-repo-name-", "owner/my-multi-hyphen-repo-name-"),
            ("owner/my-multi-hyphen-repo-name-.", "owner/my-multi-hyphen-repo-name-"),
            # Repo with legitimate dot in name (e.g. repo.js)
            ("owner/repo.js", "owner/repo.js"),
            ("owner/repo.js.", "owner/repo.js"),
        ]

        for raw_input, expected in test_cases:
            cleaned = _clean_repo_slug(raw_input)
            assert cleaned == expected, f"Failed for '{raw_input}': got '{cleaned}', expected '{expected}'"

    def test_prefer_exact_repo_full_name_from_live_workspace_list(self):
        """
        Verify that _resolve_repo_argument prefers the exact full_name
        from the authenticated workspace's live repository list.
        """
        exact_repo = "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"
        state: AgentState = {
            "query": f"Check issues in {exact_repo}.",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [
                {
                    "tool": "list_github_repos",
                    "result": {
                        "connected": True,
                        "repositories": [
                            {
                                "name": "AIRA-AI-Retrieval-Action-Assistant-",
                                "full_name": exact_repo,
                                "owner": {"login": "YashSoni-10"},
                            }
                        ],
                    },
                }
            ],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        # 1. When args has trailing period
        repo, err = _resolve_repo_argument(state, {"repo": f"{exact_repo}."})
        assert err is None
        assert repo == exact_repo

        # 2. When args is empty and repo must be resolved from query with trailing period
        repo_from_q, err_q = _resolve_repo_argument(state, {})
        assert err_q is None
        assert repo_from_q == exact_repo

        # 3. When query mentions only the short name with trailing period
        state_short = dict(state, query="Show issues for AIRA-AI-Retrieval-Action-Assistant-.")
        repo_short, err_short = _resolve_repo_argument(state_short, {})
        assert err_short is None
        assert repo_short == exact_repo

    @patch("app.services.langgraph_agent.get_github_issues")
    def test_github_api_404_never_converted_to_zero_issues(self, mock_get_issues):
        """
        When GitHub returns 404 (repository not found or inaccessible),
        _run_tool_github_issues must return an error (without 'count': 0 or 'issues': [])
        and finalize_node must display the error rather than reporting 0 issues.
        """
        exact_repo = "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"
        mock_get_issues.side_effect = RuntimeError(f"GitHub repository '{exact_repo}' was not found or is inaccessible.")

        state: AgentState = {
            "query": f"Check issues in {exact_repo}",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        # Tool execution must not return fake zero counts
        tool_res = _run_tool_github_issues(state, {"repo": exact_repo})
        assert "error" in tool_res
        assert "was not found or is inaccessible" in tool_res["error"]
        assert "count" not in tool_res or tool_res.get("count") is None or tool_res.get("success") is False
        assert "issues" not in tool_res

        # Even if model erroneously synthesized 0 issues, finalize_node must override with error
        state_with_res: AgentState = dict(
            state,
            tool_results=[{"tool": "get_github_issues", "result": tool_res}],
            next_action="final_answer",
            next_action_input={"answer": f"There are 0 issues found for `{exact_repo}`."},
        )
        res = finalize_node(state_with_res)
        final_text = res["final_answer"]
        assert "❌ **GitHub Issues Error" in final_text
        assert "was not found or is inaccessible" in final_text
        assert "0 issues found" not in final_text
        assert res["status"] in ("notice", "partial")

    @patch("app.services.langgraph_agent.get_github_pulls")
    def test_github_api_401_never_converted_to_zero_prs(self, mock_get_pulls):
        """
        When GitHub returns 401/403 (authentication error),
        _run_tool_github_pulls must report the error, never zero pull requests.
        """
        exact_repo = "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"
        mock_get_pulls.side_effect = RuntimeError("GitHub authentication failed. Please reconnect your GitHub account.")

        state: AgentState = {
            "query": f"Check pull requests in {exact_repo}",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        tool_res = _run_tool_github_pulls(state, {"repo": exact_repo})
        assert "error" in tool_res
        assert "authentication failed" in tool_res["error"]
        assert "pulls" not in tool_res

        state_with_res: AgentState = dict(
            state,
            tool_results=[{"tool": "get_github_pulls", "result": tool_res}],
            next_action="final_answer",
            next_action_input={"answer": f"The repository `{exact_repo}` has no pull requests."},
        )
        res = finalize_node(state_with_res)
        final_text = res["final_answer"]
        assert "❌ **GitHub Pull Requests Error" in final_text
        assert "authentication failed" in final_text
        assert "no pull requests" not in final_text.lower() or "error" in final_text.lower()
        assert res["status"] in ("notice", "partial")

    @patch("app.services.langgraph_agent.get_github_repos")
    @patch("app.services.langgraph_agent.get_github_issues")
    def test_genuine_empty_results_report_zero_issues(self, mock_get_issues, mock_get_repos):
        """
        When GitHub successfully returns an empty issues list (HTTP 200, []),
        it should be reported as 0 issues found.
        """
        exact_repo = "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"
        mock_get_repos.return_value = [{"full_name": exact_repo, "name": "AIRA-AI-Retrieval-Action-Assistant-"}]
        mock_get_issues.return_value = {
            "issues": [],
            "count": 0,
            "source": "live",
            "is_mock": False,
            "repository": exact_repo,
        }

        state: AgentState = {
            "query": f"Check issues in {exact_repo}",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        tool_res = _run_tool_github_issues(state, {"repo": exact_repo})
        assert tool_res["count"] == 0
        assert tool_res["issues"] == []
        assert "error" not in tool_res

        state_with_res: AgentState = dict(
            state,
            tool_results=[{"tool": "get_github_issues", "result": tool_res}],
            next_action="final_answer",
            next_action_input={"answer": ""},
        )
        res = finalize_node(state_with_res)
        final_text = res["final_answer"]
        assert re.search(r"(0\s*(open\s*)?issues|no\s*(open\s*)?issues|issues.*?0)", final_text, re.IGNORECASE)
        assert "❌" not in final_text

    @patch("app.services.langgraph_agent.get_github_repos")
    @patch("app.services.langgraph_agent.get_github_pulls")
    def test_genuine_empty_results_report_zero_pull_requests(self, mock_get_pulls, mock_get_repos):
        """
        When GitHub successfully returns an empty PR list (HTTP 200, []),
        it should be reported as 0 pull requests found.
        """
        exact_repo = "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"
        mock_get_repos.return_value = [{"full_name": exact_repo, "name": "AIRA-AI-Retrieval-Action-Assistant-"}]
        mock_get_pulls.return_value = {
            "pulls": [],
            "count": 0,
            "source": "live",
            "is_mock": False,
            "repository": exact_repo,
        }

        state: AgentState = {
            "query": f"Check pull requests in {exact_repo}",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        tool_res = _run_tool_github_pulls(state, {"repo": exact_repo})
        assert tool_res["count"] == 0
        assert tool_res["pulls"] == []
        assert "error" not in tool_res

        state_with_res: AgentState = dict(
            state,
            tool_results=[{"tool": "get_github_pulls", "result": tool_res}],
            next_action="final_answer",
            next_action_input={"answer": ""},
        )
        res = finalize_node(state_with_res)
        final_text = res["final_answer"]
        assert re.search(r"(0\s*(open\s*)?pull\s*requests?|no\s*(open\s*)?pull\s*requests?|pull\s*requests?.*?0)", final_text, re.IGNORECASE)
        assert "❌" not in final_text


class TestGitHubTreeAndFileContent:
    """Tests for repository tree and file content retrieval, tool aliases, and citations."""

    def test_tool_specs_include_tree_and_file_content(self):
        tool_names = [t["name"] for t in TOOL_SPECS]
        assert "get_github_tree" in tool_names
        assert "get_github_file_content" in tool_names

    def test_engineering_agent_tools_include_tree_and_file_content(self):
        eng_tools = AGENTS["engineering"]["tools"]
        assert "get_github_tree" in eng_tools
        assert "get_github_file_content" in eng_tools

    def test_action_aliases_for_tree_and_file(self):
        assert normalize_action_name("repo_get_github_tree") == "get_github_tree"
        assert normalize_action_name("github_tree") == "get_github_tree"
        assert normalize_action_name("list_repo_files") == "get_github_tree"
        assert normalize_action_name("browser.get_github_tree") == "get_github_tree"

        assert normalize_action_name("repo_get_github_file_content") == "get_github_file_content"
        assert normalize_action_name("get_github_file") == "get_github_file_content"
        assert normalize_action_name("read_file") == "get_github_file_content"
        assert normalize_action_name("github_file") == "get_github_file_content"

    @patch("app.services.langgraph_agent.get_github_repos")
    @patch("app.services.langgraph_agent.get_github_tree")
    def test_run_tool_github_tree(self, mock_tree, mock_repos):
        from app.services.langgraph_agent import _run_tool_github_tree
        exact_repo = "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"
        mock_repos.return_value = [{"full_name": exact_repo, "name": "AIRA-AI-Retrieval-Action-Assistant-"}]
        mock_tree.return_value = {
            "repository": exact_repo,
            "branch": "main",
            "tree": [
                {"path": "README.md", "type": "blob", "size": 1200},
                {"path": "package.json", "type": "blob", "size": 800},
                {"path": "backend", "type": "tree"},
                {"path": "frontend", "type": "tree"},
            ],
            "count": 4,
            "source": "live",
        }

        state: AgentState = {
            "query": f"Inspect tree for {exact_repo}",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        res = _run_tool_github_tree(state, {"repo": exact_repo})
        assert res["repository"] == exact_repo
        assert res["count"] == 4
        assert len(res["tree"]) == 4

    @patch("app.services.langgraph_agent.get_github_repos")
    @patch("app.services.langgraph_agent.get_github_file_content")
    def test_run_tool_github_file_content(self, mock_file, mock_repos):
        from app.services.langgraph_agent import _run_tool_github_file_content
        exact_repo = "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"
        mock_repos.return_value = [{"full_name": exact_repo, "name": "AIRA-AI-Retrieval-Action-Assistant-"}]
        mock_file.return_value = {
            "repository": exact_repo,
            "path": "package.json",
            "content": '{\n  "name": "aira",\n  "version": "1.0.0"\n}',
            "size": 35,
            "source": "live",
        }

        state: AgentState = {
            "query": f"Read package.json in {exact_repo}",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "iterations": 0,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        res = _run_tool_github_file_content(state, {"repo": exact_repo, "path": "package.json"})
        assert res["repository"] == exact_repo
        assert res["path"] == "package.json"
        assert "aira" in res["content"]

    def test_finalize_node_cites_retrieved_github_files(self):
        state: AgentState = {
            "query": "Explain architecture of AIRA",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [
                {
                    "tool": "get_github_file_content",
                    "result": {
                        "repository": "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-",
                        "path": "package.json",
                        "content": '{\n  "name": "aira-ai-assistant",\n  "dependencies": {"express": "^4.18.2"}\n}',
                    },
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {
                "answer": "### Architecture\nAIRA uses Express for backend services based on package.json."
            },
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.85,
            "error": None,
            "status": "in_progress",
        }

        final = finalize_node(state)
        assert len(final["citations"]) > 0
        file_cits = [c for c in final["citations"] if c.get("filename") == "package.json"]
        assert len(file_cits) == 1
        assert file_cits[0]["retrieval_mode"] == "github"

    def test_finalize_node_reports_tree_error(self):
        state: AgentState = {
            "query": "Explain architecture of private repo",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [
                {
                    "tool": "get_github_tree",
                    "result": {
                        "error": "HTTP 404: Repository not found or access denied.",
                        "repository": "user/private-repo",
                    },
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": "final_answer",
            "next_action_input": {
                "answer": "Here is the architecture."
            },
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.5,
            "error": None,
            "status": "in_progress",
        }

        final = finalize_node(state)
        assert "❌ **GitHub Repository Tree Error" in final["final_answer"]
        assert "404" in final["final_answer"]

    def test_resolve_repo_argument_with_trailing_hyphen_and_short_query(self):
        from app.services.langgraph_agent import _resolve_repo_argument
        exact_repo = "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"

        state: AgentState = {
            "query": "Explain the architecture of my AIRA-AI-Retrieval-Action-Assistant repository. Identify its frontend, backend services, main technologies, and important API endpoints.",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [
                {
                    "tool": "list_github_repos",
                    "result": {
                        "repositories": [{"full_name": exact_repo, "name": "AIRA-AI-Retrieval-Action-Assistant-"}]
                    },
                }
            ],
            "steps": [],
            "iterations": 1,
            "next_action": None,
            "next_action_input": None,
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        # 1. Resolving with empty args (query has no trailing hyphen, repo has trailing hyphen)
        resolved, err = _resolve_repo_argument(state, {})
        assert err is None
        assert resolved == exact_repo

        # 2. Resolving with short name in args (no owner, no trailing hyphen)
        resolved2, err2 = _resolve_repo_argument(state, {"repo": "AIRA-AI-Retrieval-Action-Assistant"})
        assert err2 is None
        assert resolved2 == exact_repo

    def test_select_next_arch_file_priority(self):
        from app.services.langgraph_agent import _select_next_arch_file

        paths = [
            "README.md",
            "package.json",
            "frontend/package.json",
            "frontend/src/App.tsx",
            "backend/package.json",
            "backend/server.js",
            "backend/src/routes/github.js",
            "Ai-Service/app/main.py",
        ]

        # 1. Nothing read yet -> backend/package.json is top priority
        f1 = _select_next_arch_file(paths, set())
        assert f1 == "backend/package.json"

        # 2. backend/package.json read -> frontend/package.json
        f2 = _select_next_arch_file(paths, {"backend/package.json"})
        assert f2 == "frontend/package.json"

        # 3. Both read -> Ai-Service/app/main.py
        f3 = _select_next_arch_file(paths, {"backend/package.json", "frontend/package.json"})
        assert f3 == "Ai-Service/app/main.py"

        # 4. Three read -> README.md
        f4 = _select_next_arch_file(paths, {"backend/package.json", "frontend/package.json", "Ai-Service/app/main.py"})
        assert f4 == "README.md"

    @patch("app.services.langgraph_agent.get_llm_response")
    def test_finalize_node_recovers_from_architecture_disclaimer(self, mock_llm):
        mock_llm.return_value = (
            "### Architecture Overview & System Design\nAIRA is a full-stack AI workspace.\n\n"
            "### Frontend Architecture & Technologies\nReact, Vite, Tailwind CSS, Lucide icons (cited from `frontend/package.json`).\n\n"
            "### Backend Services & Node/Express Architecture\nExpress REST API, Mongoose, JWT auth (cited from `backend/package.json`).\n\n"
            "### AI Service & Retrieval Action Pipeline\nFastAPI, LangGraph multi-agent loop, Qdrant vector store (cited from `Ai-Service/app/main.py`).\n\n"
            "### Main Technologies & Databases\nMongoDB, Qdrant, Node.js, Python, TypeScript.\n\n"
            "### Key API Endpoints & Routes\n`/api/github/tree`, `/api/github/file`, `/api/tasks`, `/api/auth`.\n\n"
            "### Citations & Inspected Files\n- `backend/package.json`\n- `frontend/package.json`\n- `Ai-Service/app/main.py`"
        )

        exact_repo = "YashSoni-10/AIRA-AI-Retrieval-Action-Assistant-"
        disclaimer_answer = (
            "The repository tree and top-level README.md can be inspected. "
            "Attempts to read files such as backend/package.json, frontend/package.json, Ai-Service/app/main.py, "
            "and backend route/controller files return no data and no error. The agent cannot produce a source-backed architecture overview."
        )

        state: AgentState = {
            "query": "Explain the architecture of my AIRA-AI-Retrieval-Action-Assistant repository. Identify its frontend, backend services, main technologies, and important API endpoints using actual GitHub repository data. Cite the files you used.",
            "agent_id": "engineering",
            "agent_name": "Engineering Agent",
            "user_id": "u1",
            "workspace_id": "w1",
            "role": "member",
            "raw_token": "token123",
            "conversation_id": None,
            "messages": [],
            "tool_calls": [],
            "tool_results": [
                {
                    "tool": "get_github_tree",
                    "result": {
                        "repository": exact_repo,
                        "tree": [{"path": "backend/package.json"}, {"path": "frontend/package.json"}, {"path": "Ai-Service/app/main.py"}],
                    },
                },
                {
                    "tool": "get_github_file_content",
                    "result": {
                        "repository": exact_repo,
                        "path": "backend/package.json",
                        "content": '{"name": "aira-backend", "dependencies": {"express": "^4.18.2", "mongoose": "^8.0.0"}}',
                    },
                },
                {
                    "tool": "get_github_file_content",
                    "result": {
                        "repository": exact_repo,
                        "path": "frontend/package.json",
                        "content": '{"name": "aira-frontend", "dependencies": {"react": "^18.2.0", "vite": "^5.0.0"}}',
                    },
                },
                {
                    "tool": "get_github_file_content",
                    "result": {
                        "repository": exact_repo,
                        "path": "Ai-Service/app/main.py",
                        "content": 'from fastapi import FastAPI\napp = FastAPI(title="AIRA AI Service")',
                    },
                },
            ],
            "steps": [],
            "iterations": 4,
            "next_action": "final_answer",
            "next_action_input": {"answer": disclaimer_answer},
            "final_answer": "",
            "task_created": None,
            "citations": [],
            "confidence": 0.8,
            "error": None,
            "status": "in_progress",
        }

        final = finalize_node(state)
        # Verify the disclaimer was superseded by the synthesized, evidence-backed answer
        assert "Attempts to read files" not in final["final_answer"]
        assert "Frontend Architecture" in final["final_answer"]
        assert "Backend Services" in final["final_answer"]
        assert "AI Service" in final["final_answer"]
        assert len(final["citations"]) >= 3








# ─────────────────────────────────────────────────────────────────────────────
# Task Creation Regression Tests
# ─────────────────────────────────────────────────────────────────────────────

def _make_task_agent_state(**overrides) -> "AgentState":
    """Helper: build a minimal AgentState for the Task Agent."""
    base: AgentState = {
        "query": "Create a task",
        "agent_id": "task",
        "agent_name": "Task Agent",
        "user_id": "507f1f77bcf86cd799439011",
        "workspace_id": "ws1",
        "role": "member",
        "raw_token": "tok123",
        "conversation_id": None,
        "messages": [],
        "tool_calls": [],
        "tool_results": [],
        "steps": [],
        "iterations": 0,
        "next_action": None,
        "next_action_input": None,
        "final_answer": "",
        "task_created": None,
        "citations": [],
        "confidence": 0.8,
        "error": None,
        "status": "in_progress",
    }
    base.update(overrides)
    return base


class TestTaskCreationDueDateAndAssignee:
    """Regression tests for task creation with due_date and assigned_to support."""

    # ── TOOL_SPECS assertions ─────────────────────────────────────────────

    def test_create_task_tool_spec_has_due_date(self):
        ct = next((t for t in TOOL_SPECS if t["name"] == "create_task"), None)
        assert ct is not None, "create_task must be in TOOL_SPECS"
        assert "due_date" in ct["parameters"], "create_task TOOL_SPEC must declare due_date"

    def test_create_task_tool_spec_has_assigned_to(self):
        ct = next((t for t in TOOL_SPECS if t["name"] == "create_task"), None)
        assert ct is not None
        assert "assigned_to" in ct["parameters"], "create_task TOOL_SPEC must declare assigned_to"

    def test_update_task_tool_spec_has_due_date(self):
        ut = next((t for t in TOOL_SPECS if t["name"] == "update_task"), None)
        assert ut is not None
        assert "due_date" in ut["parameters"], "update_task TOOL_SPEC must declare due_date"

    def test_update_task_tool_spec_has_assigned_to(self):
        ut = next((t for t in TOOL_SPECS if t["name"] == "update_task"), None)
        assert ut is not None
        assert "assigned_to" in ut["parameters"], "update_task TOOL_SPEC must declare assigned_to"

    # ── _run_tool_create_task ─────────────────────────────────────────────

    def test_create_task_passes_due_date_to_tool(self):
        """_run_tool_create_task must forward due_date to tool_create_task."""
        state = _make_task_agent_state(user_id="507f1f77bcf86cd799439011")
        args = {
            "title": "Test AIRA Task Agent",
            "description": "Verify task creation and persistence.",
            "priority": "high",
            "due_date": "2026-11-05",
            "assigned_to": "current_user",
        }
        captured = {}

        def mock_create(**kwargs):
            captured.update(kwargs)
            return {
                "task_id": "aabbccddeeff001122334455",
                "title": kwargs["title"],
                "description": kwargs.get("description", ""),
                "priority": kwargs.get("priority", "medium"),
                "status": "todo",
                "due_date": kwargs.get("due_date"),
                "assigned_to": kwargs.get("assigned_to"),
                "task_created": True,
                "message": "Task created.",
            }

        with patch("app.services.agent_service.tool_create_task", side_effect=mock_create):
            result = _run_tool_create_task(state, args)

        assert captured.get("due_date") == "2026-11-05", (
            f"due_date '2026-11-05' must be forwarded; got {captured.get('due_date')!r}"
        )

    def test_create_task_resolves_current_user_to_user_id(self):
        """'current_user' in assigned_to must resolve to state['user_id']."""
        uid = "507f1f77bcf86cd799439011"
        state = _make_task_agent_state(user_id=uid)
        args = {
            "title": "Test AIRA Task Agent",
            "description": "Verify task creation.",
            "priority": "high",
            "assigned_to": "current_user",
        }
        captured = {}

        def mock_create(**kwargs):
            captured.update(kwargs)
            return {
                "task_id": "aabbccddeeff001122334455",
                "title": kwargs["title"],
                "task_created": True,
                "assigned_to": kwargs.get("assigned_to"),
            }

        with patch("app.services.agent_service.tool_create_task", side_effect=mock_create):
            _run_tool_create_task(state, args)

        # Must resolve to actual user ID, not the string literal "current_user"
        assert captured.get("assigned_to") == uid, (
            f"'current_user' must resolve to user_id '{uid}'; got {captured.get('assigned_to')!r}"
        )

    def test_create_task_resolves_me_alias_to_user_id(self):
        """'me' alias in assigned_to must also resolve to state['user_id']."""
        uid = "507f1f77bcf86cd799439022"
        state = _make_task_agent_state(user_id=uid)
        captured = {}

        def mock_create(**kwargs):
            captured.update(kwargs)
            return {"task_id": "xx", "task_created": True}

        with patch("app.services.agent_service.tool_create_task", side_effect=mock_create):
            _run_tool_create_task(state, {"title": "T", "assigned_to": "me"})

        assert captured.get("assigned_to") == uid

    def test_create_task_viewer_role_forbidden(self):
        """Viewer role must be blocked from creating tasks."""
        state = _make_task_agent_state(role="viewer")
        result = _run_tool_create_task(state, {"title": "T"})
        assert result.get("task_created") is False
        assert "Forbidden" in result.get("error", "") or "viewer" in result.get("error", "").lower()

    def test_create_task_duplicate_call_is_blocked(self):
        """A second create_task call must be blocked if a task was already created."""
        uid = "507f1f77bcf86cd799439011"
        state = _make_task_agent_state(user_id=uid)
        # Simulate a prior successful create_task in tool_results
        state["tool_results"] = [{
            "tool": "create_task",
            "result": {
                "task_id": "aabbccddeeff001122334455",
                "task_created": True,
                "title": "Test AIRA Task Agent",
            },
        }]

        mock_called = {"count": 0}

        def mock_create(**kwargs):
            mock_called["count"] += 1
            return {"task_id": "new-id", "task_created": True}

        with patch("app.services.agent_service.tool_create_task", side_effect=mock_create):
            result = _run_tool_create_task(state, {"title": "Duplicate Task"})

        assert mock_called["count"] == 0, "tool_create_task must NOT be called a second time"
        assert result.get("task_id") == "aabbccddeeff001122334455", "Must return the existing task"

    # ── _run_tool_update_task ─────────────────────────────────────────────

    def test_update_task_passes_due_date(self):
        """_run_tool_update_task must forward due_date to tool_update_task."""
        from app.services.langgraph_agent import _run_tool_update_task
        state = _make_task_agent_state()
        captured = {}

        def mock_update(**kwargs):
            captured.update(kwargs)
            return {"updated": True, "task_updated": True, "task_id": kwargs["task_id"]}

        with patch("app.services.agent_service.tool_update_task", side_effect=mock_update):
            _run_tool_update_task(state, {
                "task_id": "aabbccddeeff001122334455",
                "due_date": "2026-11-10",
            })

        assert captured.get("due_date") == "2026-11-10"

    def test_update_task_resolves_current_user_assignee(self):
        """update_task must resolve 'current_user' assignee to state user_id."""
        from app.services.langgraph_agent import _run_tool_update_task
        uid = "507f1f77bcf86cd799439011"
        state = _make_task_agent_state(user_id=uid)
        captured = {}

        def mock_update(**kwargs):
            captured.update(kwargs)
            return {"updated": True, "task_updated": True}

        with patch("app.services.agent_service.tool_update_task", side_effect=mock_update):
            _run_tool_update_task(state, {
                "task_id": "aabbccddeeff001122334455",
                "assigned_to": "current_user",
            })

        assert captured.get("assigned_to") == uid

    # ── tool_create_task (agent_service) date validation ─────────────────

    def test_tool_create_task_rejects_invalid_date(self):
        """tool_create_task must reject malformed date strings."""
        from app.services.agent_service import tool_create_task
        result = tool_create_task(
            title="T",
            description="",
            priority="medium",
            due_date="not-a-date",
            raw_token="",
        )
        assert result.get("task_created") is False
        assert "Invalid" in result.get("error", "") or "invalid" in result.get("message", "").lower()

    def test_tool_create_task_rejects_invalid_assignee(self):
        """tool_create_task must reject non-ObjectId, non-current_user assignees."""
        from app.services.agent_service import tool_create_task
        result = tool_create_task(
            title="T",
            description="",
            priority="medium",
            assigned_to="some-random-name",
            raw_token="",
        )
        assert result.get("task_created") is False
        assert "assignee" in result.get("error", "").lower() or "Invalid" in result.get("error", "")

    def test_tool_create_task_accepts_valid_iso_date(self):
        """tool_create_task must accept '2026-11-05' without error."""
        from app.services.agent_service import tool_create_task
        # No raw_token → falls back to simulated path; must NOT return date error
        result = tool_create_task(
            title="Test AIRA Task Agent",
            description="Verify task creation and persistence.",
            priority="high",
            due_date="2026-11-05",
            assigned_to="current_user",
            raw_token="",
        )
        # With no token, returns a simulated task — not a date validation error
        assert result.get("error") is None or "Invalid" not in result.get("error", "")
        assert result.get("task_id") is not None

    def test_tool_create_task_accepts_current_user_assignee(self):
        """tool_create_task must accept 'current_user' without returning an assignee error."""
        from app.services.agent_service import tool_create_task
        result = tool_create_task(
            title="Assign to me",
            description="",
            priority="low",
            assigned_to="current_user",
            raw_token="",
        )
        assert result.get("error") is None or "assignee" not in result.get("error", "").lower()

    # ── post-creation get_task verification in agent_reason_node ─────────

    def test_agent_reason_node_directs_to_get_task_after_create(self):
        """After a successful create_task, agent_reason_node must redirect to get_task (not repeat create_task)."""
        task_id = "aabbccddeeff001122334455"
        state = _make_task_agent_state(
            query="Create a high-priority task titled 'Test AIRA Task Agent'",
            iterations=1,
            tool_results=[{
                "tool": "create_task",
                "result": {
                    "task_id": task_id,
                    "task_created": True,
                    "title": "Test AIRA Task Agent",
                    "priority": "high",
                    "status": "todo",
                },
            }],
            tool_calls=[{"tool": "create_task", "arguments": {}}],
        )
        # LLM proposes create_task again (duplicate)
        llm_response = json.dumps({
            "thought": "I should create the task now.",
            "action": "create_task",
            "action_input": {"title": "Test AIRA Task Agent", "priority": "high"},
        })
        with patch("app.services.langgraph_agent.get_llm_response", return_value=llm_response):
            result = agent_reason_node(state)

        assert result["next_action"] == "get_task", (
            f"Expected 'get_task' after successful create_task, got '{result['next_action']}'"
        )
        assert result["next_action_input"].get("task_id") == task_id

    def test_agent_reason_node_final_answer_after_get_task_verification(self):
        """After create_task + get_task, agent_reason_node must allow final_answer."""
        task_id = "aabbccddeeff001122334455"
        state = _make_task_agent_state(
            query="Create a high-priority task titled 'Test AIRA Task Agent'",
            iterations=2,
            tool_results=[
                {
                    "tool": "create_task",
                    "result": {
                        "task_id": task_id,
                        "task_created": True,
                        "title": "Test AIRA Task Agent",
                    },
                },
                {
                    "tool": "get_task",
                    "result": {
                        "found": True,
                        "task": {
                            "task_id": task_id,
                            "title": "Test AIRA Task Agent",
                            "status": "todo",
                            "priority": "high",
                            "due_date": "2026-11-05",
                            "assigned_to": "507f1f77bcf86cd799439011",
                        },
                    },
                },
            ],
            tool_calls=[
                {"tool": "create_task", "arguments": {}},
                {"tool": "get_task", "arguments": {"task_id": task_id}},
            ],
        )
        llm_response = json.dumps({
            "thought": "Task created and verified. Providing final answer.",
            "action": "final_answer",
            "action_input": {"answer": "Task 'Test AIRA Task Agent' (ID: aabbccddeeff001122334455) was created successfully."},
        })
        with patch("app.services.langgraph_agent.get_llm_response", return_value=llm_response):
            result = agent_reason_node(state)

        assert result["next_action"] == "final_answer", (
            f"Expected 'final_answer' after create+verify; got '{result['next_action']}'"
        )

    # ── finalize_node task formatting ──────────────────────────────────────

    def test_finalize_node_formats_created_task_with_due_date_and_assignee(self):
        """finalize_node must include due_date and assigned_to in task detail output."""
        task_id = "aabbccddeeff001122334455"
        state = _make_task_agent_state(
            query="Create a task",
            iterations=2,
            next_action="final_answer",
            next_action_input={"answer": ""},
            tool_results=[
                {
                    "tool": "create_task",
                    "result": {
                        "task_id": task_id,
                        "task_created": True,
                        "title": "Test AIRA Task Agent",
                    },
                },
                {
                    "tool": "get_task",
                    "result": {
                        "found": True,
                        "task": {
                            "task_id": task_id,
                            "title": "Test AIRA Task Agent",
                            "description": "Verify task creation and persistence.",
                            "status": "todo",
                            "priority": "high",
                            "due_date": "2026-11-05",
                            "assigned_to": "507f1f77bcf86cd799439011",
                            "created_at": "2026-10-29T06:00:00.000Z",
                        },
                    },
                },
            ],
        )

        with patch("app.services.rag_engine.calculate_confidence", return_value=(0.85, {})):
            result = finalize_node(state)

        answer = result["final_answer"]
        assert "2026-11-05" in answer, f"Due date must appear in final answer; got:\n{answer}"
        assert task_id in answer or "Test AIRA Task Agent" in answer

    def test_finalize_node_marks_verified_task_as_created_and_verified(self):
        """finalize_node must label the result as 'Created and Verified' when create_task + get_task both ran."""
        task_id = "aabbccddeeff001122334455"
        state = _make_task_agent_state(
            query="Create a task",
            iterations=2,
            next_action="final_answer",
            next_action_input={"answer": ""},
            tool_results=[
                {
                    "tool": "create_task",
                    "result": {"task_id": task_id, "task_created": True},
                },
                {
                    "tool": "get_task",
                    "result": {
                        "found": True,
                        "task": {
                            "task_id": task_id,
                            "title": "Test Task",
                            "description": "",
                            "status": "todo",
                            "priority": "medium",
                            "due_date": None,
                            "assigned_to": None,
                            "created_at": "",
                        },
                    },
                },
            ],
        )
        with patch("app.services.rag_engine.calculate_confidence", return_value=(0.85, {})):
            result = finalize_node(state)

        assert "Created and Verified" in result["final_answer"] or task_id in result["final_answer"]

    # ── Task Agent system_prompt assertions ──────────────────────────────

    def test_task_agent_system_prompt_mentions_due_date(self):
        """Task Agent system_prompt must mention 'due_date' so the LLM knows to use it."""
        prompt = AGENTS["task"]["system_prompt"]
        assert "due_date" in prompt or "due date" in prompt.lower(), (
            "Task Agent system_prompt must instruct LLM to use due_date"
        )

    def test_task_agent_system_prompt_mentions_assigned_to(self):
        """Task Agent system_prompt must mention 'assigned_to' or 'current_user'."""
        prompt = AGENTS["task"]["system_prompt"]
        assert "assigned_to" in prompt or "current_user" in prompt, (
            "Task Agent system_prompt must instruct LLM to support assigned_to / current_user"
        )

    def test_task_agent_system_prompt_instructs_single_creation(self):
        """Task Agent system_prompt must explicitly say to call create_task only ONCE."""
        prompt = AGENTS["task"]["system_prompt"]
        assert "once" in prompt.lower() or "only once" in prompt.lower() or "not call create_task more than once" in prompt.lower(), (
            "Task Agent system_prompt must prevent duplicate create_task calls"
        )

    def test_task_agent_system_prompt_instructs_get_task_verification(self):
        """Task Agent system_prompt must instruct LLM to verify with get_task after creating."""
        prompt = AGENTS["task"]["system_prompt"]
        assert "get_task" in prompt, (
            "Task Agent system_prompt must instruct LLM to call get_task to verify persistence"
        )

    # ── Additional Workspace Member and Coverage Tests ────────────────────

    def test_create_task_with_all_five_fields(self):
        """Test task creation with all five fields: title, description, priority, due_date, assigned_to."""
        state = _make_task_agent_state()
        args = {
            "title": "Full Field Task",
            "description": "Comprehensive task with all 5 fields.",
            "priority": "high",
            "due_date": "2026-11-05",
            "assigned_to": "current_user",
        }
        captured = {}

        def mock_create(**kwargs):
            captured.update(kwargs)
            return {
                "task_id": "507f1f77bcf86cd799439099",
                "title": kwargs["title"],
                "description": kwargs["description"],
                "priority": kwargs["priority"],
                "due_date": kwargs["due_date"],
                "assigned_to": kwargs["assigned_to"],
                "status": "todo",
                "task_created": True,
            }

        with patch("app.services.agent_service.tool_create_task", side_effect=mock_create):
            result = _run_tool_create_task(state, args)

        assert result["task_created"] is True
        assert captured["title"] == "Full Field Task"
        assert captured["description"] == "Comprehensive task with all 5 fields."
        assert captured["priority"] == "high"
        assert captured["due_date"] == "2026-11-05"
        assert captured["assigned_to"] == state["user_id"]

    def test_create_task_without_optional_fields(self):
        """Backward compatibility: task creation with only title and priority succeeds."""
        state = _make_task_agent_state()
        args = {"title": "Minimal Task", "priority": "low"}
        captured = {}

        def mock_create(**kwargs):
            captured.update(kwargs)
            return {
                "task_id": "507f1f77bcf86cd799439088",
                "title": kwargs["title"],
                "priority": kwargs["priority"],
                "status": "todo",
                "task_created": True,
            }

        with patch("app.services.agent_service.tool_create_task", side_effect=mock_create):
            result = _run_tool_create_task(state, args)

        assert result["task_created"] is True
        assert captured["title"] == "Minimal Task"
        assert captured["priority"] == "low"
        assert captured.get("due_date") is None
        assert captured.get("assigned_to") is None

    def test_assign_to_valid_workspace_member_by_name(self):
        """Assigning a task to another valid workspace member resolves their ID."""
        from app.services.agent_service import tool_create_task
        mock_members = [
            {"_id": "507f1f77bcf86cd799439011", "name": "Current User", "email": "me@aira.io"},
            {"_id": "607f1f77bcf86cd799439022", "name": "Vaishnavi Member", "email": "vaishnavi@aira.io"},
        ]
        with patch("app.services.agent_service.get_workspace_members", return_value=mock_members):
            with patch("httpx.Client") as mock_client:
                mock_post = MagicMock()
                mock_post.status_code = 201
                mock_post.json.return_value = {
                    "task": {
                        "_id": "task123",
                        "title": "Team Task",
                        "assigned_to": "607f1f77bcf86cd799439022",
                    }
                }
                mock_client.return_value.__enter__.return_value.post.return_value = mock_post

                res = tool_create_task(
                    title="Team Task",
                    assigned_to="Vaishnavi Member",
                    raw_token="fake_jwt",
                )
                assert res["task_created"] is True
                assert res["assigned_to"] == "607f1f77bcf86cd799439022"

    def test_assign_to_valid_workspace_member_by_email(self):
        """Assigning a task by member email resolves their ID."""
        from app.services.agent_service import tool_create_task
        mock_members = [
            {"_id": "607f1f77bcf86cd799439033", "name": "Alice Engineer", "email": "alice@aira.io"},
        ]
        with patch("app.services.agent_service.get_workspace_members", return_value=mock_members):
            with patch("httpx.Client") as mock_client:
                mock_post = MagicMock()
                mock_post.status_code = 201
                mock_post.json.return_value = {
                    "task": {
                        "_id": "task456",
                        "title": "Alice Task",
                        "assigned_to": "607f1f77bcf86cd799439033",
                    }
                }
                mock_client.return_value.__enter__.return_value.post.return_value = mock_post

                res = tool_create_task(
                    title="Alice Task",
                    assigned_to="alice@aira.io",
                    raw_token="fake_jwt",
                )
                assert res["task_created"] is True
                assert res["assigned_to"] == "607f1f77bcf86cd799439033"

    def test_reject_cross_workspace_or_nonexistent_assignee(self):
        """Assignee not in workspace member list is rejected with a clear error."""
        from app.services.agent_service import tool_create_task
        mock_members = [
            {"_id": "507f1f77bcf86cd799439011", "name": "Current User", "email": "me@aira.io"},
        ]
        with patch("app.services.agent_service.get_workspace_members", return_value=mock_members):
            res = tool_create_task(
                title="Cross Workspace Task",
                assigned_to="607f1f77bcf86cd799439999",  # Not in workspace members
                raw_token="fake_jwt",
            )
            assert res["task_created"] is False
            assert "workspace" in res["error"].lower() or "not belong" in res["error"].lower()
