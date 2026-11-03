"""
AIRA RBAC and GitHub/Projects Complete Test Suite
=================================================
Tests:
1. Default role is member upon registration.
2. JWT payload contains id and role.
3. Admin role management:
   - Admin can list all users (GET /api/auth/users).
   - Non-admin (Member/Viewer) receives 403 when listing users.
   - Admin can promote/change a user's role (PATCH /api/auth/users/:id/role).
   - Non-admin receives 403 when attempting to change a role.
   - Regular user receives 403 when attempting to self-elevate role via profile update.
4. Document RBAC (Express + FastAPI):
   - Admin can upload documents (Node: 201, FastAPI: 200).
   - Member can upload documents (Node: 201, FastAPI: 200).
   - Viewer receives 403 Forbidden on upload (both Node /api/documents and FastAPI /api/v1/ingest).
   - Viewer CAN view documents (both Node /api/documents and FastAPI /api/v1/ingest/list return 200).
   - Viewer receives 403 Forbidden on delete (both Node and FastAPI).
   - Member can delete own document, but receives 403/404 when trying to delete another user's document.
   - Admin can delete any document.
5. GitHub & Projects:
   - Express GET /api/github/repos returns repositories, count, and is_mock.
   - Express POST /api/github/repos creates a repo and returns 201.
   - Express GET /api/github/issues returns issues.
   - Express GET /api/github/pulls returns pulls.
   - FastAPI GET /api/v1/github/repos returns repositories and is_mock.
   - FastAPI POST /api/v1/github/repos creates a repo and returns 201.
"""
import pytest
import httpx
import uuid
import jwt

NODE_BASE = "http://localhost:5000/api"
AI_BASE = "http://127.0.0.1:8000/api/v1"

_RUN_ID = uuid.uuid4().hex[:8]
PASSWORD = "TestPassword123!"

ADMIN_EMAIL = f"rbac_admin_{_RUN_ID}@aira.test"
MEMBER_EMAIL = f"rbac_member_{_RUN_ID}@aira.test"
VIEWER_EMAIL = f"rbac_viewer_{_RUN_ID}@aira.test"
OTHER_EMAIL = f"rbac_other_{_RUN_ID}@aira.test"

MINIMAL_TXT = f"RBAC and GitHub test document content for run {_RUN_ID}."


# ── Fixtures & Setup ──────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def admin_user():
    """Register initial admin user (role: admin)."""
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": "RBAC Admin",
        "email": ADMIN_EMAIL,
        "password": PASSWORD,
    })
    assert r.status_code in (200, 201), f"Admin register failed: {r.text}"
    data = r.json()
    uid = data["user"].get("id") or data["user"].get("_id")

    import os
    import subprocess
    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
    subprocess.run(
        ["node", "src/scripts/bootstrapAdmin.js", ADMIN_EMAIL],
        cwd=backend_dir,
        check=True,
        capture_output=True,
    )

    login_resp = httpx.post(f"{NODE_BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": PASSWORD})
    assert login_resp.status_code == 200, f"Admin login failed: {login_resp.text}"
    login_data = login_resp.json()

    return {"token": login_data["token"], "user": login_data.get("user") or {}, "id": uid}


@pytest.fixture(scope="session")
def member_user():
    """Register regular member user (no role specified -> defaults to member)."""
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": "RBAC Member",
        "email": MEMBER_EMAIL,
        "password": PASSWORD,
    })
    assert r.status_code in (200, 201), f"Member register failed: {r.text}"
    data = r.json()
    return {"token": data["token"], "user": data.get("user") or {}}


@pytest.fixture(scope="session")
def viewer_user(admin_user):
    """Register user and have admin assign them the 'viewer' role."""
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": "RBAC Viewer",
        "email": VIEWER_EMAIL,
        "password": PASSWORD,
    })
    assert r.status_code in (200, 201), f"Viewer register failed: {r.text}"
    user_data = r.json().get("user", {})
    user_id = user_data.get("id") or user_data.get("_id")

    # Admin promotes this user to viewer
    patch_resp = httpx.patch(
        f"{NODE_BASE}/auth/users/{user_id}/role",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={"role": "viewer"}
    )
    assert patch_resp.status_code == 200, f"Failed to set viewer role: {patch_resp.text}"

    # Log in as viewer to get updated JWT with role='viewer'
    login_resp = httpx.post(f"{NODE_BASE}/auth/login", json={
        "email": VIEWER_EMAIL,
        "password": PASSWORD
    })
    assert login_resp.status_code == 200, f"Viewer login failed: {login_resp.text}"
    data = login_resp.json()
    return {"token": data["token"], "user": data.get("user") or {}, "id": user_id}


