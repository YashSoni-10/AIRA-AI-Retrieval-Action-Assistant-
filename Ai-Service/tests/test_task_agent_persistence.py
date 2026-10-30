"""
Task Agent Persistence & Verification Regression Tests
======================================================
Requirements:
1. Update 'todo' to 'in-progress', retrieve the task from a fresh read, and assert 'in_progress'.
2. Persistence test covering a fresh API read after update.
3. Never fabricate tool success (prevent LLM from claiming a task was updated when
   the tool was never called, failed, or returned an error).
4. Verify task ID resolution from args, query regex, and prior tool results.
"""

import pytest
from unittest.mock import MagicMock, patch
from app.services.langgraph_agent import (
    _resolve_task_id,
    _run_tool_update_task,
    finalize_node,
)
from app.services.agent_service import tool_update_task, execute_agent


def test_resolve_task_id_from_args():
    state = {"query": "Please update this task", "tool_results": []}
    args = {"task_id": "6acd1f48a0f4ecb8a02cbc87"}
    assert _resolve_task_id(state, args) == "6acd1f48a0f4ecb8a02cbc87"


def test_resolve_task_id_from_query_regex_when_args_empty():
    state = {
        "query": "Update task 6acd1f48a0f4ecb8a02cbc87 from todo to in-progress",
        "tool_results": [],
    }
    args = {"status": "in-progress"}
    resolved = _resolve_task_id(state, args)
    assert resolved == "6acd1f48a0f4ecb8a02cbc87"


def test_resolve_task_id_from_prior_tool_results_with_task_id_key():
    state = {
        "query": "Update this task to in-progress",
        "tool_results": [
            {
                "tool": "list_tasks",
                "result": {
                    "tasks": [
                        {
                            "task_id": "6acd1f48a0f4ecb8a02cbc87",
                            "title": "AIRA Manual Test",
                            "status": "todo",
                        }
                    ]
                },
            }
        ],
    }
    args = {"title": "AIRA Manual Test"}
    resolved = _resolve_task_id(state, args)
    assert resolved == "6acd1f48a0f4ecb8a02cbc87"


def test_run_tool_update_task_handles_aliases_and_query_fallback():
    state = {
        "query": "Update task 6acd1f48a0f4ecb8a02cbc87 to in-progress",
        "raw_token": "dummy_token",
        "role": "member",
        "tool_results": [],
    }

    with patch("app.services.agent_service.tool_update_task") as mock_update:
        mock_update.return_value = {"updated": True, "task_updated": True}

        # Case 1: Status passed as new_status
        _run_tool_update_task(state, {"task_id": "6acd1f48a0f4ecb8a02cbc87", "new_status": "in-progress"})
        mock_update.assert_called_with(
            task_id="6acd1f48a0f4ecb8a02cbc87",
            title=None,
            description=None,
            status="in-progress",
            priority=None,
            raw_token="dummy_token",
        )

        # Case 2: Status omitted in args, extracted from query
        _run_tool_update_task(state, {"task_id": "6acd1f48a0f4ecb8a02cbc87"})
        mock_update.assert_called_with(
            task_id="6acd1f48a0f4ecb8a02cbc87",
            title=None,
            description=None,
            status="in_progress",
            priority=None,
            raw_token="dummy_token",
        )


def test_tool_update_task_authoritative_fresh_read_success():
    """Update todo to in-progress, retrieve task from fresh read, assert in-progress."""
    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client

        # Mock PATCH response (HTTP 200)
        mock_patch_resp = MagicMock()
        mock_patch_resp.status_code = 200
        mock_patch_resp.json.return_value = {
            "success": True,
            "task": {
                "_id": "6acd1f48a0f4ecb8a02cbc87",
                "title": "AIRA Manual Test",
                "status": "in_progress",
                "priority": "medium",
            },
        }

        # Mock fresh GET response (HTTP 200) confirming persistence
        mock_fresh_get = MagicMock()
        mock_fresh_get.status_code = 200
        mock_fresh_get.json.return_value = {
            "success": True,
            "task": {
                "_id": "6acd1f48a0f4ecb8a02cbc87",
                "title": "AIRA Manual Test",
                "status": "in_progress",
                "priority": "medium",
            },
        }

        mock_client.patch.return_value = mock_patch_resp
        mock_client.get.return_value = mock_fresh_get

        res = tool_update_task(
            task_id="6acd1f48a0f4ecb8a02cbc87",
            status="in-progress",
            raw_token="valid_jwt_token",
        )

        assert res["updated"] is True
        assert res["task_updated"] is True
        assert res["status"] == "in_progress"
        assert res["task_id"] == "6acd1f48a0f4ecb8a02cbc87"
        # Assert authoritative fresh GET was called
        mock_client.get.assert_called_once()
        assert "6acd1f48a0f4ecb8a02cbc87" in mock_client.get.call_args[0][0]


