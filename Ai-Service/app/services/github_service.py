"""
GitHub Service — Workspace-Aware OAuth Integration
=====================================================
ALL GitHub data is fetched via the Node backend's existing GitHub endpoints.
This means:
  - The user's workspace OAuth token is used (AES-256-GCM encrypted in MongoDB)
  - Token refresh/rotation is handled by the Node github service automatically
  - Workspace isolation is enforced by the Node backend
  - Raw GitHub tokens are NEVER stored or logged here

Architecture:
  FastAPI Agent
      ↓
  forward user's Bearer JWT
      ↓
  Node GET /api/github/repos|issues|pulls
      ↓
  GitHubConnection.getValidAccessToken()  (auto-refresh if near expiry)
      ↓
  GitHub API

If the workspace is disconnected:
  Node returns  { connected: false, mock_mode: true, ... }
  → this service returns a clearly-labelled mock response.

If the token is expired and refresh fails:
  Node returns 401/403 with a reconnect-required message
  → this service surfaces that as a clean error — never silently uses mock data.
"""

import logging
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)

# Node backend base URL (same as used by chat.py for history fetching)
_NODE_URL = getattr(settings, "NODE_BACKEND_URL", "http://localhost:5000")

# Explicit mock data — ONLY used when the workspace is genuinely disconnected
# and the Node backend signals mock_mode=true.
_MOCK_REPOS = [
    {
        "id": 1,
        "name": "AIRA",
        "full_name": "aira-workspace/AIRA",
        "description": "[MOCK] AI-powered enterprise work assistant workspace repository.",
        "html_url": "https://github.com/aira-workspace/AIRA",
        "stargazers_count": 12,
        "forks_count": 2,
        "language": "TypeScript",
        "open_issues_count": 4,
    },
    {
        "id": 2,
        "name": "payment-service",
        "full_name": "aira-workspace/payment-service",
        "description": "[MOCK] Microservice handling payment gateways.",
        "html_url": "https://github.com/aira-workspace/payment-service",
        "stargazers_count": 8,
        "forks_count": 0,
        "language": "Go",
        "open_issues_count": 2,
    },
    {
        "id": 3,
        "name": "customer-portal",
        "full_name": "aira-workspace/customer-portal",
        "description": "[MOCK] Next.js frontend application for client account dashboard.",
        "html_url": "https://github.com/aira-workspace/customer-portal",
        "stargazers_count": 15,
        "forks_count": 5,
        "language": "JavaScript",
        "open_issues_count": 6,
    },
]

_MOCK_ISSUES = [
    {
        "number": 101,
        "title": "[MOCK] Bug: Theme preference not saving on page refresh",
        "state": "open",
        "user": {"login": "darpan-soni"},
        "created_at": "2026-08-29T10:00:00Z",
        "html_url": "https://github.com/aira-workspace/AIRA/issues/101",
        "comments": 3,
    },
    {
        "number": 102,
        "title": "[MOCK] Feature: Integrate Groq streaming response in Chat page",
        "state": "open",
        "user": {"login": "dev-lead"},
        "created_at": "2026-08-30T14:30:00Z",
        "html_url": "https://github.com/aira-workspace/AIRA/issues/102",
        "comments": 1,
    },
]

_MOCK_PULLS = [
    {
        "number": 42,
        "title": "[MOCK] feat: connect live python rag engine",
        "state": "open",
        "user": {"login": "darpan-soni"},
        "created_at": "2026-08-30T18:00:00Z",
        "html_url": "https://github.com/aira-workspace/AIRA/pull/42",
        "draft": False,
    },
]


def _auth_headers(raw_token: str) -> dict:
    """Build Authorization header. Never log the token value."""
    return {
        "Authorization": f"Bearer {raw_token}",
        "Accept": "application/json",
    }


def _is_mock_response(data: dict) -> bool:
    """Return True if the Node backend explicitly signalled a disconnected/mock state."""
    return (
        not data.get("connected", True)
        or data.get("mock_mode", False)
        or data.get("is_mock", False)
        or data.get("source") == "mock_fallback"
        or data.get("github_connected", True) is False
    )


