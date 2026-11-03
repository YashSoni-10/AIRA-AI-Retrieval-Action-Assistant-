"""
Agent Service - Stateful AI agent workforce.
Implements Knowledge Agent, Engineering Agent, and Task Agent
with tool-calling capabilities using LLM.

GitHub tools now use the authenticated user's workspace OAuth token
(forwarded from the agent endpoint as a Bearer JWT) rather than a
global settings.GITHUB_TOKEN. Token refresh/rotation is handled
transparently by the Node backend.
"""
from __future__ import annotations
import logging
import json
from app.services.llm_service import get_llm_response
from app.services.vector_store import similarity_search
from app.services.github_service import (
    get_github_repos,
    get_github_issues,
    get_github_pulls,
    get_github_tree,
    get_github_file_content,
    _NODE_URL,
)

logger = logging.getLogger(__name__)

# ── Tool Definitions ──────────────────────────────────────────────────────────

def tool_search_knowledge(query: str, user_id: str = "") -> dict:
    """Search the AIRA knowledge base for relevant information."""
    results = similarity_search(query, top_k=3, user_id=user_id, workspace_id=user_id)
    if not results:
        return {"found": False, "results": [], "message": "No documents found. Please upload documents first."}
    return {
        "found": True,
        "results": [
            {"text": r["text"][:300], "filename": r["filename"], "score": r["score"]}
            for r in results
        ],
        "message": f"Found {len(results)} relevant passages.",
    }


def tool_summarize_document(filename: str, user_id: str = "") -> dict:
    """Summarize a specific document from the knowledge base (scoped to user)."""
    results = similarity_search(
        f"summary overview of {filename}", top_k=5,
        user_id=user_id, workspace_id=user_id
    )
    doc_chunks = [r for r in results if r["filename"] == filename]
    if not doc_chunks:
        doc_chunks = results[:3]
    context = "\n\n".join([c["text"] for c in doc_chunks])
    if not context:
        return {"summary": "Document not found in knowledge base.", "filename": filename}
    summary = get_llm_response(
        "You are a document summarizer. Provide a clear, concise summary.",
        f"Summarize this content from '{filename}':\n\n{context}",
        max_tokens=512,
    )
    return {"summary": summary, "filename": filename, "chunks_used": len(doc_chunks)}


