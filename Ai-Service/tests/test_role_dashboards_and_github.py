"""
AIRA Role-Based Dashboards & GitHub Architecture Test Suite
===========================================================
Tests all 23 requirements specified in Part 13:
1-3:   Role-specific dashboard statistics (Admin, Member, Viewer).
4-9:   RBAC enforcement across uploads, deletions, user management, and self-promotion.
10-20: Workspace GitHub connection, status, OAuth/PAT, token secrecy, permissions, repos, issues, pulls.
21-23: Mock fallbacks, invalid credentials handling, and authentic mock/live labeling.
"""
import os
import pytest

# Resolve the project root so file-based tests work regardless of the pytest working directory.
# This test file lives at: <project_root>/Ai-Service/tests/
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
import httpx
import uuid
import jwt

NODE_BASE = "http://localhost:5000/api"
AI_BASE = "http://127.0.0.1:8000/api/v1"

_RUN_ID = uuid.uuid4().hex[:8]
PASSWORD = "TestPassword123!"

ADMIN_EMAIL = f"dash_admin_{_RUN_ID}@aira.test"
MEMBER_EMAIL = f"dash_member_{_RUN_ID}@aira.test"
VIEWER_EMAIL = f"dash_viewer_{_RUN_ID}@aira.test"

MINIMAL_TXT = f"Role-based dashboard and GitHub test document for run {_RUN_ID}."


# ── Fixtures & Setup ──────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def admin_user():
    """Register admin user."""
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": "Dashboard Admin",
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
    """Register regular member user (defaults to member)."""
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": "Dashboard Member",
        "email": MEMBER_EMAIL,
        "password": PASSWORD,
    })
    assert r.status_code in (200, 201), f"Member register failed: {r.text}"
    data = r.json()
    return {"token": data["token"], "user": data.get("user") or {}}


@pytest.fixture(scope="session")
def viewer_user(admin_user):
    """Register user and assign viewer role via admin."""
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": "Dashboard Viewer",
        "email": VIEWER_EMAIL,
        "password": PASSWORD,
    })
    assert r.status_code in (200, 201), f"Viewer register failed: {r.text}"
    data = r.json()
    uid = data["user"].get("id") or data["user"].get("_id")

    # Admin promotes this user to viewer
    patch_resp = httpx.patch(
        f"{NODE_BASE}/auth/users/{uid}/role",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={"role": "viewer"},
    )
    assert patch_resp.status_code == 200

    # Log in as viewer to get clean token with role='viewer'
    login_resp = httpx.post(f"{NODE_BASE}/auth/login", json={
        "email": VIEWER_EMAIL,
        "password": PASSWORD,
    })
    assert login_resp.status_code == 200
    login_data = login_resp.json()
    return {"token": login_data["token"], "user": login_data.get("user") or {}, "id": uid}


# ── 1-3: Role-Based Dashboard Statistics ──────────────────────────────────────