def clean_repo_slug(val: str | None) -> str:
    """Normalize repository strings, stripping URLs, .git, quotes, and punctuation while preserving trailing hyphens."""
    if not val:
        return ""
    s = str(val).strip().strip("<>\"'`;()[]{}")
    for prefix in (
        "https://github.com/",
        "http://github.com/",
        "git@github.com:",
        "github.com/",
    ):
        if s.lower().startswith(prefix):
            s = s[len(prefix):]
            break
    if s.endswith(".git"):
        s = s[:-4]
    s = s.strip("/")
    parts = s.split("/")
    punct_trailing = ".,:;?!\"'`()[]{}<>"
    if len(parts) >= 2:
        owner = parts[0].strip().strip(punct_trailing)
        repo_name = parts[1].strip()
        if repo_name.endswith(".git"):
            repo_name = repo_name[:-4]
        repo_name = repo_name.strip().strip(punct_trailing)
        return f"{owner}/{repo_name}"
    return s.strip().strip(punct_trailing)


def get_github_repos(raw_token: str = "", workspace_id: str | None = None) -> dict:
    """
    Fetch repositories for the authenticated user's workspace.

    Returns:
        {
            "repositories": [...],
            "count": N,
            "source": "live" | "mock",
            "is_mock": bool,
            "mock_reason": "..." (only when source == "mock")
        }

    Raises:
        RuntimeError if the workspace is connected but token is expired/invalid
        (caller should surface this as a reconnect-required message).
    """
    if not raw_token:
        logger.warning("get_github_repos: no token supplied — returning mock repos")
        # Normalize mock repos so owner.login and html_url are also guaranteed
        normalized_mock = []
        for r in _MOCK_REPOS:
            item = dict(r)
            if not isinstance(item.get("owner"), dict):
                owner_login = str(item.get("full_name", "")).split("/")[0] if "/" in str(item.get("full_name", "")) else "aira-workspace"
                item["owner"] = {"login": owner_login}
            if not item.get("html_url") and item.get("full_name"):
                item["html_url"] = f"https://github.com/{item['full_name']}"
            normalized_mock.append(item)

        return {
            "repositories": normalized_mock,
            "count": len(normalized_mock),
            "source": "mock",
            "is_mock": True,
            "mock_reason": "no_token",
        }

    params: dict[str, str] = {}
    if workspace_id:
        params["workspace_id"] = workspace_id

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                f"{_NODE_URL}/api/github/repos",
                headers=_auth_headers(raw_token),
                params=params,
            )

        if resp.status_code == 200:
            data = resp.json()
            repos = data.get("repos", data.get("repositories", []))
            is_mock = data.get("is_mock", False) or data.get("mock_mode", False) or data.get("source") == "mock_fallback"
            source = "mock" if is_mock else "live"

            # Normalize repository objects so name, owner.login, and html_url are guaranteed
            normalized_repos = []
            for r in repos:
                repo_dict = dict(r)
                owner = repo_dict.get("owner")
                if isinstance(owner, dict):
                    owner_login = owner.get("login") or ""
                elif isinstance(owner, str):
                    owner_login = owner
                elif "/" in str(repo_dict.get("full_name", "")):
                    owner_login = str(repo_dict["full_name"]).split("/")[0]
                else:
                    owner_login = "unknown"

                if not isinstance(owner, dict):
                    repo_dict["owner"] = {"login": owner_login}
                elif not repo_dict["owner"].get("login"):
                    repo_dict["owner"]["login"] = owner_login

                if not repo_dict.get("html_url") and repo_dict.get("full_name"):
                    repo_dict["html_url"] = f"https://github.com/{repo_dict['full_name']}"

                normalized_repos.append(repo_dict)

            result = {
                "repositories": normalized_repos,
                "count": len(normalized_repos),
                "source": source,
                "is_mock": is_mock,
            }
            if is_mock:
                result["mock_reason"] = data.get("mock_reason", "disconnected")
            logger.info("get_github_repos: %s (%d repos)", source, len(normalized_repos))
            return result

        if resp.status_code in (401, 403):
            logger.warning(
                "get_github_repos: Node returned %d — workspace GitHub token expired or revoked",
                resp.status_code,
            )
            raise RuntimeError(
                "GitHub authentication failed. Please reconnect your GitHub account "
                "at /github and try again."
            )

        logger.error("get_github_repos: Node returned unexpected %d", resp.status_code)
        raise RuntimeError(
            f"GitHub service returned an unexpected error (HTTP {resp.status_code}). "
            "Please try again."
        )

    except httpx.TimeoutException:
        logger.error("get_github_repos: Node backend timed out")
        raise RuntimeError("GitHub service timed out. Please try again.")
    except httpx.ConnectError:
        logger.error("get_github_repos: Cannot reach Node backend")
        raise RuntimeError("Cannot reach the AIRA backend. Please ensure services are running.")