def get_workspace_members(raw_token: str = "") -> list[dict]:
    """Retrieve workspace members from Node backend to resolve assignee names/emails/IDs."""
    import httpx
    if not raw_token:
        return []
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(
                f"{_NODE_URL}/api/workspace/members",
                headers={"Authorization": f"Bearer {raw_token}", "Accept": "application/json"},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("members", [])
    except Exception as exc:
        logger.warning("get_workspace_members failed: %s", exc)
    return []


def tool_create_task(
    title: str,
    description: str = "",
    priority: str = "medium",
    due_date: str | None = None,
    assigned_to: str | None = None,
    raw_token: str = "",
    conversation_id: str | None = None,
) -> dict:
    """
    Create a persistent task via the Node backend API (real MongoDB storage).

    Security:
    - title/description/priority/due_date/assigned_to are sanitized and validated
    - raw_token is forwarded as Bearer JWT — never stored or logged here
    - workspace isolation is enforced by the Node backend
    - LLM-supplied values are validated against allowed enums and formats

    Falls back to a clearly-labelled simulated ID only if the Node backend
    is completely unreachable, and logs the failure explicitly.
    """
    import httpx
    import re
    from datetime import datetime

    # Sanitize LLM-supplied fields — never blindly trust raw LLM JSON
    clean_title = str(title or "").strip()[:200] or "Untitled Task"
    clean_description = str(description or "").strip()[:2000]
    clean_priority = priority.lower() if priority and priority.lower() in ("low", "medium", "high") else "medium"

    # Validate due_date
    clean_due_date = None
    if due_date is not None and str(due_date).strip() and str(due_date).strip().lower() not in ("null", "none", "undefined", ""):
        d_str = str(due_date).strip()
        try:
            if len(d_str) == 10 and d_str[4] == "-" and d_str[7] == "-":
                datetime.strptime(d_str, "%Y-%m-%d")
                clean_due_date = d_str
            else:
                dt = datetime.fromisoformat(d_str.replace("Z", "+00:00"))
                clean_due_date = dt.strftime("%Y-%m-%d") if (dt.hour == 0 and dt.minute == 0) else dt.isoformat()
        except Exception:
            return {
                "task_id": None,
                "task_created": False,
                "error": f"Invalid due_date '{d_str}'. Must be a valid date string (e.g. YYYY-MM-DD or ISO 8601).",
                "message": f"Invalid date: '{d_str}'. Please provide a valid date format such as YYYY-MM-DD.",
            }

    # Validate and resolve assigned_to
    clean_assigned_to = None
    if assigned_to is not None and str(assigned_to).strip() and str(assigned_to).strip().lower() not in ("null", "none", "undefined", ""):
        a_str = str(assigned_to).strip()
        if a_str.lower() in ("current_user", "current-user", "current user", "me", "self", "myself"):
            clean_assigned_to = "current_user"
        else:
            members = get_workspace_members(raw_token) if raw_token else []
            matched = None
            if members:
                for m in members:
                    if str(m.get("_id")) == a_str:
                        matched = m
                        break
                if not matched:
                    for m in members:
                        if m.get("email") and str(m.get("email")).lower() == a_str.lower():
                            matched = m
                            break
                if not matched:
                    for m in members:
                        if m.get("name") and str(m.get("name")).lower() == a_str.lower():
                            matched = m
                            break
            if matched:
                clean_assigned_to = str(matched.get("_id"))
            elif re.match(r"^[0-9a-fA-F]{24}$", a_str):
                if members:
                    return {
                        "task_id": None,
                        "task_created": False,
                        "error": f"Assignee '{a_str}' does not belong to this workspace or is not an active member.",
                        "message": f"Assignee '{a_str}' not found in workspace.",
                    }
                clean_assigned_to = a_str
            else:
                return {
                    "task_id": None,
                    "task_created": False,
                    "error": f"Assignee '{a_str}' not found among workspace members.",
                    "message": f"Assignee '{a_str}' not found among workspace members.",
                }

    payload: dict = {
        "title": clean_title,
        "description": clean_description,
        "priority": clean_priority,
        "source": "agent",
    }
    if clean_due_date:
        payload["due_date"] = clean_due_date
    if clean_assigned_to:
        payload["assigned_to"] = clean_assigned_to
    if conversation_id:
        payload["conversation_id"] = conversation_id

    if not raw_token:
        # No token available — return a clearly-labelled simulated task
        logger.warning("tool_create_task: no raw_token — cannot persist task to MongoDB")
        import uuid
        fake_id = str(uuid.uuid4())[:8].upper()
        return {
            "task_id": f"SIMULATED-{fake_id}",
            "title": clean_title,
            "description": clean_description,
            "priority": clean_priority,
            "status": "todo",
            "due_date": clean_due_date,
            "assigned_to": clean_assigned_to,
            "task_created": False,
            "message": "Task could not be persisted (no auth token). Please create it manually.",
            "note": "Simulated — agent was called without authentication context.",
        }

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                f"{_NODE_URL}/api/tasks",
                json=payload,
                headers={"Authorization": f"Bearer {raw_token}", "Accept": "application/json"},
            )

        if resp.status_code in (200, 201):
            data = resp.json()
            task = data.get("task", {})
            task_id = str(task.get("_id", ""))
            is_dedup = bool(data.get("deduplicated"))
            return {
                "task_id": task_id,
                "title": task.get("title", clean_title),
                "description": task.get("description", clean_description),
                "priority": task.get("priority", clean_priority),
                "status": task.get("status", "todo"),
                "due_date": task.get("due_date", clean_due_date),
                "assigned_to": task.get("assigned_to", clean_assigned_to),
                "task_created": True,
                "deduplicated": is_dedup,
                "task": task,
                "message": f"Task {'already existed and retrieved' if is_dedup else 'created successfully'} (ID: {task_id}).",
            }
        elif resp.status_code == 400:
            err_msg = "Invalid parameters."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            return {
                "task_id": None,
                "task_created": False,
                "error": err_msg,
                "message": f"Task creation failed: {err_msg}",
            }
        elif resp.status_code == 403:
            logger.warning("tool_create_task: 403 Forbidden returned by backend (viewer role or unauthorized)")
            return {
                "task_id": None,
                "task_created": False,
                "error": "Forbidden: Viewers cannot create tasks.",
                "message": "Permission denied: Viewers have read-only access and cannot create tasks in this workspace.",
            }

        logger.error("tool_create_task: Node returned %d — %s", resp.status_code, resp.text[:200])
        return {
            "task_id": None,
            "task_created": False,
            "message": f"Task creation failed (HTTP {resp.status_code}). Please try again.",
        }

    except Exception as exc:
        logger.error("tool_create_task: request to Node backend failed: %s", str(exc))
        import uuid
        fake_id = str(uuid.uuid4())[:8].upper()
        return {
            "task_id": f"SIMULATED-{fake_id}",
            "task_created": False,
            "message": "Task could not be persisted (backend unreachable). Please create it manually.",
            "note": f"Simulated due to backend error: {type(exc).__name__}",
        }


