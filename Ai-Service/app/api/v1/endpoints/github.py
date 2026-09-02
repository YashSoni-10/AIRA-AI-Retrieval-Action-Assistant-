"""
GitHub Router - Exposes endpoints for managing git repos, issues and pull requests.
"""
from fastapi import APIRouter, Query
from app.services.github_service import get_github_repos, get_github_issues, get_github_pulls

router = APIRouter()


@router.get("/repos")
async def list_repos():
    """List GitHub repositories."""
    repos = get_github_repos()
    return {"repositories": repos, "count": len(repos)}


@router.get("/issues")
async def list_issues(repo: str | None = Query(default=None)):
    """List GitHub issues for a repository."""
    issues = get_github_issues(repo)
    return {"issues": issues, "count": len(issues), "repository": repo}


@router.get("/pulls")
async def list_pulls(repo: str | None = Query(default=None)):
    """List GitHub pull requests for a repository."""
    pulls = get_github_pulls(repo)
    return {"pulls": pulls, "count": len(pulls), "repository": repo}
