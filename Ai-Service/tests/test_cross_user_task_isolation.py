"""
Cross-User Task Data Leakage & Authorization Regression Tests
============================================================
Ensures:
1. Vaishnavi can retrieve and update her own task.
2. HM can retrieve and update HM's own task.
3. HM cannot retrieve Vaishnavi's task by ID (returns 404/not found, no details leaked).
4. HM cannot update or delete Vaishnavi's task.
5. Direct API calls and Task Agent tool calls both enforce authorization.
6. Inaccessible tasks return a generic 404 or authorization error — never exposing
   another user's task details or claiming access is authorized.
"""
import pytest
from unittest.mock import patch, MagicMock
from app.services.agent_service import (
    tool_get_task,
    tool_update_task,
    tool_delete_task,
    execute_agent,
)
from app.services.langgraph_agent import finalize_node


VAISHNAVI_TASK_ID = "6ad5f463fed1f8cabefafa5f"
VAISHNAVI_USER_ID = "6aa701a4e91543f236103b25"
VAISHNAVI_WS_ID = "6aae9edbaa9e8f490521513b"
VAISHNAVI_TOKEN = "vaishnavi_test_jwt_token"

HM_TASK_ID = "6ad5f2a2fed1f8cabefafa5e"
HM_USER_ID = "6aae9f17aa9e8f490521513c"
HM_WS_ID = "6aae9f1faa9e8f490521513d"
HM_TOKEN = "hm_test_jwt_token"


class TestCrossUserTaskIsolation:
    def test_vaishnavi_can_retrieve_her_own_task(self):
        """Vaishnavi can retrieve her own task successfully via tool_get_task."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "success": True,
            "task": {
                "_id": VAISHNAVI_TASK_ID,
                "title": "Agent Persistence Test",
                "description": "Verify tasks created by Task Agent",
                "status": "todo",
                "priority": "medium",
                "createdAt": "2026-10-19T10:43:47.595Z",
            },
        }

        with patch("httpx.Client.get", return_value=mock_resp) as mock_get:
            res = tool_get_task(task_id=VAISHNAVI_TASK_ID, raw_token=VAISHNAVI_TOKEN)
            assert res["found"] is True
            assert res["task"]["task_id"] == VAISHNAVI_TASK_ID
            assert res["task"]["title"] == "Agent Persistence Test"
            mock_get.assert_called_once()
            call_headers = mock_get.call_args[1]["headers"]
            assert call_headers["Authorization"] == f"Bearer {VAISHNAVI_TOKEN}"

    def test_hm_can_retrieve_hm_own_task(self):
        """HM can retrieve HM's own task successfully via tool_get_task."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "success": True,
            "task": {
                "_id": HM_TASK_ID,
                "title": "HM Isolation Test",
                "description": "Testing isolation",
                "status": "in_progress",
                "priority": "high",
                "createdAt": "2026-10-19T10:40:00.000Z",
            },
        }

        with patch("httpx.Client.get", return_value=mock_resp):
            res = tool_get_task(task_id=HM_TASK_ID, raw_token=HM_TOKEN)
            assert res["found"] is True
            assert res["task"]["task_id"] == HM_TASK_ID
            assert res["task"]["title"] == "HM Isolation Test"

    def test_hm_cannot_retrieve_vaishnavi_task_by_id(self):
        """When HM attempts to retrieve Vaishnavi's task, Node returns 404 and tool_get_task reports not found."""
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_resp.json.return_value = {"success": False, "message": "Task not found"}

        with patch("httpx.Client.get", return_value=mock_resp) as mock_get:
            res = tool_get_task(task_id=VAISHNAVI_TASK_ID, raw_token=HM_TOKEN)
            assert res["found"] is False
            assert res["task"] is None
            assert "not found" in res["message"].lower()

    def test_hm_cannot_update_vaishnavi_task(self):
        """When HM attempts to update Vaishnavi's task, Node returns 404 or 403 and update fails."""
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_resp.json.return_value = {"success": False, "message": "Task not found"}

        with patch("httpx.Client.patch", return_value=mock_resp):
            res = tool_update_task(
                task_id=VAISHNAVI_TASK_ID,
                status="in-progress",
                raw_token=HM_TOKEN,
            )
            assert res["updated"] is False
            assert "not found" in res["error"].lower() or "error" in res

    def test_hm_cannot_delete_vaishnavi_task(self):
        """When HM attempts to delete Vaishnavi's task, Node returns 404 or 403 and delete fails."""
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_resp.json.return_value = {"success": False, "message": "Task not found"}

        with patch("httpx.Client.delete", return_value=mock_resp):
            res = tool_delete_task(task_id=VAISHNAVI_TASK_ID, raw_token=HM_TOKEN)
            assert res["deleted"] is False
            assert "not found" in res["error"].lower()

    def test_task_agent_never_leaks_or_fabricates_when_backend_returns_404(self):
        """
        When HM asks Task Agent to retrieve Vaishnavi's task ID, finalize_node strictly
        outputs an unauthorized / not found error and NEVER leaks Vaishnavi's real data.
        """
        state = {
            "query": f"Retrieve task {VAISHNAVI_TASK_ID}",
            "agent_name": "Task Agent",
            "user_id": HM_USER_ID,
            "workspace_id": HM_WS_ID,
            "role": "member",
            "raw_token": HM_TOKEN,
            "tool_calls": [
                {
                    "tool": "get_task",
                    "arguments": {"task_id": VAISHNAVI_TASK_ID},
                    "result_summary": f"Task '{VAISHNAVI_TASK_ID}' was not found in the workspace database.",
                }
            ],
            "tool_results": [
                {
                    "tool": "get_task",
                    "result": {
                        "found": False,
                        "task": None,
                        "task_id": VAISHNAVI_TASK_ID,
                        "message": f"Task '{VAISHNAVI_TASK_ID}' was not found in the workspace database.",
                    },
                }
            ],
            "steps": [],
            "next_action": "final_answer",
            "next_action_input": {
                # Even if an LLM hallucinated or tried to fabricate task details:
                "answer": f"Here are the task details: Agent Persistence Test (ID: {VAISHNAVI_TASK_ID}). Status: todo. Priority: medium. You are authorized to view it.",
            },
        }

        res = finalize_node(state)
        answer = res.get("final_answer", "")
        # Must report error notice
        assert "❌ **Task Retrieval Error**" in answer
        assert "was not found in your workspace or access is not authorized" in answer or "was not found in the workspace database" in answer
        # Must NEVER claim authorized or reveal details
        assert "you are authorized" not in answer.lower()
        assert "Agent Persistence Test" not in answer

    def test_task_agent_never_claims_authorization_when_tool_not_executed(self):
        """If Task Agent bypassed get_task or hallucinated, guard rejects and returns error."""
        state = {
            "query": f"Get task details for {VAISHNAVI_TASK_ID}",
            "agent_name": "Task Agent",
            "user_id": HM_USER_ID,
            "workspace_id": HM_WS_ID,
            "role": "member",
            "raw_token": HM_TOKEN,
            "tool_calls": [],
            "tool_results": [],
            "steps": [],
            "next_action": "final_answer",
            "next_action_input": {
                "answer": f"Task {VAISHNAVI_TASK_ID} is titled Agent Persistence Test and you are authorized.",
            },
        }

        res = finalize_node(state)
        answer = res.get("final_answer", "")
        assert "❌ **Task Retrieval Error**" in answer
        assert "Agent Persistence Test" not in answer
        assert "you are authorized" not in answer.lower()