def tool_list_tasks(
    raw_token: str = "",
    status: str | None = None,
    priority: str | None = None,
    limit: int = 20,
) -> dict:
    """List persisted workspace tasks from the Node backend."""
    import httpx

    if not raw_token:
        return {"tasks": [], "count": 0, "message": "No auth token provided."}

    params: dict[str, str] = {}
    if status and status.lower() in ("todo", "in_progress", "completed", "cancelled"):
        params["status"] = status.lower()
    if priority and priority.lower() in ("low", "medium", "high"):
        params["priority"] = priority.lower()

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(
                f"{_NODE_URL}/api/tasks",
                params=params,
                headers={"Authorization": f"Bearer {raw_token}", "Accept": "application/json"},
            )
        if resp.status_code == 200:
            data = resp.json()
            raw_tasks = data.get("tasks", [])[:limit]
            tasks = [
                {
                    "task_id": str(t.get("_id", "")),
                    "title": t.get("title", ""),
                    "description": t.get("description", ""),
                    "status": t.get("status", "todo"),
                    "priority": t.get("priority", "medium"),
                    "created_at": t.get("createdAt", ""),
                }
                for t in raw_tasks
            ]
            return {"tasks": tasks, "count": len(tasks), "message": f"Found {len(tasks)} tasks."}
        return {"tasks": [], "count": 0, "error": f"Failed to list tasks (HTTP {resp.status_code})."}
    except Exception as exc:
        logger.error("tool_list_tasks error: %s", exc)
        return {"tasks": [], "count": 0, "error": f"Cannot reach tasks service: {exc}"}


def tool_get_task(task_id: str, raw_token: str = "") -> dict:
    """Retrieve a single task by its database ID."""
    import httpx

    if not raw_token:
        return {"found": False, "task": None, "error": "Authentication context is missing. Please ensure you are logged in."}
    if not task_id or str(task_id).strip() in ("null", "none", "undefined", ""):
        return {"found": False, "task": None, "error": "Task ID is required to retrieve a task."}

    clean_id = str(task_id).strip()
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(
                f"{_NODE_URL}/api/tasks/{clean_id}",
                headers={"Authorization": f"Bearer {raw_token}", "Accept": "application/json"},
            )
        if resp.status_code == 200:
            data = resp.json()
            t = data.get("task", {})
            task = {
                "task_id": str(t.get("_id", clean_id)),
                "title": t.get("title", ""),
                "description": t.get("description", ""),
                "status": t.get("status", "todo"),
                "priority": t.get("priority", "medium"),
                "due_date": t.get("due_date"),
                "assigned_to": t.get("assigned_to"),
                "created_at": t.get("createdAt", ""),
            }
            return {"found": True, "task": task, "message": f"Task '{task['title']}' found."}
        elif resp.status_code == 404:
            return {"found": False, "task": None, "task_id": clean_id, "message": f"Task '{clean_id}' was not found in the workspace database."}
        elif resp.status_code == 403:
            return {"found": False, "task": None, "task_id": clean_id, "error": f"Forbidden: You do not have permission to view task '{clean_id}'."}
        return {"found": False, "task": None, "task_id": clean_id, "error": f"Error retrieving task (HTTP {resp.status_code})."}
    except Exception as exc:
        logger.error("tool_get_task error: %s", exc)
        return {"found": False, "task": None, "task_id": clean_id, "error": f"Backend connection failed: {exc}"}