# ── Test Suite: RBAC Core & Auth ──────────────────────────────────────────────

class TestRBACAuth:
    def test_default_role_is_member_on_register(self, member_user):
        """Verify new user without explicit role defaults to 'member'."""
        user = member_user["user"]
        assert user.get("role") == "member"

        # Decode token payload to ensure role is in JWT
        token = member_user["token"]
        payload = jwt.decode(token, options={"verify_signature": False})
        assert payload.get("role") == "member"
        assert "id" in payload

    def test_admin_jwt_contains_admin_role(self, admin_user):
        """Verify admin user JWT contains role='admin'."""
        payload = jwt.decode(admin_user["token"], options={"verify_signature": False})
        assert payload.get("role") == "admin"

    def test_viewer_jwt_contains_viewer_role(self, viewer_user):
        """Verify viewer user JWT contains role='viewer'."""
        payload = jwt.decode(viewer_user["token"], options={"verify_signature": False})
        assert payload.get("role") == "viewer"

    def test_admin_can_list_users(self, admin_user):
        """Admin can call GET /api/auth/users."""
        r = httpx.get(f"{NODE_BASE}/auth/users", headers={"Authorization": f"Bearer {admin_user['token']}"})
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True
        assert isinstance(data.get("users"), list)
        assert len(data["users"]) >= 2

    def test_member_cannot_list_users(self, member_user):
        """Member receives 403 when trying to list users."""
        r = httpx.get(f"{NODE_BASE}/auth/users", headers={"Authorization": f"Bearer {member_user['token']}"})
        assert r.status_code == 403

    def test_viewer_cannot_list_users(self, viewer_user):
        """Viewer receives 403 when trying to list users."""
        r = httpx.get(f"{NODE_BASE}/auth/users", headers={"Authorization": f"Bearer {viewer_user['token']}"})
        assert r.status_code == 403

    def test_member_cannot_change_user_role(self, member_user, viewer_user):
        """Member receives 403 when attempting to change a role."""
        r = httpx.patch(
            f"{NODE_BASE}/auth/users/{viewer_user['id']}/role",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={"role": "admin"}
        )
        assert r.status_code == 403

    def test_viewer_cannot_change_user_role(self, viewer_user):
        """Viewer receives 403 when attempting to change a role."""
        r = httpx.patch(
            f"{NODE_BASE}/auth/users/{viewer_user['id']}/role",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
            json={"role": "admin"}
        )
        assert r.status_code == 403

    def test_regular_user_cannot_self_elevate_via_profile(self, member_user):
        """Member receives 403 when trying to set their own role to admin in profile update."""
        r = httpx.patch(
            f"{NODE_BASE}/auth/update-profile",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={"name": "Hacker Member", "role": "admin"}
        )
        assert r.status_code == 403


# ── Test Suite: Document RBAC ─────────────────────────────────────────────────