def get_github_issues(
    raw_token: str = "",
    repo_full_name: str | None = None,
    state: str = "open",
    workspace_id: str | None = None,
) -> dict:
    """
    Fetch issues from the Node backend (which uses the workspace OAuth token).

    Returns same structure as get_github_repos but with 'issues' key.
    Raises RuntimeError if the workspace token is expired/revoked.
    """
    if not raw_token:
        logger.warning("get_github_issues: no token supplied — returning mock issues")
        mock_items = (
            [i for i in _MOCK_ISSUES if i.get("state") == state]
            if state in ("open", "closed")
            else _MOCK_ISSUES
        )
        return {
            "issues": mock_items,
            "count": len(mock_items),
            "source": "mock",
            "is_mock": True,
            "mock_reason": "no_token",
        }

    params: dict[str, str] = {}
    cleaned_repo = clean_repo_slug(repo_full_name) if repo_full_name else None
    if cleaned_repo:
        params["repo"] = cleaned_repo
    if state:
        params["state"] = state
    if workspace_id:
        params["workspace_id"] = workspace_id

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                f"{_NODE_URL}/api/github/issues",
                headers=_auth_headers(raw_token),
                params=params,
            )

        if resp.status_code == 200:
            data = resp.json()
            issues = data.get("issues", [])
            is_mock = data.get("is_mock", False) or data.get("mock_mode", False) or data.get("source") == "mock_fallback"
            source = "mock" if is_mock else "live"
            result = {
                "issues": issues,
                "count": len(issues),
                "source": source,
                "is_mock": is_mock,
                "repository": data.get("repository") or repo_full_name,
            }
            if is_mock:
                result["mock_reason"] = data.get("mock_reason", "disconnected")
            return result

        if resp.status_code == 400:
            err_msg = "Invalid parameters."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            raise RuntimeError(f"GitHub request error: {err_msg}")

        if resp.status_code in (401, 403):
            err_msg = "GitHub authentication failed. Please reconnect your GitHub account at /github."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            raise RuntimeError(f"GitHub authentication error: {err_msg}")

        if resp.status_code == 429:
            err_msg = "GitHub API rate limit exceeded. Please wait a moment before querying GitHub again."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            raise RuntimeError(f"GitHub rate limit exceeded: {err_msg}")

        if resp.status_code == 404:
            raise RuntimeError(f"GitHub repository '{repo_full_name}' was not found or is inaccessible.")

        err_detail = f"HTTP {resp.status_code}"
        try:
            err_detail = resp.json().get("message", err_detail)
        except Exception:
            pass
        raise RuntimeError(f"GitHub service error: {err_detail}")

    except httpx.TimeoutException:
        raise RuntimeError("GitHub service timed out.")
    except httpx.ConnectError:
        raise RuntimeError("Cannot reach the AIRA backend.")