def tool_delete_task(task_id: str, raw_token: str = "") -> dict:
    """Delete a single task by its database ID."""
    import httpx

    if not raw_token:
        return {"deleted": False, "task_id": task_id, "error": "Authentication context is missing. Please ensure you are logged in."}
    if not task_id or str(task_id).strip() in ("null", "none", "undefined", ""):
        return {"deleted": False, "task_id": task_id, "error": "Task ID is required to delete a task."}

    clean_id = str(task_id).strip()
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.delete(
                f"{_NODE_URL}/api/tasks/{clean_id}",
                headers={"Authorization": f"Bearer {raw_token}", "Accept": "application/json"},
            )
        if resp.status_code == 200:
            return {"deleted": True, "task_id": clean_id, "message": f"Task '{clean_id}' deleted successfully."}
        elif resp.status_code == 404:
            return {"deleted": False, "task_id": clean_id, "error": f"Task '{clean_id}' was not found in your workspace."}
        elif resp.status_code == 403:
            return {"deleted": False, "task_id": clean_id, "error": f"Forbidden: You do not have permission to delete task '{clean_id}'."}
        return {"deleted": False, "task_id": clean_id, "error": f"Error deleting task (HTTP {resp.status_code})."}
    except Exception as exc:
        logger.error("tool_delete_task error: %s", exc)
        return {"deleted": False, "task_id": clean_id, "error": f"Backend connection failed: {exc}"}


def tool_search_tasks(query: str, raw_token: str = "") -> dict:
    """Search persisted workspace tasks by title or description query."""
    import httpx

    if not raw_token:
        return {"tasks": [], "count": 0, "message": "No auth token provided."}

    clean_query = str(query or "").strip()[:100]
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(
                f"{_NODE_URL}/api/tasks",
                params={"q": clean_query},
                headers={"Authorization": f"Bearer {raw_token}", "Accept": "application/json"},
            )
        if resp.status_code == 200:
            data = resp.json()
            raw_tasks = data.get("tasks", [])
            tasks = [
                {
                    "task_id": str(t.get("_id", "")),
                    "title": t.get("title", ""),
                    "description": t.get("description", ""),
                    "status": t.get("status", "todo"),
                    "priority": t.get("priority", "medium"),
                }
                for t in raw_tasks
            ]
            return {
                "tasks": tasks,
                "count": len(tasks),
                "query": clean_query,
                "message": f"Found {len(tasks)} matching tasks for '{clean_query}'.",
            }
        return {"tasks": [], "count": 0, "error": f"Failed to search tasks (HTTP {resp.status_code})."}
    except Exception as exc:
        logger.error("tool_search_tasks error: %s", exc)
        return {"tasks": [], "count": 0, "error": f"Backend connection failed: {exc}"}