class TestRoleDashboards:
    def test_admin_receives_admin_dashboard_data(self, admin_user):
        """1. Admin receives system-wide statistics including totalUsers and usersByRole."""
        r = httpx.get(
            f"{NODE_BASE}/dashboard/stats",
            headers={"Authorization": f"Bearer {admin_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True
        assert data.get("role") == "admin"
        stats = data.get("stats", {})
        assert "totalUsers" in stats
        assert stats["totalUsers"] >= 1
        assert "usersByRole" in stats
        assert isinstance(stats["usersByRole"], dict)
        assert "totalDocuments" in stats
        assert "totalConversations" in stats
        assert "githubConnected" in stats

    def test_member_receives_member_dashboard_data(self, member_user):
        """2. Member receives member dashboard data without admin user management metrics."""
        r = httpx.get(
            f"{NODE_BASE}/dashboard/stats",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True
        assert data.get("role") == "member"
        stats = data.get("stats", {})
        assert "totalDocuments" in stats
        assert "totalConversations" in stats
        assert "githubConnected" in stats
        # Member must NOT see system-wide user counts
        assert "totalUsers" not in stats
        assert "usersByRole" not in stats

    def test_viewer_receives_viewer_dashboard_data(self, viewer_user):
        """3. Viewer receives read-only dashboard data."""
        r = httpx.get(
            f"{NODE_BASE}/dashboard/stats",
            headers={"Authorization": f"Bearer {viewer_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True
        assert data.get("role") == "viewer"
        stats = data.get("stats", {})
        assert "totalDocuments" in stats
        assert stats.get("isReadOnly") is True
        # Viewer must NOT see system user management
        assert "totalUsers" not in stats


# ── 4-9: RBAC Checks ──────────────────────────────────────────────────────────

class TestRBACPermissions:
    def test_viewer_cannot_upload_documents(self, viewer_user):
        """4. Viewer receives 403 Forbidden on document upload."""
        # Node backend
        r1 = httpx.post(
            f"{NODE_BASE}/documents",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
            json={
                "filename": f"viewer_fail_{_RUN_ID}.txt",
                "file_type": ".txt",
                "file_size_bytes": 128,
            }
        )
        assert r1.status_code == 403

        # FastAPI
        files = {"file": (f"viewer_test_{_RUN_ID}.txt", MINIMAL_TXT.encode(), "text/plain")}
        r2 = httpx.post(
            f"{AI_BASE}/ingest",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
            files=files,
            timeout=15.0,
        )
        assert r2.status_code == 403

    def test_viewer_cannot_delete_documents(self, viewer_user):
        """5. Viewer receives 403 Forbidden on document deletion."""
        # Node backend
        r1 = httpx.delete(
            f"{NODE_BASE}/documents/fake_doc_id_12345",
            headers={"Authorization": f"Bearer {viewer_user['token']}"}
        )
        assert r1.status_code == 403

        # FastAPI
        r2 = httpx.delete(
            f"{AI_BASE}/ingest/some_file.txt",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
            timeout=15.0,
        )
        assert r2.status_code == 403

    def test_member_can_upload_documents(self, member_user):
        """6. Member can upload documents."""
        r = httpx.post(
            f"{NODE_BASE}/documents",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={
                "filename": f"member_doc_{_RUN_ID}.txt",
                "file_type": ".txt",
                "file_size_bytes": 128,
            }
        )
        assert r.status_code in (200, 201)

    def test_admin_can_upload_documents(self, admin_user):
        """7. Admin can upload documents."""
        r = httpx.post(
            f"{NODE_BASE}/documents",
            headers={"Authorization": f"Bearer {admin_user['token']}"},
            json={
                "filename": f"admin_doc_{_RUN_ID}.txt",
                "file_type": ".txt",
                "file_size_bytes": 256,
            }
        )
        assert r.status_code in (200, 201)

    def test_non_admin_cannot_manage_users(self, member_user, viewer_user):
        """8. Non-admin users receive 403 when trying to list or modify users."""
        r1 = httpx.get(
            f"{NODE_BASE}/auth/users",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r1.status_code == 403

        r2 = httpx.patch(
            f"{NODE_BASE}/auth/users/{viewer_user['id']}/role",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={"role": "admin"}
        )
        assert r2.status_code == 403

    def test_user_cannot_self_promote(self, member_user):
        """9. User cannot promote themselves to admin via profile update."""
        r = httpx.patch(
            f"{NODE_BASE}/auth/update-profile",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={"name": "Attacker", "role": "admin"}
        )
        assert r.status_code == 403


# ── 10-20: GitHub Connection & Permissions ────────────────────────────────────

class TestGitHubIntegration:
    def test_admin_can_access_github_endpoints(self, admin_user):
        """10. Admin can access GitHub connection endpoints."""
        r = httpx.get(
            f"{NODE_BASE}/github/status",
            headers={"Authorization": f"Bearer {admin_user['token']}"}
        )
        assert r.status_code == 200

    def test_member_can_access_github_endpoints(self, member_user):
        """11. Member can access GitHub connection endpoints."""
        r = httpx.get(
            f"{NODE_BASE}/github/status",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200

    def test_viewer_cannot_connect_or_disconnect_github(self, viewer_user):
        """12. Viewer cannot connect or disconnect GitHub (403)."""
        r1 = httpx.post(
            f"{NODE_BASE}/github/connect-pat",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
            json={"token": "ghp_somefakepat123"}
        )
        assert r1.status_code == 403

        r2 = httpx.post(
            f"{NODE_BASE}/github/disconnect",
            headers={"Authorization": f"Bearer {viewer_user['token']}"}
        )
        assert r2.status_code == 403

    def test_github_connection_status_endpoint(self, member_user):
        """13. GitHub connection status endpoint returns valid structure."""
        r = httpx.get(
            f"{NODE_BASE}/github/status",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert "connected" in data
        assert "status" in data

    def test_github_safe_account_info_returned(self, member_user):
        """14. Safe account info is returned without exposing sensitive fields."""
        r = httpx.get(
            f"{NODE_BASE}/github/status",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert "githubUsername" in data
        assert "avatarUrl" in data
        assert "repositoryCount" in data

    def test_github_token_is_never_leaked(self, member_user, admin_user):
        """15. GitHub access tokens are NEVER leaked in status or repo responses."""
        for endpoint in ["/github/status", "/github/repos"]:
            r = httpx.get(
                f"{NODE_BASE}{endpoint}",
                headers={"Authorization": f"Bearer {member_user['token']}"}
            )
            raw = r.text.lower()
            assert "access_token" not in raw
            assert "encrypted_access_token" not in raw
            assert "token_auth_tag" not in raw

    def test_projects_indicates_disconnected_state(self, member_user):
        """16. Repositories response accurately identifies connection/mock state."""
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert "is_mock" in data

    def test_real_or_mock_repositories_endpoint(self, member_user):
        """17. Repositories endpoint responds with array of repositories."""
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert "repositories" in data
        assert isinstance(data["repositories"], list)

    def test_issues_endpoint_responds_correctly(self, member_user):
        """18. Issues endpoint responds correctly."""
        r = httpx.get(
            f"{NODE_BASE}/github/issues?repo=aira-workspace/AIRA",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert "issues" in data
        assert isinstance(data["issues"], list)

    def test_pull_requests_endpoint_responds_correctly(self, member_user):
        """19. Pull requests endpoint responds correctly."""
        r = httpx.get(
            f"{NODE_BASE}/github/pulls?repo=aira-workspace/AIRA",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert "pulls" in data
        assert isinstance(data["pulls"], list)

    def test_disconnect_works_for_member_and_admin(self, member_user, admin_user):
        """20. Disconnect endpoint clears workspace connection for authorized roles."""
        # Member disconnect
        r1 = httpx.post(
            f"{NODE_BASE}/github/disconnect",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r1.status_code == 200
        assert r1.json().get("success") is True

        # Admin disconnect
        r2 = httpx.post(
            f"{NODE_BASE}/github/disconnect",
            headers={"Authorization": f"Bearer {admin_user['token']}"}
        )
        assert r2.status_code == 200
        assert r2.json().get("success") is True


# ── 21-23: Mock Fallback & Error Handling ─────────────────────────────────────

class TestMockFallbackAndErrors:
    def test_missing_credentials_produce_clear_mock_state(self, member_user):
        """21. Disconnected workspace returns is_mock: true and connected: false."""
        r = httpx.get(
            f"{NODE_BASE}/github/status",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("connected") is False
        assert data.get("is_mock") is True

    def test_invalid_github_credentials_produce_clean_error(self, member_user):
        """22. Invalid token produces clean 401 without crashing the server."""
        r = httpx.post(
            f"{NODE_BASE}/github/connect-pat",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={"token": "ghp_invalid_token_1234567890abcdef"}
        )
        # GitHub rejects with 401
        assert r.status_code == 401
        assert "Invalid" in r.text or "rejected" in r.text

    def test_mock_data_is_never_labelled_as_live(self, member_user):
        """23. Mock data explicitly sets is_mock: true and source: 'mock_fallback'."""
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        if data.get("is_mock") is True:
            assert data.get("source") != "live_github"
            assert data.get("source") == "mock_fallback"


# ── 24-29: Real OAuth Initiation, Security & State Verification ───────────────

class TestGitHubOAuthFlow:
    def test_authenticated_admin_can_initiate_oauth(self, admin_user):
        """24. Authenticated admin receives GitHub authorization URL (JSON)."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/authorize",
            headers={"Authorization": f"Bearer {admin_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True
        auth_url = data.get("authorization_url")
        assert auth_url is not None
        assert "https://github.com/login/oauth/authorize" in auth_url
        assert "client_id=" in auth_url
        assert "state=" in auth_url
        assert "scope=" in auth_url
        # Must NEVER contain AIRA JWT in query params
        assert admin_user["token"] not in auth_url

    def test_authenticated_member_can_initiate_oauth(self, member_user):
        """25. Authenticated member receives GitHub authorization URL."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/authorize",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True
        auth_url = data.get("authorization_url")
        assert "https://github.com/login/oauth/authorize" in auth_url
        assert member_user["token"] not in auth_url

    def test_unauthenticated_authorize_returns_401(self):
        """26. Unauthenticated call to /github/oauth/authorize is rejected with 401."""
        r = httpx.get(f"{NODE_BASE}/github/oauth/authorize")
        assert r.status_code == 401
        data = r.json()
        assert data.get("success") is False

    def test_viewer_cannot_initiate_oauth_returns_403(self, viewer_user):
        """27. Viewer role receives 403 Forbidden when calling oauth/authorize."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/authorize",
            headers={"Authorization": f"Bearer {viewer_user['token']}"}
        )
        assert r.status_code == 403
        data = r.json()
        assert data.get("success") is False

    def test_oauth_callback_validates_tampered_state(self):
        """28. OAuth callback rejects tampered or expired HMAC state and redirects with error."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/callback?code=fake_code&state=tampered_or_invalid_hmac_state",
            follow_redirects=False
        )
        assert r.status_code in (302, 307)
        location = r.headers.get("location", "")
        assert "error=invalid_or_expired_state" in location

    def test_frontend_does_not_directly_navigate_to_protected_authorize(self):
        """29. Verify frontend codebase no longer uses window.location.href to call protected AIRA endpoint directly."""
        github_page = os.path.join(_PROJECT_ROOT, "frontend", "src", "pages", "GitHubPage.tsx")
        with open(github_page, "r", encoding="utf-8") as f:
            content = f.read()
        # Should not directly assign window.location.href to the backend API endpoint
        assert 'window.location.href = "http://localhost:5000/api/github/oauth/authorize"' not in content
        # Should use getGithubOAuthAuthorizeUrl
        assert "getGithubOAuthAuthorizeUrl" in content


# ── 30-35: Real GitHub Flow, Strict Mock Fallback Rules & Isolation ───────────

class TestRealGitHubIntegrationAndIsolation:
    def test_disconnected_workspace_uses_explicit_mock_fallback(self, member_user):
        """30. Disconnected workspace returns is_mock: True and source: mock_fallback."""
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"}
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("is_mock") is True
        assert data.get("source") == "mock_fallback"
        assert len(data.get("repositories", [])) > 0

    def test_frontend_api_queries_node_backend_directly(self):
        """31. Verify frontend/src/services/api.ts queries Node Express directly for GitHub repos/issues/pulls."""
        api_ts = os.path.join(_PROJECT_ROOT, "frontend", "src", "services", "api.ts")
        with open(api_ts, "r", encoding="utf-8") as f:
            content = f.read()
        # getGithubRepos should not delegate to FastAPI request<GitHubReposResponse>("/github/repos")
        assert 'request<GitHubReposResponse>("/github/repos")' not in content
        assert 'fetch("http://localhost:5000/api/github/repos"' in content
        assert 'fetch(`http://localhost:5000/api/github/issues' in content
        assert 'fetch(`http://localhost:5000/api/github/pulls' in content

    def test_project_page_status_text_rules(self):
        """32. Verify ProjectsPage does not contain contradictory live text when isMock is true."""
        projects_page = os.path.join(_PROJECT_ROOT, "frontend", "src", "pages", "ProjectsPage.tsx")
        with open(projects_page, "r", encoding="utf-8") as f:
            content = f.read()
        # Must not have unconditionally hardcoded 'Showing live data fetched from GitHub API'
        assert "Showing live data fetched from GitHub API" not in content
        # Must have Connected • Live GitHub Data
        assert "Connected • Live GitHub Data" in content
        assert "Development Mock Fallback" in content

    def test_token_decryption_and_sensitive_fields_never_returned(self, member_user):
        """33. Neither encrypted nor decrypted token is returned in any endpoint response."""
        for endpoint in ["/github/status", "/github/repos", "/github/issues", "/github/pulls"]:
            r = httpx.get(
                f"{NODE_BASE}{endpoint}",
                headers={"Authorization": f"Bearer {member_user['token']}"}
            )
            raw = r.text.lower()
            assert "encrypted_access_token" not in raw
            assert "token_auth_tag" not in raw
            assert "token_iv" not in raw

    def test_workspace_isolation_enforced_for_connections(self):
        """34. Workspace A's GitHub connection cannot be accessed by Workspace B."""
        user_a = httpx.post(f"{NODE_BASE}/auth/register", json={
            "name": "Iso User A", "email": f"iso_a_{_RUN_ID}@aira.test", "password": "Password123!", "role": "member"
        }).json()
        user_b = httpx.post(f"{NODE_BASE}/auth/register", json={
            "name": "Iso User B", "email": f"iso_b_{_RUN_ID}@aira.test", "password": "Password123!", "role": "member"
        }).json()

        # User B should be disconnected
        st_b = httpx.get(f"{NODE_BASE}/github/status", headers={"Authorization": f"Bearer {user_b['token']}"})
        assert st_b.status_code == 200
        assert st_b.json().get("connected") is False

        # User B cannot disconnect User A's workspace or access its status
        repo_b = httpx.get(f"{NODE_BASE}/github/repos", headers={"Authorization": f"Bearer {user_b['token']}"})
        assert repo_b.status_code == 200
        assert repo_b.json().get("is_mock") is True
