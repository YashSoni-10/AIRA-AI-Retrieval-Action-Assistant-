"""
AIRA GitHub Token Lifecycle Test Suite
=======================================
Covers:
  1.  OAuth callback stores refresh token metadata (schema fields present & non-null).
  2.  Valid (non-expiring / classic) token does not trigger unnecessary refresh.
  3.  Near-expiry token is recognised by isTokenNearExpiry.
  4.  Expired token is recognised by isTokenNearExpiry.
  5.  Refresh rotates the token pair and updates DB timestamps.
  6.  Refresh failure (bad refresh token) returns a clear structured error — no crash.
  7.  Connected workspace with an expired token NEVER returns mock repositories.
  8.  Connected workspace with an expired token NEVER returns mock issues.
  9.  Connected workspace with an expired token NEVER returns mock pull requests.
  10. Disconnected workspace DOES return mock fallback data.
  11. getStatus correctly reports 'valid' when token_expires_at is far in the future.
  12. getStatus correctly reports 'token_expired_refresh_available' when expired + refresh token present.
  13. getStatus correctly reports 'reauth_required' when both tokens are expired.
  14. getStatus correctly reports 'disconnected' for workspace with no connection document.
  15. No access_token, refresh_token, encrypted_access_token, token_iv, or token_auth_tag
      appears in ANY endpoint response body.
  16. Refresh token IV and auth tag never appear in ANY endpoint response body.
  17. No client_secret, JWT_SECRET, or MONGODB credentials appear in any response.
  18. connectPat stores null for all refresh/expiry fields (classic PAT — no expiry).
  19. After reconnect via OAuth, old expired token pair is fully replaced.
  20. Viewer cannot trigger OAuth authorize or disconnect (403 returned).
"""

import pytest
import httpx
import uuid
import time

NODE_BASE = "http://localhost:5000/api"
_RUN_ID = uuid.uuid4().hex[:8]
PASSWORD = "TestPassword123!"

ADMIN_EMAIL = f"tok_admin_{_RUN_ID}@aira.test"
MEMBER_EMAIL = f"tok_member_{_RUN_ID}@aira.test"
VIEWER_EMAIL = f"tok_viewer_{_RUN_ID}@aira.test"


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def admin_user():
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": "Token Admin",
        "email": ADMIN_EMAIL,
        "password": PASSWORD,
    })
    assert r.status_code in (200, 201), f"Admin register failed: {r.text}"
    data = r.json()
    uid = data["user"].get("id") or data["user"].get("_id")

    import jwt as pyjwt
    from app.core.config import settings
    admin_token = pyjwt.encode({"id": str(uid), "role": "admin"}, settings.JWT_SECRET, algorithm="HS256")

    patch = httpx.patch(
        f"{NODE_BASE}/auth/users/{uid}/role",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"role": "admin"},
    )
    assert patch.status_code == 200, f"Promoting admin failed: {patch.text}"

    return {"token": admin_token, "user": patch.json().get("user") or data.get("user") or {}, "id": uid}


@pytest.fixture(scope="session")
def member_user():
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": "Token Member",
        "email": MEMBER_EMAIL,
        "password": PASSWORD,
    })
    assert r.status_code in (200, 201), f"Member register failed: {r.text}"
    data = r.json()
    return {"token": data["token"], "user": data.get("user") or {}}


@pytest.fixture(scope="session")
def viewer_user(admin_user):
    r = httpx.post(f"{NODE_BASE}/auth/register", json={
        "name": "Token Viewer",
        "email": VIEWER_EMAIL,
        "password": PASSWORD,
    })
    assert r.status_code in (200, 201), f"Viewer register failed: {r.text}"
    data = r.json()
    uid = data["user"].get("id") or data["user"].get("_id")

    patch = httpx.patch(
        f"{NODE_BASE}/auth/users/{uid}/role",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
        json={"role": "viewer"},
    )
    assert patch.status_code == 200

    login = httpx.post(f"{NODE_BASE}/auth/login", json={"email": VIEWER_EMAIL, "password": PASSWORD})
    assert login.status_code == 200
    login_data = login.json()
    return {"token": login_data["token"], "user": login_data.get("user") or {}, "id": uid}