def tool_update_task(
    task_id: str,
    raw_token: str = "",
    status: str | None = None,
    priority: str | None = None,
    title: str | None = None,
    description: str | None = None,
    due_date: str | None = None,
    assigned_to: str | None = None,
    **kwargs,
) -> dict:
    """Update an existing task in the workspace database and verify persistence with a fresh read."""
    import httpx

    if not raw_token:
        return {"updated": False, "task_updated": False, "error": "Authentication context is missing. Please ensure you are logged in."}

    clean_id = str(task_id or "").strip()
    if not clean_id or clean_id.lower() in ("null", "none", "undefined", ""):
        return {"updated": False, "task_updated": False, "error": "Task ID is required to update a task."}

    payload: dict = {}

    # Support status aliases from kwargs
    effective_status = status if status is not None else kwargs.get("new_status", kwargs.get("state", kwargs.get("task_status")))
    if effective_status is not None and str(effective_status).strip():
        st_norm = str(effective_status).strip().lower()
        if st_norm in ("in-progress", "inprogress", "doing"):
            st_norm = "in_progress"
        elif st_norm in ("done", "complete"):
            st_norm = "completed"
        elif st_norm in ("to-do", "to_do", "pending"):
            st_norm = "todo"
        elif st_norm == "canceled":
            st_norm = "cancelled"

        if st_norm in ("todo", "in_progress", "completed", "cancelled"):
            payload["status"] = st_norm
        else:
            return {
                "updated": False,
                "task_updated": False,
                "error": f"Invalid status '{effective_status}'. Allowed statuses: 'todo', 'in-progress' (or 'in_progress'), 'completed' (or 'done'), 'cancelled'.",
            }

    effective_priority = priority if priority is not None else kwargs.get("new_priority")
    if effective_priority is not None and str(effective_priority).strip():
        pr_norm = str(effective_priority).strip().lower()
        if pr_norm in ("low", "medium", "high"):
            payload["priority"] = pr_norm
        else:
            return {
                "updated": False,
                "task_updated": False,
                "error": f"Invalid priority '{effective_priority}'. Allowed priorities: 'low', 'medium', 'high'.",
            }

    effective_title = title if title is not None else kwargs.get("new_title")
    if effective_title is not None and str(effective_title).strip():
        payload["title"] = str(effective_title).strip()[:200]

    effective_desc = description if description is not None else kwargs.get("new_description")
    if effective_desc is not None:
        payload["description"] = str(effective_desc).strip()[:2000]

    # Validate due_date
    effective_due_date = due_date if due_date is not None else kwargs.get("dueDate", kwargs.get("due"))
    if effective_due_date is not None and str(effective_due_date).strip() and str(effective_due_date).strip().lower() not in ("null", "none", "undefined", ""):
        d_str = str(effective_due_date).strip()
        try:
            if re.match(r"^\d{4}-\d{2}-\d{2}$", d_str):
                datetime.strptime(d_str, "%Y-%m-%d")
                payload["due_date"] = d_str
            else:
                dt = datetime.fromisoformat(d_str.replace("Z", "+00:00"))
                payload["due_date"] = dt.strftime("%Y-%m-%d") if (dt.hour == 0 and dt.minute == 0) else dt.isoformat()
        except Exception:
            return {
                "updated": False,
                "task_updated": False,
                "error": f"Invalid due_date '{d_str}'. Must be a valid date string (e.g. YYYY-MM-DD or ISO 8601).",
            }

    # Validate assigned_to
    effective_assigned_to = assigned_to if assigned_to is not None else kwargs.get("assignee", kwargs.get("assignedTo"))
    if effective_assigned_to is not None and str(effective_assigned_to).strip() and str(effective_assigned_to).strip().lower() not in ("null", "none", "undefined", ""):
        a_str = str(effective_assigned_to).strip()
        if a_str.lower() in ("current_user", "current-user", "current user", "me", "self", "myself"):
            payload["assigned_to"] = "current_user"
        else:
            members = get_workspace_members(raw_token) if raw_token else []
            matched = None
            if members:
                for m in members:
                    if str(m.get("_id")) == a_str:
                        matched = m
                        break
                if not matched:
                    for m in members:
                        if m.get("email") and str(m.get("email")).lower() == a_str.lower():
                            matched = m
                            break
                if not matched:
                    for m in members:
                        if m.get("name") and str(m.get("name")).lower() == a_str.lower():
                            matched = m
                            break
            if matched:
                payload["assigned_to"] = str(matched.get("_id"))
            elif re.match(r"^[0-9a-fA-F]{24}$", a_str):
                if members:
                    return {
                        "updated": False,
                        "task_updated": False,
                        "error": f"Assignee '{a_str}' does not belong to this workspace or is not an active member.",
                    }
                payload["assigned_to"] = a_str
            else:
                return {
                    "updated": False,
                    "task_updated": False,
                    "error": f"Assignee '{a_str}' not found among workspace members.",
                }

    if not payload:
        return {"updated": False, "task_updated": False, "error": "No valid fields to update. Please specify status, priority, title, description, due_date, or assigned_to."}

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.patch(
                f"{_NODE_URL}/api/tasks/{clean_id}",
                json=payload,
                headers={"Authorization": f"Bearer {raw_token}", "Accept": "application/json", "Cache-Control": "no-cache"},
            )
            if resp.status_code == 200:
                patch_data = resp.json()
                t = patch_data.get("task", {})

                # Authoritative fresh read verification directly from persistent store
                try:
                    fresh_resp = client.get(
                        f"{_NODE_URL}/api/tasks/{clean_id}",
                        headers={"Authorization": f"Bearer {raw_token}", "Accept": "application/json", "Cache-Control": "no-cache"},
                    )
                    if fresh_resp.status_code == 200:
                        fresh_data = fresh_resp.json()
                        t = fresh_data.get("task", t)
                        # Strict verification of updated fields against fresh persistent store read
                        if "status" in payload and t.get("status") != payload["status"]:
                            return {
                                "updated": False,
                                "task_updated": False,
                                "error": f"Persistence mismatch: expected status '{payload['status']}' but persistent database returned '{t.get('status')}'.",
                            }
                        if "priority" in payload and t.get("priority") != payload["priority"]:
                            return {
                                "updated": False,
                                "task_updated": False,
                                "error": f"Persistence mismatch: expected priority '{payload['priority']}' but persistent database returned '{t.get('priority')}'.",
                            }
                        if "title" in payload and t.get("title") != payload["title"]:
                            return {
                                "updated": False,
                                "task_updated": False,
                                "error": f"Persistence mismatch: expected title '{payload['title']}' but persistent database returned '{t.get('title')}'.",
                            }
                    elif fresh_resp.status_code in (400, 403, 404, 500):
                        return {
                            "updated": False,
                            "task_updated": False,
                            "error": f"Persistence verification failed: task '{clean_id}' could not be re-verified after update (HTTP {fresh_resp.status_code}).",
                        }
                except (httpx.ConnectError, httpx.NetworkError) as net_err:
                    logger.warning("Authoritative read verification network error: %s", net_err)
                    if not t:
                        return {"updated": False, "task_updated": False, "error": f"Verification connection failed: {net_err}"}

                return {
                    "updated": True,
                    "task_updated": True,
                    "task_id": str(t.get("_id", clean_id)),
                    "title": t.get("title", ""),
                    "status": t.get("status", ""),
                    "priority": t.get("priority", ""),
                    "due_date": t.get("due_date"),
                    "assigned_to": t.get("assigned_to"),
                    "message": f"Task '{t.get('title', clean_id)}' (ID: {t.get('_id', clean_id)}) successfully updated. Status is now '{t.get('status', '')}'.",
                }
            elif resp.status_code == 403:
                return {"updated": False, "task_updated": False, "error": "Permission denied: Viewers cannot update tasks, and members can only update their own tasks."}
            elif resp.status_code == 404:
                return {"updated": False, "task_updated": False, "error": f"Task with ID '{clean_id}' was not found in the workspace database."}
            elif resp.status_code == 400:
                err_msg = resp.json().get("message", "Invalid update payload") if resp.headers.get("content-type", "").startswith("application/json") else resp.text
                return {"updated": False, "task_updated": False, "error": f"Validation error: {err_msg}"}
            return {"updated": False, "task_updated": False, "error": f"Update failed (HTTP {resp.status_code})."}
    except Exception as exc:
        logger.error("tool_update_task error: %s", exc)
        return {"updated": False, "task_updated": False, "error": f"Backend connection failed: {exc}"}