def get_github_pulls(
    raw_token: str = "",
    repo_full_name: str | None = None,
    state: str = "open",
    workspace_id: str | None = None,
) -> dict:
    """
    Fetch pull requests from the Node backend (workspace OAuth token).

    Returns same structure as get_github_repos but with 'pulls' key.
    Raises RuntimeError if the workspace token is expired/revoked.
    """
    if not raw_token:
        logger.warning("get_github_pulls: no token supplied — returning mock PRs")
        mock_items = (
            [p for p in _MOCK_PULLS if p.get("state") == state]
            if state in ("open", "closed")
            else _MOCK_PULLS
        )
        return {
            "pulls": mock_items,
            "count": len(mock_items),
            "source": "mock",
            "is_mock": True,
            "mock_reason": "no_token",
            "repository": repo_full_name or "aira-workspace/AIRA",
        }

    params: dict[str, str] = {}
    cleaned_repo = clean_repo_slug(repo_full_name) if repo_full_name else None
    if cleaned_repo:
        params["repo"] = cleaned_repo
    if state:
        params["state"] = state
    if workspace_id:
        params["workspace_id"] = workspace_id

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                f"{_NODE_URL}/api/github/pulls",
                headers=_auth_headers(raw_token),
                params=params,
            )

        if resp.status_code == 200:
            data = resp.json()
            pulls = data.get("pulls", data.get("pull_requests", []))
            is_mock = data.get("is_mock", False) or data.get("mock_mode", False) or data.get("source") == "mock_fallback"
            source = "mock" if is_mock else "live"
            result = {
                "pulls": pulls,
                "count": len(pulls),
                "source": source,
                "is_mock": is_mock,
                "repository": data.get("repository") or repo_full_name,
            }
            if is_mock:
                result["mock_reason"] = data.get("mock_reason", "disconnected")
            return result

        if resp.status_code == 400:
            err_msg = "Invalid parameters."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            raise RuntimeError(f"GitHub request error: {err_msg}")

        if resp.status_code in (401, 403):
            err_msg = "GitHub authentication failed. Please reconnect your GitHub account at /github."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            raise RuntimeError(f"GitHub authentication error: {err_msg}")

        if resp.status_code == 429:
            err_msg = "GitHub API rate limit exceeded. Please wait a moment before querying GitHub again."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            raise RuntimeError(f"GitHub rate limit exceeded: {err_msg}")

        if resp.status_code == 404:
            raise RuntimeError(f"GitHub repository '{repo_full_name}' was not found or is inaccessible.")

        err_detail = f"HTTP {resp.status_code}"
        try:
            err_detail = resp.json().get("message", err_detail)
        except Exception:
            pass
        raise RuntimeError(f"GitHub service error: {err_detail}")

    except httpx.TimeoutException:
        raise RuntimeError("GitHub service timed out.")
    except httpx.ConnectError:
        raise RuntimeError("Cannot reach the AIRA backend.")


def get_github_tree(
    raw_token: str = "",
    repo_full_name: str | None = None,
    branch: str | None = None,
    path: str | None = None,
    workspace_id: str | None = None,
) -> dict:
    """
    Fetch repository file tree and directory structure from the Node backend
    (which uses the workspace OAuth token).
    """
    cleaned_repo = clean_repo_slug(repo_full_name) if repo_full_name else None

    if not raw_token:
        logger.warning("get_github_tree: no token supplied — returning mock tree")
        mock_files = [
            "README.md",
            "package.json",
            "frontend/src/App.tsx",
            "frontend/src/pages/DashboardPage.tsx",
            "frontend/src/pages/ChatPage.tsx",
            "frontend/src/services/api.ts",
            "backend/server.js",
            "backend/src/routes/github.js",
            "backend/src/controllers/githubController.js",
            "Ai-Service/app/main.py",
            "Ai-Service/app/services/agent_service.py",
            "Ai-Service/app/services/langgraph_agent.py",
        ]
        return {
            "repository": cleaned_repo or "aira-workspace/AIRA",
            "branch": branch or "main",
            "files": mock_files,
            "directories": ["frontend", "backend", "Ai-Service"],
            "count": len(mock_files),
            "tree": [{"path": p, "type": "blob", "size": 1024} for p in mock_files],
            "source": "mock",
            "is_mock": True,
            "mock_reason": "no_token",
        }

    params: dict[str, str] = {}
    if cleaned_repo:
        params["repo"] = cleaned_repo
    if branch:
        params["branch"] = branch
    if path:
        params["path"] = path
    if workspace_id:
        params["workspace_id"] = workspace_id

    try:
        logger.info("get_github_tree: requesting tree from Node for repo=%s branch=%s path=%s", cleaned_repo, branch or "HEAD", path or "root")
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(
                f"{_NODE_URL}/api/github/tree",
                headers=_auth_headers(raw_token),
                params=params,
            )

        if resp.status_code == 200:
            data = resp.json()
            is_mock = data.get("is_mock", False) or data.get("mock_mode", False) or data.get("source") == "mock_fallback"
            source = "mock" if is_mock else "live"
            files_count = len(data.get("files", []))
            tree_count = len(data.get("tree", []))
            logger.info("get_github_tree: Node returned 200 for repo=%s (%d files, %d tree items, source=%s)", cleaned_repo, files_count, tree_count, source)
            result = {
                "repository": data.get("repository") or cleaned_repo,
                "branch": data.get("branch") or branch or "HEAD",
                "files": data.get("files", []),
                "directories": data.get("directories", []),
                "count": data.get("count", len(data.get("files", []))),
                "tree": data.get("tree", []),
                "truncated": data.get("truncated", False),
                "source": source,
                "is_mock": is_mock,
            }
            if is_mock:
                result["mock_reason"] = data.get("mock_reason", "disconnected")
            return result

        if resp.status_code == 400:
            err_msg = "Invalid parameters."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            raise RuntimeError(f"GitHub request error: {err_msg}")

        if resp.status_code in (401, 403):
            err_msg = "GitHub authentication failed. Please reconnect your GitHub account at /github."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            raise RuntimeError(f"GitHub authentication error: {err_msg}")

        if resp.status_code == 404:
            raise RuntimeError(f"GitHub repository '{cleaned_repo}' was not found or is inaccessible.")

        if resp.status_code == 429:
            raise RuntimeError("GitHub API rate limit exceeded. Please wait a moment before querying GitHub again.")

        err_detail = f"HTTP {resp.status_code}"
        try:
            err_detail = resp.json().get("message", err_detail)
        except Exception:
            pass
        raise RuntimeError(f"GitHub service error: {err_detail}")

    except httpx.TimeoutException:
        raise RuntimeError("GitHub service timed out.")
    except httpx.ConnectError:
        raise RuntimeError("Cannot reach the AIRA backend.")