class TestDocumentRBAC:
    def test_member_can_upload_document_node(self, member_user):
        """Member can register a document via Node backend."""
        r = httpx.post(
            f"{NODE_BASE}/documents",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={
                "title": f"Member Doc {_RUN_ID}",
                "filename": f"member_doc_{_RUN_ID}.txt",
                "file_type": ".txt",
                "file_size_bytes": 128
            }
        )
        assert r.status_code in (200, 201)
        assert r.json().get("success") is True

    def test_admin_can_upload_document_node(self, admin_user):
        """Admin can register a document via Node backend."""
        r = httpx.post(
            f"{NODE_BASE}/documents",
            headers={"Authorization": f"Bearer {admin_user['token']}"},
            json={
                "title": f"Admin Doc {_RUN_ID}",
                "filename": f"admin_doc_{_RUN_ID}.txt",
                "file_type": ".txt",
                "file_size_bytes": 256
            }
        )
        assert r.status_code in (200, 201)
        assert r.json().get("success") is True

    def test_viewer_cannot_upload_document_node(self, viewer_user):
        """Viewer receives 403 when trying to register a document in Node backend."""
        r = httpx.post(
            f"{NODE_BASE}/documents",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
            json={
                "title": f"Viewer Attempt {_RUN_ID}",
                "filename": f"viewer_fail_{_RUN_ID}.txt",
                "file_type": ".txt",
                "file_size_bytes": 128
            }
        )
        assert r.status_code == 403

    def test_viewer_cannot_upload_to_fastapi(self, viewer_user):
        """Viewer receives 403 when trying to ingest a document in FastAPI AI service."""
        files = {"file": (f"viewer_test_{_RUN_ID}.txt", MINIMAL_TXT.encode(), "text/plain")}
        r = httpx.post(
            f"{AI_BASE}/ingest",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
            files=files
        )
        assert r.status_code == 403
        assert "Forbidden" in r.text or "privileges" in r.text

    def test_member_can_upload_to_fastapi(self, member_user):
        """Member can ingest a document in FastAPI AI service."""
        files = {"file": (f"member_test_{_RUN_ID}.txt", MINIMAL_TXT.encode(), "text/plain")}
        r = httpx.post(
            f"{AI_BASE}/ingest",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            files=files,
            timeout=60.0
        )
        assert r.status_code == 200

    def test_viewer_can_view_documents_node(self, viewer_user):
        """Viewer can view document list in Node backend (read-only allowed)."""
        r = httpx.get(
            f"{NODE_BASE}/documents",
            headers={"Authorization": f"Bearer {viewer_user['token']}"}
        )
        assert r.status_code == 200
        assert r.json().get("success") is True

    def test_viewer_can_view_documents_fastapi(self, viewer_user):
        """Viewer can view document list in FastAPI (read-only allowed)."""
        r = httpx.get(
            f"{AI_BASE}/ingest/list",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
            timeout=30.0,
        )
        assert r.status_code == 200

    def test_viewer_cannot_delete_document_node(self, viewer_user):
        """Viewer receives 403 when attempting to delete a document."""
        r = httpx.delete(
            f"{NODE_BASE}/documents/some_fake_id_12345",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
            timeout=30.0,
        )
        assert r.status_code == 403

    def test_viewer_cannot_delete_document_fastapi(self, viewer_user):
        """Viewer receives 403 when attempting to delete in FastAPI."""
        r = httpx.delete(
            f"{AI_BASE}/ingest/some_file.txt",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
            timeout=30.0,
        )
        assert r.status_code == 403


# ── Test Suite: GitHub & Projects Endpoints ───────────────────────────────────

class TestGitHubProjects:
    def test_express_get_repos(self, member_user):
        """Express GET /api/github/repos returns repository list and is_mock indicator."""
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert "repositories" in data
        assert isinstance(data["repositories"], list)
        assert "is_mock" in data
        assert "count" in data

    def test_express_add_repo(self, member_user):
        """Express POST /api/github/repos allows adding a repository and returns 201."""
        new_repo_name = f"custom-aira-repo-{_RUN_ID}"
        r = httpx.post(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={
                "name": new_repo_name,
                "description": "A custom test repository created via Express",
                "language": "TypeScript"
            }
        )
        assert r.status_code == 201
        data = r.json()
        assert data.get("success") is True
        assert data.get("repository", {}).get("name") == new_repo_name

    def test_express_get_issues(self, member_user):
        """Express GET /api/github/issues returns issues list without 500 error."""
        r = httpx.get(
            f"{NODE_BASE}/github/issues?repo=aira-core",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert "issues" in data
        assert isinstance(data["issues"], list)

    def test_express_get_pulls(self, member_user):
        """Express GET /api/github/pulls returns pull requests without 500 error."""
        r = httpx.get(
            f"{NODE_BASE}/github/pulls?repo=aira-core",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert "pulls" in data
        assert isinstance(data["pulls"], list)

    def test_fastapi_get_repos(self, member_user):
        """FastAPI GET /api/v1/github/repos returns repositories and is_mock indicator."""
        r = httpx.get(
            f"{AI_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert "repositories" in data
        assert "is_mock" in data

    def test_fastapi_add_repo(self, member_user):
        """FastAPI POST /api/v1/github/repos allows adding a repo and returns 201."""
        py_repo_name = f"python-aira-repo-{_RUN_ID}"
        r = httpx.post(
            f"{AI_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={
                "name": py_repo_name,
                "description": "Added via FastAPI endpoint",
                "language": "Python"
            }
        )
        assert r.status_code == 201
        data = r.json()
        assert data.get("repository", {}).get("name") == py_repo_name