def tool_answer_question(question: str) -> dict:
    """Answer a general question using the LLM without knowledge base."""
    answer = get_llm_response(
        "You are AIRA, a helpful enterprise AI assistant. Answer professionally and concisely.",
        question,
        max_tokens=512,
    )
    return {"answer": answer}


def tool_list_github_repos(raw_token: str = "") -> dict:
    """
    List repositories for the authenticated user's connected GitHub workspace.
    Uses the user's workspace OAuth token via the Node backend.
    Never returns raw tokens. Raises RuntimeError on auth failure.
    """
    result = get_github_repos(raw_token=raw_token)
    repos = result.get("repositories", [])
    return {
        "repositories": [r.get("full_name", r.get("name", "unknown")) for r in repos],
        "count": result["count"],
        "source": result["source"],
        **({"mock_reason": result["mock_reason"]} if "mock_reason" in result else {}),
    }


def tool_get_github_issues(raw_token: str = "", repo: str | None = None) -> dict:
    """
    Get issues for the authenticated user's connected GitHub workspace.
    Uses the user's workspace OAuth token via the Node backend.
    """
    result = get_github_issues(raw_token=raw_token, repo_full_name=repo)
    issues = result.get("issues", [])
    return {
        "repository": repo or "workspace-default",
        "issues": [
            {"number": i.get("number"), "title": i.get("title"), "state": i.get("state")}
            for i in issues
        ],
        "count": result["count"],
        "source": result["source"],
        **({"mock_reason": result["mock_reason"]} if "mock_reason" in result else {}),
    }