def get_github_file_content(
    raw_token: str = "",
    repo_full_name: str | None = None,
    path: str = "",
    ref: str | None = None,
    workspace_id: str | None = None,
) -> dict:
    """
    Fetch raw file content for a file in a GitHub repository from the Node backend
    (which uses the workspace OAuth token).
    """
    cleaned_repo = clean_repo_slug(repo_full_name) if repo_full_name else None
    clean_path = str(path or "").strip().lstrip("/")

    if not raw_token:
        logger.warning("get_github_file_content: no token supplied — returning mock content")
        return {
            "repository": cleaned_repo or "aira-workspace/AIRA",
            "path": clean_path,
            "content": f"[MOCK FILE: {clean_path}]\nFile content simulated (no auth token).",
            "size": 100,
            "source": "mock",
            "is_mock": True,
            "mock_reason": "no_token",
        }

    if not clean_path:
        raise RuntimeError("File path parameter 'path' is required.")

    params: dict[str, str] = {"path": clean_path}
    if cleaned_repo:
        params["repo"] = cleaned_repo
    if ref:
        params["ref"] = ref
    if workspace_id:
        params["workspace_id"] = workspace_id

    try:
        logger.info("get_github_file_content: requesting file from Node for repo=%s path=%s ref=%s", cleaned_repo, clean_path, ref or "HEAD")
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(
                f"{_NODE_URL}/api/github/file",
                headers=_auth_headers(raw_token),
                params=params,
            )

        if resp.status_code == 200:
            data = resp.json()
            is_mock = data.get("is_mock", False) or data.get("mock_mode", False) or data.get("source") == "mock_fallback"
            source = "mock" if is_mock else "live"
            content_len = len(data.get("content", ""))
            logger.info("get_github_file_content: Node returned 200 for repo=%s path=%s (%d chars, source=%s)", cleaned_repo, clean_path, content_len, source)
            result = {
                "repository": data.get("repository") or cleaned_repo,
                "path": data.get("path") or clean_path,
                "content": data.get("content", ""),
                "size": data.get("size", len(data.get("content", ""))),
                "truncated": data.get("truncated", False),
                "source": source,
                "is_mock": is_mock,
            }
            if is_mock:
                result["mock_reason"] = data.get("mock_reason", "disconnected")
            return result

        if resp.status_code == 400:
            err_msg = "Invalid parameters."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            raise RuntimeError(f"GitHub request error: {err_msg}")

        if resp.status_code in (401, 403):
            err_msg = "GitHub authentication failed. Please reconnect your GitHub account at /github."
            try:
                err_msg = resp.json().get("message", err_msg)
            except Exception:
                pass
            raise RuntimeError(f"GitHub authentication error: {err_msg}")

        if resp.status_code == 404:
            raise RuntimeError(f"File '{clean_path}' was not found in repository '{cleaned_repo}'.")

        if resp.status_code == 429:
            raise RuntimeError("GitHub API rate limit exceeded. Please wait a moment before querying GitHub again.")

        err_detail = f"HTTP {resp.status_code}"
        try:
            err_detail = resp.json().get("message", err_detail)
        except Exception:
            pass
        raise RuntimeError(f"GitHub service error: {err_detail}")

    except httpx.TimeoutException:
        raise RuntimeError("GitHub service timed out.")
    except httpx.ConnectError:
        raise RuntimeError("Cannot reach the AIRA backend.")
