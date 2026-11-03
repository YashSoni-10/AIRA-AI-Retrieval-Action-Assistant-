# AIRA — GitHub Integration Audit
**Date:** 2026-09-09 | Source: `Ai-Service/app/services/github_service.py`, `endpoints/github.py`, `agent_service.py`

---

## Status: PARTIALLY IMPLEMENTED

Real GitHub integration works when `GITHUB_TOKEN` is provided. Without token, hardcoded mock data is returned. Core operations (repos, issues, PRs) implemented. Advanced operations (commits, code, pagination) missing.

---

## Implementation Details

### Authentication (`github_service.py get_headers()`)
```python
headers = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "AIRA-AI-Service"
}
if settings.GITHUB_TOKEN:
    headers["Authorization"] = f"token {settings.GITHUB_TOKEN}"
```
- Token is optional — if not set, unauthenticated requests are made (60 req/hr limit)
- If token set but invalid → API returns 401 → logs error → returns `[]` (empty list, NOT mock data)

---

## Endpoint Analysis

### `get_github_repos()`
| Scenario | Behavior |
|----------|----------|
| No `GITHUB_TOKEN` | Returns 3 hardcoded mock repos |
| Valid token | `GET https://api.github.com/user/repos?sort=updated` → up to 30 repos (default page size) |
| Invalid token | API error → logs → returns `[]` |
| Network error | Exception → logs → returns `[]` |

**Mock repos returned when no token:**
- `aira-workspace/AIRA` (TypeScript, 12 stars)
- `aira-workspace/payment-service` (Go, 8 stars)
- `aira-workspace/customer-portal` (JavaScript, 15 stars)

> **These repositories DO NOT EXIST on GitHub.** They are fabricated demonstration data.

### `get_github_issues(repo_full_name)`
| Scenario | Behavior |
|----------|----------|
| No `GITHUB_TOKEN` | Returns 3 hardcoded mock issues |
| Valid token | `GET https://api.github.com/repos/{repo}/issues?state=all` → filters out PRs |
| Repo defaults to | `settings.GITHUB_REPO` or `"aira-workspace/AIRA"` |
| PR filtering | `[item for item in res.json() if "pull_request" not in item]` — correct |

### `get_github_pulls(repo_full_name)`
| Scenario | Behavior |
|----------|----------|
| No `GITHUB_TOKEN` | Returns 2 hardcoded mock PRs |
| Valid token | `GET https://api.github.com/repos/{repo}/pulls?state=all` |

---

## What is NOT Implemented

| Feature | Status |
|---------|--------|
| Commit history | ❌ NOT IMPLEMENTED |
| File browsing/content | ❌ NOT IMPLEMENTED |
| Code search | ❌ NOT IMPLEMENTED |
| Webhook events | ❌ NOT IMPLEMENTED |
| Repository creation | ❌ NOT IMPLEMENTED |
| Issue creation | ❌ NOT IMPLEMENTED |
| PR creation/merge | ❌ NOT IMPLEMENTED |
| GitHub OAuth | ❌ NOT IMPLEMENTED (only PAT) |
| Rate limit handling | ❌ NOT IMPLEMENTED |
| Pagination | ❌ NOT IMPLEMENTED (only first page) |
| Repository-scoped token | ❌ Only user-level token supported |

---

## Mock Data Transparency

The mock data is clearly labeled in code with `logger.info("GitHub token not set. Returning mock...")`.

However, the **frontend has no indicator** that mock data is being displayed. A user looking at ProjectsPage would see:
- "AIRA" repository with 12 stars
- Issues and PRs that don't exist

Without a UI badge like "Mock Data — Set GITHUB_TOKEN for live data", this is misleading.

---

## Agent Integration

The Engineering Agent detects GitHub-related queries via keyword matching:
```python
if agent_id == "engineering" or any(kw in query.lower() for kw in ["github", "issue", "pr", "pull request", "repo"]):
    if "issue" in query.lower():
        → tool_get_github_issues()
    elif "pr" in query.lower() or "pull request" in query.lower():
        → tool_get_github_pulls()
    else:
        → tool_list_github_repos()
```

This works for basic use cases but is rigid — cannot handle compound queries or multi-repo queries.

---

## GitHub Integration Classification

| Aspect | Status |
|--------|--------|
| Token-based auth | ✅ IMPLEMENTED |
| Repos listing (real) | ✅ IMPLEMENTED |
| Issues listing (real) | ✅ IMPLEMENTED |
| PRs listing (real) | ✅ IMPLEMENTED |
| Mock fallback | ✅ IMPLEMENTED (declared, not hidden) |
| Frontend display | ✅ IMPLEMENTED |
| Agent integration | ✅ IMPLEMENTED |
| Rate limiting | ❌ MISSING |
| Pagination | ❌ MISSING |
| Commits/code | ❌ MISSING |
| Mock indicator in UI | ❌ MISSING |
| **Overall** | **PARTIALLY IMPLEMENTED** |