def tool_get_github_pulls(raw_token: str = "", repo: str | None = None) -> dict:
    """
    Get pull requests for the authenticated user's connected GitHub workspace.
    Uses the user's workspace OAuth token via the Node backend.
    """
    result = get_github_pulls(raw_token=raw_token, repo_full_name=repo)
    pulls = result.get("pulls", [])
    return {
        "repository": repo or "workspace-default",
        "pulls": [
            {"number": p.get("number"), "title": p.get("title"), "state": p.get("state")}
            for p in pulls
        ],
        "count": result["count"],
        "source": result["source"],
        **({"mock_reason": result["mock_reason"]} if "mock_reason" in result else {}),
    }


def tool_get_github_tree(
    raw_token: str = "",
    repo: str | None = None,
    branch: str | None = None,
    path: str | None = None,
) -> dict:
    """
    Get the file and directory tree of a workspace GitHub repository.
    Uses the user's workspace OAuth token via the Node backend.
    """
    return get_github_tree(raw_token=raw_token, repo_full_name=repo, branch=branch, path=path)


def tool_get_github_file_content(
    raw_token: str = "",
    repo: str | None = None,
    path: str = "",
    ref: str | None = None,
) -> dict:
    """
    Get the text content of a specific file in a workspace GitHub repository.
    Uses the user's workspace OAuth token via the Node backend.
    """
    return get_github_file_content(raw_token=raw_token, repo_full_name=repo, path=path, ref=ref)


# ── Agent Definitions ──────────────────────────────────────────────────────────

AGENTS = {
    "knowledge": {
        "name": "Knowledge Agent",
        "description": "Searches and retrieves information from the enterprise knowledge base",
        "system_prompt": """You are the AIRA Knowledge Agent. Your job is to:
1. Search the knowledge base for relevant information
2. Summarize documents when asked
3. Answer questions based on indexed documents
Be precise, cite your sources, and always indicate confidence level.""",
        "tools": ["search_knowledge", "summarize_document", "answer_question"],
    },
    "engineering": {
        "name": "Engineering Agent",
        "description": "Handles technical queries, code explanations, system documentation, and GitHub integrations",
        "system_prompt": """You are the AIRA Engineering Agent. Your expertise covers:
- Code review, architecture analysis, and repository explanation
- Technical documentation and API system design
- GitHub integration (fetching repositories, file trees, file contents, issues, and PRs)
Search the knowledge base for technical context and use GitHub tools to inspect real code repository data.
CRITICAL INSTRUCTIONS:
- To list workspace GitHub repositories, use 'list_github_repos' (do not invent tool names like 'repo_list_github_repos').
- To inspect the file tree and directory structure of a repository, use 'get_github_tree' with 'repo' as 'owner/repo'.
- To read the actual content of key files (such as README.md, package.json, requirements.txt, or entry point files), use 'get_github_file_content' with 'repo' as 'owner/repo' and 'path'.
- When explaining repository architecture, inspect the repository tree and read relevant configuration/source files, then clearly explain the frontend, backend services, main technologies, and important API endpoints using actual repository data.
- Always cite the exact repository files used in your analysis.
- To inspect issues for a repository, use 'get_github_issues' with 'repo' as 'owner/repo'.
- To inspect pull requests for a repository, use 'get_github_pulls' with 'repo' as 'owner/repo'.
- When presenting repositories, always cite their name, owner, and html_url link.""",
        "tools": [
            "search_knowledge",
            "list_github_repos",
            "get_github_tree",
            "get_github_file_content",
            "get_github_issues",
            "get_github_pulls",
            "answer_question",
        ],
    },
    "task": {
        "name": "Task Agent",
        "description": "Manages tasks, action items, task search, status updates, and workspace tracking",
        "system_prompt": """You are the AIRA Task Agent. You manage workspace tasks and action items by:
- Creating persistent tasks with title, description, priority, due date (due_date), and assignee (assigned_to, supporting 'current_user' for the current authenticated user)
- Finding, retrieving, listing, and searching existing persisted tasks using task tools (list_tasks, get_task, search_tasks)
- Updating task status, priority, due date, or assignee using update_task
CRITICAL INSTRUCTIONS:
- When asked to create a task, ALWAYS call create_task directly with title, description, priority, due_date (e.g. YYYY-MM-DD), and assigned_to ('current_user' if assigned to the user). NEVER refuse or ask clarification when parameters can be provided.
- Execute create_task only once per request. After creating the task, verify its persistence with get_task, and return the verified task details (ID, title, description, status, priority, assignee, due date).
- When asked to find, list, search, or check existing tasks, ALWAYS call task retrieval tools (list_tasks, get_task, or search_tasks). NEVER use search_knowledge to look for persisted tasks.
- If a task is not found in the task database, clearly say so. Never fabricate task IDs or claim persistence without proof.""",
        "tools": [
            "create_task",
            "list_tasks",
            "get_task",
            "search_tasks",
            "update_task",
            "delete_task",
            "search_knowledge",
            "answer_question",
        ],
    },
}


