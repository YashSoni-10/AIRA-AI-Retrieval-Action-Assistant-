"""
Phase B — Task Persistence Tests
==================================
Tests for:
  B1. Task MongoDB model (via API)
  B2. Task CRUD endpoints
  B3. Task RBAC (admin/member/viewer)
  B4. Workspace isolation
  B5. Agent task creation (real MongoDB ID)

Run with:
    cd Ai-Service
    .\\venv\\Scripts\\python.exe -m pytest tests/test_phase_b_tasks.py -v --tb=short

Requirements:
    - Node backend running on :5000
    - MongoDB connected
"""
import pytest
import httpx
import uuid

NODE_BASE = "http://localhost:5000/api"

_RUN = uuid.uuid4().hex[:8]
ADMIN_EMAIL = f"task_admin_{_RUN}@aira.test"
MEMBER_EMAIL = f"task_member_{_RUN}@aira.test"
VIEWER_EMAIL = f"task_viewer_{_RUN}@aira.test"
OTHER_EMAIL = f"task_other_{_RUN}@aira.test"
PASSWORD = "TaskTest123!"


# ── Fixtures ──────────────────────────────────────────────────────────────────

import subprocess
import os

def _set_user_role(email: str, role: str):
    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
    script = (
        "require('dotenv').config(); "
        "const mongoose = require('mongoose'); "
        "const User = require('./src/models/User'); "
        "mongoose.connect(process.env.MONGO_URI).then(async () => { "
        f"await User.updateOne({{ email: '{email}' }}, {{ role: '{role}' }}); "
        "process.exit(0); "
        "});"
    )
    subprocess.run(["node", "-e", script], cwd=backend_dir, check=True)

def _login(email: str):
    r = httpx.post(f"{NODE_BASE}/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, f"Login failed for {email}: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    """Register a user and promote to admin via MongoDB, return JWT."""
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": f"Task Admin {_RUN}", "email": ADMIN_EMAIL, "password": PASSWORD,
    })
    assert r.status_code in (200, 201), f"Register failed: {r.text}"
    user_id = r.json()["user"]["_id"]
    _set_user_role(ADMIN_EMAIL, "admin")
    token = _login(ADMIN_EMAIL)
    return token, user_id


@pytest.fixture(scope="module")
def member_token():
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": f"Task Member {_RUN}", "email": MEMBER_EMAIL, "password": PASSWORD,
    })
    assert r.status_code in (200, 201)
    data = r.json()
    return data["token"], data["user"]["_id"]


@pytest.fixture(scope="module")
def viewer_token():
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": f"Task Viewer {_RUN}", "email": VIEWER_EMAIL, "password": PASSWORD,
    })
    assert r.status_code in (200, 201)
    _set_user_role(VIEWER_EMAIL, "viewer")
    token = _login(VIEWER_EMAIL)
    return token


@pytest.fixture(scope="module")
def other_token():
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": f"Task Other {_RUN}", "email": OTHER_EMAIL, "password": PASSWORD,
    })
    assert r.status_code in (200, 201)
    return r.json()["token"]


# ── B1/B2: Task CRUD ──────────────────────────────────────────────────────────