def test_tool_update_task_authoritative_fresh_read_mismatch_fails():
    """If fresh read does not reflect the update, it must fail rather than claim success."""
    with patch("httpx.Client") as mock_client_cls:
        mock_client = MagicMock()
        mock_client_cls.return_value.__enter__.return_value = mock_client

        mock_patch_resp = MagicMock()
        mock_patch_resp.status_code = 200
        mock_patch_resp.json.return_value = {
            "success": True,
            "task": {"_id": "6acd1f48a0f4ecb8a02cbc87", "status": "todo"},
        }

        # Stale/unpersisted fresh read still has 'todo'
        mock_fresh_get = MagicMock()
        mock_fresh_get.status_code = 200
        mock_fresh_get.json.return_value = {
            "success": True,
            "task": {"_id": "6acd1f48a0f4ecb8a02cbc87", "status": "todo"},
        }

        mock_client.patch.return_value = mock_patch_resp
        mock_client.get.return_value = mock_fresh_get

        res = tool_update_task(
            task_id="6acd1f48a0f4ecb8a02cbc87",
            status="in-progress",
            raw_token="valid_jwt_token",
        )

        assert res["updated"] is False
        assert res["task_updated"] is False
        assert "Persistence mismatch" in res["error"]


def test_finalize_node_never_fabricates_success_when_tool_fails():
    """When update_task tool fails, finalize_node must not claim success."""
    state = {
        "query": "Update task 6acd1f48a0f4ecb8a02cbc87 from todo to in-progress",
        "agent_name": "Task Agent",
        "tool_results": [
            {
                "tool": "update_task",
                "arguments": {"task_id": "6acd1f48a0f4ecb8a02cbc87", "status": "in-progress"},
                "result": {"updated": False, "task_updated": False, "error": "Task not found in the database"},
            }
        ],
        "steps": [],
        "task_created": None,
        "next_action_input": {"answer": "The task has been successfully updated to in-progress."},
    }

    res = finalize_node(state)
    answer = res.get("final_answer", "")
    assert "❌ **Task Update Error**" in answer or "Task not found" in answer
    assert "successfully updated" not in answer.lower()


def test_finalize_node_never_fabricates_success_when_tool_not_called():
    """When an update request runs without executing update_task, finalize_node rejects fabricated answer."""
    state = {
        "query": "Update task 6acd1f48a0f4ecb8a02cbc87 from todo to in-progress",
        "agent_name": "Task Agent",
        "tool_results": [],
        "steps": [],
        "task_created": None,
        "next_action_input": {"answer": "Task 6acd1f48a0f4ecb8a02cbc87 has been updated from todo to in-progress."},
    }

    res = finalize_node(state)
    answer = res.get("final_answer", "")
    assert "has been updated" not in answer.lower()
    assert "successfully updated" not in answer.lower()
    assert any(
        kw in answer.lower()
        for kw in ("unable to update", "cannot verify or perform", "error", "not executed", "cannot be given")
    )


def test_guard_intercepts_fabricated_synthesis():
    """If synthesis LLM tries to claim success without tool execution, guard forces error notice."""
    state = {
        "query": "Update task 6acd1f48a0f4ecb8a02cbc87 to in-progress",
        "agent_name": "Task Agent",
        "tool_results": [],
        "steps": [],
        "task_created": None,
        "next_action_input": {"answer": "The task has been updated to in-progress successfully."},
    }
    with patch("app.services.langgraph_agent.get_llm_response", return_value="The task 6acd1f48a0f4ecb8a02cbc87 has been updated to in-progress."):
        res = finalize_node(state)
        answer = res.get("final_answer", "")
        assert "❌ **Task Update Error**" in answer
        assert "was not executed" in answer


def test_execute_agent_fails_truthfully_on_crash():
    """execute_agent must return error status when orchestrator fails instead of fabricating update."""
    with patch("app.services.langgraph_agent.run_langgraph_agent", side_effect=RuntimeError("DB engine disconnected")):
        res = execute_agent(
            agent_id="task",
            query="Update task 6acd1f48a0f4ecb8a02cbc87 from todo to in-progress",
            user_id="user1",
            raw_token="dummy",
        )
        assert res["status"] == "error"
        assert "❌ **Task Operation Failed**" in res["answer"]
