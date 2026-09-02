"""
GitHub Service - Interacts with the GitHub API or returns functional mock fallback data.
"""
import httpx
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

GITHUB_API_URL = "https://api.github.com"


def get_headers():
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "AIRA-AI-Service"
    }
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = f"token {settings.GITHUB_TOKEN}"
    return headers


def get_github_repos() -> list[dict]:
    """Fetch repositories for the authenticated user or default list."""
    if not settings.GITHUB_TOKEN:
        logger.info("GitHub token not set. Returning mock repositories fallback.")
        return [
            {
                "id": 1,
                "name": "AIRA",
                "full_name": "aira-workspace/AIRA",
                "description": "AI-powered enterprise work assistant workspace repository.",
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
                "description": "Microservice handling payment gateways, Stripe integration and billing.",
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
                "description": "Next.js frontend application for client account dashboard.",
                "html_url": "https://github.com/aira-workspace/customer-portal",
                "stargazers_count": 15,
                "forks_count": 5,
                "language": "JavaScript",
                "open_issues_count": 6,
            }
        ]

    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get(f"{GITHUB_API_URL}/user/repos", headers=get_headers(), params={"sort": "updated"})
            if res.status_code == 200:
                return res.json()
            # If user request fails (e.g. invalid token), try fallback public repo search or mock
            logger.error(f"GitHub API returned {res.status_code}: {res.text}. Falling back to mock data.")
    except Exception as e:
        logger.error(f"Error connecting to GitHub API: {e}")
    
    return []


def get_github_issues(repo_full_name: str | None = None) -> list[dict]:
    """Fetch issues for a repository."""
    repo = repo_full_name or settings.GITHUB_REPO or "aira-workspace/AIRA"
    
    if not settings.GITHUB_TOKEN:
        logger.info(f"GitHub token not set. Returning mock issues for {repo}.")
        return [
            {
                "number": 101,
                "title": "Bug: Theme preference not saving on page refresh",
                "state": "open",
                "user": {"login": "darpan-soni"},
                "created_at": "2026-08-29T10:00:00Z",
                "html_url": f"https://github.com/{repo}/issues/101",
                "comments": 3,
            },
            {
                "number": 102,
                "title": "Feature: Integrate Groq streaming response in Chat page",
                "state": "open",
                "user": {"login": "dev-lead"},
                "created_at": "2026-08-30T14:30:00Z",
                "html_url": f"https://github.com/{repo}/issues/102",
                "comments": 1,
            },
            {
                "number": 103,
                "title": "Refactor: Move RAG chunking logic to python backend service",
                "state": "closed",
                "user": {"login": "system-architect"},
                "created_at": "2026-08-28T09:15:00Z",
                "html_url": f"https://github.com/{repo}/issues/103",
                "comments": 5,
            }
        ]

    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get(f"{GITHUB_API_URL}/repos/{repo}/issues", headers=get_headers(), params={"state": "all"})
            if res.status_code == 200:
                # Exclude pull requests (GitHub API /issues returns PRs too)
                issues = [item for item in res.json() if "pull_request" not in item]
                return issues
            logger.error(f"GitHub API for issues returned {res.status_code}")
    except Exception as e:
        logger.error(f"Error fetching GitHub issues: {e}")
    
    return []


def get_github_pulls(repo_full_name: str | None = None) -> list[dict]:
    """Fetch pull requests for a repository."""
    repo = repo_full_name or settings.GITHUB_REPO or "aira-workspace/AIRA"

    if not settings.GITHUB_TOKEN:
        logger.info(f"GitHub token not set. Returning mock pull requests for {repo}.")
        return [
            {
                "number": 42,
                "title": "feat: connect live python rag engine and update document uploader",
                "state": "open",
                "user": {"login": "darpan-soni"},
                "created_at": "2026-08-30T18:00:00Z",
                "html_url": f"https://github.com/{repo}/pull/42",
                "draft": False,
            },
            {
                "number": 41,
                "title": "chore: remove theme toggle buttons from UI layouts",
                "state": "closed",
                "user": {"login": "darpan-soni"},
                "created_at": "2026-08-29T11:00:00Z",
                "html_url": f"https://github.com/{repo}/pull/41",
                "draft": False,
            }
        ]

    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get(f"{GITHUB_API_URL}/repos/{repo}/pulls", headers=get_headers(), params={"state": "all"})
            if res.status_code == 200:
                return res.json()
            logger.error(f"GitHub API for pulls returned {res.status_code}")
    except Exception as e:
        logger.error(f"Error fetching GitHub pull requests: {e}")

    return []