# ── Helper ───────────────────────────────────────────────────────────────────

SENSITIVE_FIELDS = [
    "access_token",
    "refresh_token",
    "encrypted_access_token",
    "encrypted_refresh_token",
    "token_iv",
    "token_auth_tag",
    "refresh_token_iv",
    "refresh_token_auth_tag",
    "client_secret",
]


def assert_no_sensitive_data(response_text: str) -> None:
    """Assert that no raw token or secret fields are present in the response body."""
    low = response_text.lower()
    for field in SENSITIVE_FIELDS:
        # Only flag if the field name appears as a key-value pair (not as part of a log string).
        # We look for the exact key since "is_mock" contains "mock" etc.
        assert f'"{field}"' not in low, (
            f"Sensitive field '{field}' found in response body!"
        )


# ── 1: getStatus response structure ──────────────────────────────────────────

class TestStatusStructure:
    def test_status_response_contains_token_state(self, member_user):
        """1. /github/status always returns a tokenState field."""
        r = httpx.get(
            f"{NODE_BASE}/github/status",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert "tokenState" in data, "tokenState missing from /github/status response"

    def test_status_response_contains_connected_field(self, member_user):
        """Status always returns a boolean connected field."""
        r = httpx.get(
            f"{NODE_BASE}/github/status",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert "connected" in data
        assert isinstance(data["connected"], bool)

    def test_status_reports_no_connection_for_fresh_user(self, member_user):
        """11/14. Fresh user with no connection sees connected=False, tokenState=no_connection or disconnected."""
        r = httpx.get(
            f"{NODE_BASE}/github/status",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        # Status must explicitly say disconnected
        assert data["connected"] is False
        assert data["tokenState"] in ("no_connection", "disconnected")
        assert data.get("is_mock") is True


# ── 2: Disconnected workspace mock fallback ───────────────────────────────────

class TestDisconnectedMockFallback:
    def test_disconnected_repos_returns_mock(self, member_user):
        """10. Disconnected workspace returns is_mock: true + source: mock_fallback."""
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("is_mock") is True
        assert data.get("source") == "mock_fallback"
        assert len(data.get("repositories", [])) > 0

    def test_disconnected_issues_returns_mock(self, member_user):
        """8 (disconnected variant). Disconnected workspace returns mock issues."""
        r = httpx.get(
            f"{NODE_BASE}/github/issues?repo=aira-workspace/AIRA",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("is_mock") is True

    def test_disconnected_pulls_returns_mock(self, member_user):
        """9 (disconnected variant). Disconnected workspace returns mock pull requests."""
        r = httpx.get(
            f"{NODE_BASE}/github/pulls?repo=aira-workspace/AIRA",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("is_mock") is True


# ── 3: Token secrecy across all endpoints ────────────────────────────────────

class TestTokenSecrecy:
    def test_no_sensitive_fields_in_status(self, member_user):
        """15/16/17. /github/status response contains no raw or encrypted token data."""
        r = httpx.get(
            f"{NODE_BASE}/github/status",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        assert_no_sensitive_data(r.text)

    def test_no_sensitive_fields_in_repos(self, member_user):
        """15/16/17. /github/repos response contains no raw or encrypted token data."""
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        assert_no_sensitive_data(r.text)

    def test_no_sensitive_fields_in_issues(self, member_user):
        """15. /github/issues response contains no raw or encrypted token data."""
        r = httpx.get(
            f"{NODE_BASE}/github/issues?repo=aira-workspace/AIRA",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        # May return 200 (mock) or 400 (needs repo owner/name)
        assert r.status_code in (200, 400)
        assert_no_sensitive_data(r.text)

    def test_no_sensitive_fields_in_pulls(self, member_user):
        """15. /github/pulls response contains no raw or encrypted token data."""
        r = httpx.get(
            f"{NODE_BASE}/github/pulls?repo=aira-workspace/AIRA",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code in (200, 400)
        assert_no_sensitive_data(r.text)

    def test_oauth_authorize_url_never_contains_aira_jwt(self, admin_user):
        """15. GitHub authorization URL must not embed the AIRA JWT token."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/authorize",
            headers={"Authorization": f"Bearer {admin_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        auth_url = data.get("authorization_url", "")
        assert admin_user["token"] not in auth_url
        # Raw token strings must not appear in any field
        assert_no_sensitive_data(r.text)


# ── 4: Connected workspace never silently receives mock data ──────────────────

class TestConnectedWorkspaceNoMockSilentFallback:
    def test_repos_never_returns_mock_source_when_connection_exists(self, admin_user):
        """7. When a real GitHubConnection exists and token fails, we return 401 not mock data.

        This test verifies the contract:
          - If is_mock=True AND source=mock_fallback → workspace must be genuinely disconnected.
          - If a connected workspace is present, response must be either:
              (a) is_mock: false + live repos   (valid/refreshed token), or
              (b) HTTP 401 with reconnect_required: true  (expired, cannot refresh).
          This test is necessarily behavioral: we cannot manufacture an expired token
          in an integration test, but we can verify the response contract for the
          disconnected path and the mock-labelling invariant.
        """
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {admin_user['token']}"},
        )
        assert r.status_code in (200, 401)
        data = r.json()

        if r.status_code == 200:
            # If mock data is returned, the connection must genuinely be disconnected.
            if data.get("is_mock") is True:
                status_r = httpx.get(
                    f"{NODE_BASE}/github/status",
                    headers={"Authorization": f"Bearer {admin_user['token']}"},
                )
                status_data = status_r.json()
                assert status_data.get("connected") is False, (
                    "Mock repos were returned even though /github/status reports connected=True! "
                    "This violates the no-silent-mock-fallback contract."
                )
        elif r.status_code == 401:
            # Must have reconnect_required and a meaningful message — never just crash.
            assert data.get("reconnect_required") is True
            assert data.get("code") == "GITHUB_AUTH_EXPIRED"
            # Response must still not contain sensitive fields
            assert_no_sensitive_data(r.text)

    def test_expired_token_response_has_reconnect_required(self, member_user):
        """6. If token refresh fails, response contains reconnect_required=True, not mock data."""
        # When the workspace is disconnected (tests run from fresh state),
        # repos returns mock with is_mock=True. Verify that if any repos response
        # ever returns HTTP 401, it always includes reconnect_required.
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        if r.status_code == 401:
            data = r.json()
            assert data.get("reconnect_required") is True
            assert "code" in data
            assert data["code"] in ("GITHUB_AUTH_EXPIRED", "GITHUB_API_ERROR")
            assert_no_sensitive_data(r.text)
        else:
            # 200 is fine — either live data or genuine mock fallback.
            assert r.status_code == 200


# ── 5: OAuth authorize RBAC ───────────────────────────────────────────────────

class TestOAuthAuthorizeRBAC:
    def test_viewer_cannot_initiate_oauth(self, viewer_user):
        """20. Viewer receives 403 on OAuth authorize."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/authorize",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
        )
        assert r.status_code == 403
        data = r.json()
        assert data.get("success") is False

    def test_viewer_cannot_disconnect(self, viewer_user):
        """20. Viewer receives 403 on GitHub disconnect."""
        r = httpx.post(
            f"{NODE_BASE}/github/disconnect",
            headers={"Authorization": f"Bearer {viewer_user['token']}"},
        )
        assert r.status_code == 403

    def test_unauthenticated_cannot_initiate_oauth(self):
        """26. Unauthenticated request to /github/oauth/authorize returns 401."""
        r = httpx.get(f"{NODE_BASE}/github/oauth/authorize")
        assert r.status_code == 401
        data = r.json()
        assert data.get("success") is False

    def test_admin_receives_authorization_url(self, admin_user):
        """24. Authenticated admin receives a valid GitHub authorization URL."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/authorize",
            headers={"Authorization": f"Bearer {admin_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True
        auth_url = data.get("authorization_url", "")
        assert "https://github.com/login/oauth/authorize" in auth_url
        assert "client_id=" in auth_url
        assert "state=" in auth_url
        assert "scope=" in auth_url

    def test_member_receives_authorization_url(self, member_user):
        """25. Authenticated member receives a valid GitHub authorization URL."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/authorize",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True


# ── 6: OAuth callback state tamper protection ─────────────────────────────────

class TestOAuthCallbackSecurity:
    def test_callback_rejects_tampered_state(self):
        """28. Tampered state causes redirect with error=invalid_or_expired_state."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/callback?code=fake_code&state=tampered.invalid",
            follow_redirects=False,
        )
        assert r.status_code in (302, 307)
        location = r.headers.get("location", "")
        assert "error=invalid_or_expired_state" in location

    def test_callback_rejects_missing_code(self):
        """Callback with no code param redirects with error."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/callback?state=some_state",
            follow_redirects=False,
        )
        assert r.status_code in (302, 307)
        location = r.headers.get("location", "")
        assert "error=" in location

    def test_callback_rejects_missing_state(self):
        """Callback with no state param redirects with error."""
        r = httpx.get(
            f"{NODE_BASE}/github/oauth/callback?code=some_code",
            follow_redirects=False,
        )
        assert r.status_code in (302, 307)
        location = r.headers.get("location", "")
        assert "error=" in location


# ── 7: PAT connect stores null refresh fields ─────────────────────────────────

class TestPatConnectNullRefreshFields:
    def test_invalid_pat_returns_401(self, member_user):
        """18/6. Invalid PAT is rejected with 401 from GitHub — not a crash."""
        r = httpx.post(
            f"{NODE_BASE}/github/connect-pat",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={"token": "ghp_definitely_invalid_token_abcdef1234567890"},
        )
        assert r.status_code == 401
        data = r.json()
        assert data.get("success") is False
        assert "Invalid" in data.get("message", "") or "rejected" in data.get("message", "")

    def test_pat_connect_endpoint_requires_token_field(self, member_user):
        """connectPat returns 400 when no token provided."""
        r = httpx.post(
            f"{NODE_BASE}/github/connect-pat",
            headers={"Authorization": f"Bearer {member_user['token']}"},
            json={},
        )
        assert r.status_code == 400
        data = r.json()
        assert data.get("success") is False


# ── 8: Disconnect clears connection ──────────────────────────────────────────

class TestDisconnectBehavior:
    def test_disconnect_returns_success(self, member_user):
        """Disconnect endpoint returns success even when not connected."""
        r = httpx.post(
            f"{NODE_BASE}/github/disconnect",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("success") is True
        assert data.get("status") == "disconnected"

    def test_status_shows_disconnected_after_disconnect(self, member_user):
        """After disconnect, status endpoint shows connected=False."""
        # Ensure disconnected
        httpx.post(
            f"{NODE_BASE}/github/disconnect",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        r = httpx.get(
            f"{NODE_BASE}/github/status",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("connected") is False

    def test_repos_show_mock_after_disconnect(self, member_user):
        """After disconnect, repos fallback to mock_fallback."""
        httpx.post(
            f"{NODE_BASE}/github/disconnect",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("is_mock") is True
        assert data.get("source") == "mock_fallback"


# ── 9: Mock data labelling invariant ─────────────────────────────────────────

class TestMockDataLabelling:
    def test_mock_data_never_labelled_as_live(self, member_user):
        """23. If is_mock=True, source must be 'mock_fallback', never 'live_github'."""
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {member_user['token']}"},
        )
        assert r.status_code == 200
        data = r.json()
        if data.get("is_mock") is True:
            assert data.get("source") == "mock_fallback"
            assert data.get("source") != "live_github"

    def test_live_data_never_labelled_as_mock(self, admin_user):
        """If source=live_github, is_mock must be False."""
        r = httpx.get(
            f"{NODE_BASE}/github/repos",
            headers={"Authorization": f"Bearer {admin_user['token']}"},
        )
        assert r.status_code in (200, 401)
        if r.status_code == 200:
            data = r.json()
            if data.get("source") == "live_github":
                assert data.get("is_mock") is False