def execute_agent(
    agent_id: str,
    query: str,
    user_id: str = "",
    workspace_id: str = "",
    role: str = "member",
    raw_token: str = "",
    conversation_id: str | None = None,
) -> dict:
    """
    Execute an agent with a user query using LangGraph dynamic tool-calling.

    Args:
        agent_id:   One of "knowledge", "engineering", "task"
        query:      The user's question or instruction
        user_id:    Authenticated user ID (for workspace-scoped operations)
        workspace_id: User workspace ID
        role:       User RBAC role ('admin', 'member', 'viewer')
        raw_token:  Raw Bearer JWT — forwarded to Node backend for GitHub/Task operations.
                    NEVER stored or logged.
        conversation_id: Optional conversation ID for task association

    Returns structured response with agent name, steps, tool_calls, citations, and final answer.
    """
    agent_config = AGENTS.get(agent_id)
    if not agent_config:
        return {
            "error": f"Unknown agent: '{agent_id}'. Available agents: {list(AGENTS.keys())}",
            "agent_id": agent_id,
        }

    try:
        from app.services.langgraph_agent import run_langgraph_agent

        result = run_langgraph_agent(
            agent_id=agent_id,
            query=query,
            user_id=user_id,
            workspace_id=workspace_id or user_id,
            role=role,
            raw_token=raw_token,
            conversation_id=conversation_id,
        )

        # Attach backward-compatible knowledge_results from search tool call if present
        knowledge_results = []
        for tc in result.get("tool_calls", []):
            if tc.get("tool") == "search_knowledge":
                knowledge_results.append(tc.get("result_summary", ""))
        result["knowledge_results"] = knowledge_results
        result["github_error"] = None
        return result

    except Exception as exc:
        logger.error("LangGraph execution failed (%s), handling error safely", exc)
        steps = [
            f"🔍 Processing request with {agent_config['name']}",
            f"⚠️ LangGraph orchestrator error: {exc}",
        ]
        # Never fabricate task updates or creations when the orchestrator fails
        if agent_id == "task" or any(w in query.lower() for w in ("create task", "update task", "delete task", "set task", "mark task", "change task")):
            steps.append("❌ Task operation failed due to an execution error.")
            return {
                "agent_id": agent_id,
                "agent_name": agent_config["name"],
                "query": query,
                "steps": steps,
                "answer": f"❌ **Task Operation Failed**: An error occurred while executing the Task Agent ({exc}). To prevent data inconsistency, no database updates were applied. Please try again.",
                "tool_calls": [],
                "task_created": None,
                "citations": [],
                "confidence": 0.0,
                "knowledge_results": [],
                "github_error": None,
                "status": "error",
            }

        steps.append("⚙️ Falling back to direct model answer...")
        fallback_answer = get_llm_response(
            agent_config["system_prompt"],
            f"User Query: {query}\n\nPlease provide a helpful, direct response.",
            max_tokens=768,
        )
        steps.append("✓ Direct response generated.")
        return {
            "agent_id": agent_id,
            "agent_name": agent_config["name"],
            "query": query,
            "steps": steps,
            "answer": fallback_answer,
            "tool_calls": [],
            "task_created": None,
            "citations": [],
            "confidence": 0.70,
            "knowledge_results": [],
            "github_error": None,
            "status": "success",
        }


def list_agents() -> list[dict]:
    """Return metadata for all available agents."""
    return [
        {
            "id": agent_id,
            "name": config["name"],
            "description": config["description"],
            "tools": config["tools"],
        }
        for agent_id, config in AGENTS.items()
    ]