class TestTaskCRUD:
    """Verify basic CRUD operations on tasks."""

    _created_task_id = None

    def test_create_task_as_member(self, member_token):
        """Member can create a task — returns 201 with real MongoDB _id."""
        token, _ = member_token
        r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Test Task Alpha", "description": "Phase B test.", "priority": "high"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 201, f"Create task failed: {r.text}"
        data = r.json()
        assert data["success"] is True
        task = data["task"]
        # Must have a real MongoDB _id (24-char hex), not AIRA-XXXX
        assert len(task["_id"]) == 24, f"Expected real MongoDB ID, got: {task['_id']}"
        assert task["title"] == "Test Task Alpha"
        assert task["status"] == "todo"
        assert task["priority"] == "high"
        TestTaskCRUD._created_task_id = task["_id"]

    def test_list_tasks_requires_auth(self):
        """GET /api/tasks without token returns 401."""
        r = httpx.get(f"{NODE_BASE}/tasks")
        assert r.status_code == 401

    def test_list_tasks_as_member(self, member_token):
        """Member can list their tasks."""
        token, _ = member_token
        r = httpx.get(
            f"{NODE_BASE}/tasks",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is True
        assert isinstance(data["tasks"], list)
        assert data["count"] >= 1

    def test_get_task_by_id(self, member_token):
        """GET /api/tasks/:id returns the task."""
        token, _ = member_token
        task_id = TestTaskCRUD._created_task_id
        assert task_id, "Task ID not set — create test must pass first"
        r = httpx.get(
            f"{NODE_BASE}/tasks/{task_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json()["task"]["_id"] == task_id

    def test_get_task_invalid_id(self, member_token):
        """Invalid task ID returns 400."""
        token, _ = member_token
        r = httpx.get(
            f"{NODE_BASE}/tasks/not-an-id",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400

    def test_get_task_nonexistent_id(self, member_token):
        """Non-existent task returns 404."""
        token, _ = member_token
        r = httpx.get(
            f"{NODE_BASE}/tasks/000000000000000000000001",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 404

    def test_update_own_task(self, member_token):
        """Member can update their own task."""
        token, _ = member_token
        task_id = TestTaskCRUD._created_task_id
        r = httpx.patch(
            f"{NODE_BASE}/tasks/{task_id}",
            json={"status": "in_progress", "description": "Updated description."},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        task = r.json()["task"]
        assert task["status"] == "in_progress"
        assert task["description"] == "Updated description."

    def test_update_invalid_status(self, member_token):
        """Updating with invalid status returns 400."""
        token, _ = member_token
        task_id = TestTaskCRUD._created_task_id
        r = httpx.patch(
            f"{NODE_BASE}/tasks/{task_id}",
            json={"status": "flying"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400

    def test_complete_task(self, member_token):
        """Member can mark their own task as completed."""
        token, _ = member_token
        task_id = TestTaskCRUD._created_task_id
        r = httpx.patch(
            f"{NODE_BASE}/tasks/{task_id}",
            json={"status": "completed"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json()["task"]["status"] == "completed"

    def test_delete_own_task(self, member_token):
        """Member can delete their own task."""
        token, _ = member_token
        # Create a fresh task to delete
        create_r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Task to delete"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert create_r.status_code == 201
        del_id = create_r.json()["task"]["_id"]

        r = httpx.delete(
            f"{NODE_BASE}/tasks/{del_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json()["success"] is True

        # Verify it's gone
        check = httpx.get(
            f"{NODE_BASE}/tasks/{del_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert check.status_code == 404


# ── B3: RBAC ──────────────────────────────────────────────────────────────────

class TestTaskRBAC:
    """Verify role-based access control for tasks."""

    def test_create_task_requires_auth(self):
        """POST /api/tasks without token returns 401."""
        r = httpx.post(f"{NODE_BASE}/tasks", json={"title": "Unauth Task"})
        assert r.status_code == 401

    def test_viewer_cannot_create_task(self, viewer_token):
        """Viewer role cannot create tasks — returns 403."""
        r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Viewer Task Attempt"},
            headers={"Authorization": f"Bearer {viewer_token}"},
        )
        # Viewer returns 403 Forbidden
        assert r.status_code == 403, f"Expected 403 for viewer create, got {r.status_code}: {r.text}"

    def test_viewer_can_list_tasks(self, viewer_token, member_token):
        """Viewer can read tasks (read-only)."""
        # First create a task as member
        m_token, _ = member_token
        httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Visible to viewer"},
            headers={"Authorization": f"Bearer {m_token}"},
        )

        r = httpx.get(
            f"{NODE_BASE}/tasks",
            headers={"Authorization": f"Bearer {viewer_token}"},
        )
        # Viewer gets 200 (read-only is allowed)
        assert r.status_code == 200

    def test_viewer_cannot_update_task(self, viewer_token, member_token):
        """Viewer cannot update tasks — returns 403."""
        # Create a task as member
        m_token, _ = member_token
        create_r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Task for viewer update attempt"},
            headers={"Authorization": f"Bearer {m_token}"},
        )
        assert create_r.status_code == 201
        task_id = create_r.json()["task"]["_id"]

        r = httpx.patch(
            f"{NODE_BASE}/tasks/{task_id}",
            json={"status": "completed"},
            headers={"Authorization": f"Bearer {viewer_token}"},
        )
        assert r.status_code == 403

    def test_viewer_cannot_delete_task(self, viewer_token, member_token):
        """Viewer cannot delete tasks — returns 403."""
        m_token, _ = member_token
        create_r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Task for viewer delete attempt"},
            headers={"Authorization": f"Bearer {m_token}"},
        )
        assert create_r.status_code == 201
        task_id = create_r.json()["task"]["_id"]

        r = httpx.delete(
            f"{NODE_BASE}/tasks/{task_id}",
            headers={"Authorization": f"Bearer {viewer_token}"},
        )
        assert r.status_code == 403


# ── B4: Workspace Isolation ───────────────────────────────────────────────────

class TestTaskWorkspaceIsolation:
    """Tasks must be isolated between different users' workspaces."""

    def test_other_user_cannot_see_tasks(self, member_token, other_token):
        """Tasks created by member are not visible to other user."""
        m_token, _ = member_token
        create_r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": f"Secret Task {_RUN}"},
            headers={"Authorization": f"Bearer {m_token}"},
        )
        assert create_r.status_code == 201
        task_id = create_r.json()["task"]["_id"]

        # Other user cannot GET this specific task (different workspace)
        r = httpx.get(
            f"{NODE_BASE}/tasks/{task_id}",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert r.status_code == 404, (
            f"Expected 404 for cross-workspace task access, got {r.status_code}: {r.text}"
        )

    def test_other_user_cannot_update_task(self, member_token, other_token):
        """Other user cannot update member's task."""
        m_token, _ = member_token
        create_r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Protected Task"},
            headers={"Authorization": f"Bearer {m_token}"},
        )
        assert create_r.status_code == 201
        task_id = create_r.json()["task"]["_id"]

        r = httpx.patch(
            f"{NODE_BASE}/tasks/{task_id}",
            json={"status": "completed"},
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert r.status_code in (403, 404), (
            f"Expected 403/404 for cross-workspace update, got {r.status_code}"
        )

    def test_other_user_cannot_delete_task(self, member_token, other_token):
        """Other user cannot delete member's task."""
        m_token, _ = member_token
        create_r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Task other cannot delete"},
            headers={"Authorization": f"Bearer {m_token}"},
        )
        assert create_r.status_code == 201
        task_id = create_r.json()["task"]["_id"]

        r = httpx.delete(
            f"{NODE_BASE}/tasks/{task_id}",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert r.status_code in (403, 404)


# ── B5: Input Validation ──────────────────────────────────────────────────────

class TestTaskInputValidation:
    """Verify input sanitization rejects invalid values."""

    def test_create_task_empty_title(self, member_token):
        """Empty title returns 400."""
        token, _ = member_token
        r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "   "},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400

    def test_create_task_missing_title(self, member_token):
        """Missing title returns 400."""
        token, _ = member_token
        r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"description": "No title"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400

    def test_create_task_invalid_priority(self, member_token):
        """Invalid priority returns 400."""
        token, _ = member_token
        r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Bad Priority", "priority": "urgent"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400

    def test_create_task_invalid_due_date(self, member_token):
        """Invalid due_date returns 400."""
        token, _ = member_token
        r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Bad Date", "due_date": "not-a-date"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400

    def test_create_task_no_response_contains_token(self, member_token):
        """Task response must not contain any token/secret fields."""
        token, _ = member_token
        r = httpx.post(
            f"{NODE_BASE}/tasks",
            json={"title": "Security check task"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 201
        body = r.text.lower()
        for forbidden in ("jwt_secret", "github_token", "access_token", "refresh_token", "groq_api_key"):
            assert forbidden not in body, f"Response contains forbidden field: {forbidden}"
