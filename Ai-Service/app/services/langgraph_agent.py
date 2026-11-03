"""
LangGraph Agent Engine — AIRA AI Service (Phase F & G)
======================================================
Stateful, dynamic LLM tool-calling loop built on LangGraph.

Architecture:
    START ──► agent_reason ──(tool requested?)──► YES ──► execute_tool
                   │                                         │
                   ▼ (final_answer / max iter)               │
                finalize ◄───────────────────────────────────┘
                   │
                   ▼
                  END

Key Features:
- Typed AgentState: user_id, workspace_id, role, tool_calls, citations, steps.
- LLM-driven tool selection (no hardcoded if/elif routing).
- Bounded loop: MAX_TOOL_ITERATIONS = 8 to prevent infinite execution.
- Security-first tool execution: Backend/tool code strictly enforces user authorization,
  viewer read-only constraints, and workspace isolation before executing any tool.
- Sensitive credentials (raw_token) are never logged, never stored in graph artifacts,
  and never returned to frontend.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from app.core.config import settings
from app.services.bm25_service import search_bm25
from app.services.github_service import (
    get_github_issues,
    get_github_pulls,
    get_github_repos,
    get_github_tree,
    get_github_file_content,
)
from app.services.hybrid_search import hybrid_search
from app.services.llm_service import get_llm_response

logger = logging.getLogger(__name__)

MAX_TOOL_ITERATIONS = 8


# ── Agent State ───────────────────────────────────────────────────────────────

class AgentState(TypedDict):
    query: str
    agent_id: str
    agent_name: str
    user_id: str
    workspace_id: str
    role: str
    raw_token: str  # Transient auth token for backend tools — never logged or exposed
    conversation_id: Optional[str]
    messages: list[dict]
    tool_calls: list[dict]
    tool_results: list[dict]
    steps: list[str]
    iterations: int
    next_action: Optional[str]
    next_action_input: Optional[dict]
    final_answer: str
    task_created: Optional[dict]
    citations: list[dict]
    confidence: float
    error: Optional[str]
    status: str


# ── Available Tools Specification ─────────────────────────────────────────────

TOOL_SPECS = [
    {
        "name": "search_knowledge",
        "description": "Search the workspace knowledge base using hybrid retrieval for documents, specs, and internal guides.",
        "parameters": {"query": "string (the search query)"},
    },
    {
        "name": "summarize_document",
        "description": "Summarize a specific document from the knowledge base by filename.",
        "parameters": {"filename": "string (the document filename, e.g. architecture.pdf)"},
    },
    {
        "name": "list_github_repos",
        "description": "List GitHub repositories accessible to the workspace's connected GitHub account.",
        "parameters": {},
    },
    {
        "name": "get_github_issues",
        "description": "List open or closed issues in a workspace GitHub repository. Provide repo as 'owner/repo'.",
        "parameters": {
            "repo": "string (repository full name e.g. 'owner/repo')",
            "state": "string (optional: 'open', 'closed', or 'all')",
        },
    },
    {
        "name": "get_github_pulls",
        "description": "List pull requests in a workspace GitHub repository. Provide repo as 'owner/repo'.",
        "parameters": {
            "repo": "string (repository full name e.g. 'owner/repo')",
            "state": "string (optional: 'open', 'closed', or 'all')",
        },
    },
    {
        "name": "get_github_tree",
        "description": "Get the file and directory tree of a workspace GitHub repository. Provide repo as 'owner/repo'. Optional branch and path parameters.",
        "parameters": {
            "repo": "string (repository full name e.g. 'owner/repo')",
            "branch": "string (optional branch name, e.g. 'main' or 'master')",
            "path": "string (optional subpath prefix filter)",
        },
    },
    {
        "name": "get_github_file_content",
        "description": "Fetch the text content of a specific file from a workspace GitHub repository. Provide repo as 'owner/repo' and path to the file (e.g. 'package.json', 'README.md', 'backend/src/app.js').",
        "parameters": {
            "repo": "string (repository full name e.g. 'owner/repo')",
            "path": "string (relative file path in the repository)",
            "ref": "string (optional branch, tag, or commit SHA)",
        },
    },
    {
        "name": "create_task",
        "description": "Create a persistent task/action item in the workspace database. Viewers cannot create tasks. Supports assigning to current user and setting due dates.",
        "parameters": {
            "title": "string (task title, max 200 chars)",
            "description": "string (optional details, max 2000 chars)",
            "priority": "string ('low', 'medium', or 'high')",
            "due_date": "string (optional due date in YYYY-MM-DD or ISO 8601 format, e.g. '2026-11-05')",
            "assigned_to": "string (optional assignee: 'current_user' or 24-character user ID)",
        },
    },
    {
        "name": "list_tasks",
        "description": "List existing persisted tasks from the workspace database. Supports optional status or priority filtering.",
        "parameters": {
            "status": "string (optional filter: 'todo', 'in-progress', 'done')",
            "priority": "string (optional filter: 'low', 'medium', 'high')",
            "limit": "integer (optional, default 20)",
        },
    },
    {
        "name": "get_task",
        "description": "Get details of a single persisted task by its ID from the workspace database.",
        "parameters": {"task_id": "string (the task MongoDB ID)"},
    },
    {
        "name": "search_tasks",
        "description": "Search persisted workspace tasks by query string matching title or description in the database.",
        "parameters": {"query": "string (text to search for in task title or description)"},
    },
    {
        "name": "update_task",
        "description": "Update status, priority, title, description, due date, or assignee of an existing persisted task. Allowed status values: 'todo', 'in-progress', 'completed', 'cancelled'.",
        "parameters": {
            "task_id": "string (the task MongoDB ID)",
            "status": "string (optional new status: 'todo', 'in-progress', 'completed', 'cancelled')",
            "priority": "string (optional new priority: 'low', 'medium', 'high')",
            "title": "string (optional new title)",
            "description": "string (optional new description)",
            "due_date": "string (optional new due date, e.g. '2026-11-05')",
            "assigned_to": "string (optional assignee: 'current_user' or 24-character user ID)",
        },
    },
    {
        "name": "delete_task",
        "description": "Delete an existing persisted task by its ID from the workspace database.",
        "parameters": {"task_id": "string (the task MongoDB ID)"},
    },
]

TOOLS_PROMPT_STR = "\n".join([
    f"- {t['name']}: {t['description']} Arguments: {json.dumps(t['parameters'])}"
    for t in TOOL_SPECS
])


def _unescape_json_string(val: str) -> str:
    r"""
    Safely unescape JSON string escapes (\", \\, \n, \r, \t, \uXXXX)
    WITHOUT corrupting existing Unicode/UTF-8 characters (e.g. dashes, smart quotes, accents).
    """
    if not val:
        return ""
    try:
        sanitized = val.replace('\r\n', '\\n').replace('\r', '\\n').replace('\n', '\\n')
        return json.loads(f'"{sanitized}"', strict=False)
    except Exception:
        pass

    res = val.replace('\\"', '"').replace('\\\\', '\\').replace('\\/', '/')
    res = res.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t')
    def _replace_u(m: re.Match) -> str:
        try:
            return chr(int(m.group(1), 16))
        except Exception:
            return m.group(0)
    res = re.sub(r'\\u([0-9a-fA-F]{4})', _replace_u, res)
    return res


def sanitize_mojibake(text: str) -> str:
    """
    Safely fix known UTF-8/CP1252 mojibake artifacts without speculative global replacements
    that could corrupt legitimate Unicode characters (e.g. French 'château', German 'über').
    """
    if not text:
        return ""

    exact_map = {
        "\u00e2\x80\x93": "–",      # UTF-8 en-dash (0xE2 0x80 0x93)
        "\u00e2\x80\x94": "—",      # UTF-8 em-dash (0xE2 0x80 0x94)
        "\u00e2\x80\x98": "‘",      # UTF-8 left single quote
        "\u00e2\x80\x99": "’",      # UTF-8 right single quote
        "\u00e2\x80\x9c": "“",      # UTF-8 left double quote
        "\u00e2\x80\x9d": "”",      # UTF-8 right double quote
        "\u00e2\x80\xa2": "•",      # UTF-8 bullet
        "\u00e2\ufffd\ufffd": "–",  # UTF-8 en-dash corrupted by replacement chars
        "\u00e2\ufffd": "-",        # corrupted dash
    }
    for bad, good in exact_map.items():
        if bad in text:
            text = text.replace(bad, good)

    specific_tokens = {
        "bearer\u00e2token": "bearer-token",
        "bearer\u00e2\ufffdtoken": "bearer-token",
        "Multi\u00e2level": "Multi-level",
        "Multi\u00e2\ufffdlevel": "Multi-level",
        "multi\u00e2level": "multi-level",
        "multi\u00e2\ufffdlevel": "multi-level",
        "Role\u00e2Based": "Role-Based",
        "Role\u00e2\ufffdBased": "Role-Based",
        "role\u00e2based": "role-based",
        "role\u00e2\ufffdbased": "role-based",
    }
    for bad, good in specific_tokens.items():
        if bad in text:
            text = text.replace(bad, good)

    return text


def clean_parser_artifacts(text: str) -> str:
    """
    Remove leaked parser artifacts (such as an answer ending with a standalone '{'
    or unclosed tool-call / JSON stubs) WITHOUT deleting legitimate braces in code examples.
    """
    if not text:
        return ""
    s = text.rstrip()

    # Check if we are inside an unclosed code block (odd number of ```)
    fences = re.findall(r"```", s)
    if len(fences) % 2 == 1:
        # Check if the unclosed fence is just an empty trailing header like "\n```json" or "\n```"
        if re.search(r"\n\s*```(?:json)?\s*\{\s*$", s) or re.search(r"\n\s*```(?:json)?\s*$", s):
            s = re.sub(r"\n\s*```(?:json)?\s*\{\s*$", "", s)
            s = re.sub(r"\n\s*```(?:json)?\s*$", "", s)
            return s.rstrip()
        else:
            # Code block contains real content: cleanly close the fence
            return s + "\n```"

    # Outside code blocks (even number of ```):
    # Strip unclosed tool call stubs: e.g. \n{\s*"(action|name|arguments|thought|action_input)"...
    s = re.sub(r'\n\s*\{\s*"(?:action|name|arguments|thought|action_input|tool)"[\s\S]*$', "", s)

    # Strip trailing standalone brace outside code blocks: \n\s*{\s*$ or line ending with lonely {
    s = re.sub(r"(\n\s*|\s+)\{\s*$", "", s)

    return s.rstrip()


def _extract_text_from_answer(text: str) -> str:
    """Extract human-readable markdown text from potentially JSON-wrapped answers."""
    if not text:
        return ""
    s = text.strip()

    # Strip markdown code fences if present: ```json ... ``` or ``` ... ```
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", s)
    candidate_json = fence_match.group(1).strip() if fence_match else s

    d = None
    if (candidate_json.startswith("{") and candidate_json.endswith("}")) or (candidate_json.startswith("[") and candidate_json.endswith("]")):
        try:
            d = json.loads(candidate_json, strict=False)
        except Exception:
            try:
                sanitized = re.sub(r'[\x00-\x1f\x7f-\x9f]', lambda m: '\n' if m.group(0) == '\n' else ' ', candidate_json)
                d = json.loads(sanitized, strict=False)
            except Exception:
                d = None

    if isinstance(d, dict):
        for key in ("answer", "final_answer", "response", "content", "explanation", "summary", "text", "markdown"):
            val = d.get(key)
            if isinstance(val, str) and len(val.strip()) > 10:
                return _extract_text_from_answer(val.strip())

        action_in = d.get("action_input")
        if isinstance(action_in, dict):
            for k in ("answer", "final_answer", "response", "content", "explanation", "text", "summary"):
                inner = action_in.get(k)
                if isinstance(inner, str) and len(inner.strip()) > 10:
                    return _extract_text_from_answer(inner.strip())
        elif isinstance(action_in, str) and len(action_in.strip()) > 10:
            return _extract_text_from_answer(action_in.strip())

        args = d.get("arguments")
        if isinstance(args, dict):
            for k in ("answer", "final_answer", "response", "content", "explanation", "text", "summary"):
                inner = args.get(k)
                if isinstance(inner, str) and len(inner.strip()) > 10:
                    return _extract_text_from_answer(inner.strip())
        elif isinstance(args, str) and len(args.strip()) > 10:
            return _extract_text_from_answer(args.strip())

    # Regex extraction fallback if JSON parsing failed but key is visible
    for key in ("answer", "final_answer", "response", "content", "explanation", "summary", "text"):
        m = re.search(rf'"{key}"\s*:\s*"((?:\\.|[^"\\])+)"', s)
        if m:
            try:
                extracted = _unescape_json_string(m.group(1))
                if len(extracted.strip()) > 10:
                    return clean_parser_artifacts(sanitize_mojibake(extracted.strip()))
            except Exception:
                pass

    # Truncated JSON regex fallback: string value started after "answer": " but closing quote was cut off
    for key in ("answer", "final_answer", "response", "content", "explanation", "text"):
        m_trunc = re.search(rf'"{key}"\s*:\s*"([\s\S]*)$', s)
        if m_trunc:
            try:
                raw_chunk = m_trunc.group(1)
                raw_chunk = re.sub(r'"\s*\}\s*\}?\s*$', '', raw_chunk)
                extracted = _unescape_json_string(raw_chunk)
                if len(extracted.strip()) > 10:
                    return clean_parser_artifacts(sanitize_mojibake(extracted.strip()))
            except Exception:
                pass

    return clean_parser_artifacts(sanitize_mojibake(s))


def is_raw_tool_json(text: str) -> bool:
    """Detect if a string is an unresolved raw JSON tool-call / provider payload that must never leak to user."""
    if not text:
        return False
    s = text.strip()

    # Strip code fences to inspect inner payload
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", s)
    inspect_str = fence_match.group(1).strip() if fence_match else s

    if inspect_str.startswith("{") and inspect_str.endswith("}"):
        try:
            d = json.loads(inspect_str, strict=False)
            if isinstance(d, dict):
                # If it contains an actual substantive human answer in any common answer key, it is NOT a leaked tool stub
                for k in ("answer", "response", "content", "explanation", "final_answer", "text", "summary"):
                    if isinstance(d.get(k), str) and len(d[k].strip()) > 20:
                        return False
                if "action_input" in d:
                    ai = d["action_input"]
                    if isinstance(ai, dict):
                        for k in ("answer", "response", "content", "explanation", "final_answer", "text", "summary"):
                            if isinstance(ai.get(k), str) and len(ai[k].strip()) > 20:
                                return False
                    elif isinstance(ai, str) and len(ai.strip()) > 20:
                        return False

                # Check for tool call or internal payload signatures
                if any(k in d for k in ("name", "action", "action_input", "arguments", "thought", "cursor", "browser.open")):
                    return True
        except Exception:
            pass

    # Check for direct leaked stubs like {"action": "browser.open", ...}
    if re.search(r'\{\s*"action"\s*:\s*"(?:browser\.|tool_)', s):
        return True

    return False


def is_answer_incomplete(query: str, answer: str) -> bool:
    """
    Detect if an answer appears truncated, cut off mid-sentence,
    or missing explicitly requested structural sections from the user query.
    """
    if not answer or len(answer.strip()) < 20:
        return True

    text = answer.strip()

    # 1. Check for unclosed code block (odd number of ```)
    if text.count("```") % 2 != 0:
        return True

    # 2. Check for mid-sentence / abrupt punctuation cutoff or dangling parser artifact
    last_line = text.splitlines()[-1].strip() if text.splitlines() else ""
    if last_line == "{" or last_line.startswith("{") or last_line.endswith("{"):
        return True

    # Check for incomplete summary: heading exists but content is truncated right after
    if re.search(r'(?:###|##|\*\*)\s*Summary\b[\s\S]*$', text, re.IGNORECASE):
        summary_part = re.split(r'(?:###|##|\*\*)\s*Summary\b', text, flags=re.IGNORECASE)[-1].strip()
        if len(summary_part) < 20 or summary_part == "{":
            return True

    if last_line and not last_line.endswith((".", "!", "?", '"', "'", "```", "---", ")", "`", "]", "}", "*", "#")):
        dangling_endings = (
            " and", " or", " the", " a", " an", " with", " to", " from",
            " in", " at", " by", " for", " through", " where", " that",
            " which", ",", ";", ":", "-", "(", "["
        )
        if any(last_line.lower().endswith(d) for d in dangling_endings):
            return True

    # 3. Check for specific requested sections in the user query ONLY if structure was requested
    query_lower = query.lower()
    has_structure_request = any(
        kw in query_lower
        for kw in (
            "structure",
            "section",
            "break down",
            "categorize",
            "divide",
            "include each",
            "organized into",
            "identify its",
            "identify the",
            "identify frontend",
        )
    )

    if has_structure_request:
        key_sections = [
            ("frontend", ["frontend", "front-end", "client"]),
            ("backend", ["backend", "back-end", "server"]),
            ("technologies", ["technologies", "tech stack", "technology"]),
            ("endpoints", ["endpoint", "endpoints", "api"]),
            ("database", ["database", "db access", "db query", "mongodb", "sql", "data access"]),
            ("authentication", ["authentication", "auth", "jwt"]),
            ("request flow", ["request flow", "workflow"]),
            ("missing or undocumented", ["missing", "undocumented", "not establish", "not mentioned"]),
        ]

        for label, keywords in key_sections:
            if any(kw in query_lower for kw in keywords):
                # Check if answer contains a heading or bold label matching the requested section
                escaped_kws = [re.escape(kw) for kw in keywords]
                pattern = re.compile(rf"(?:###|##|\*\*)\s*(?:[0-9.]*\s*)?.*(?:{'|'.join(escaped_kws)})", re.IGNORECASE)
                if not pattern.search(text):
                    return True

    return False


# ── Tool Implementations (Secured & Scoped) ───────────────────────────────────

def _run_tool_search_knowledge(state: AgentState, args: dict) -> dict:
    raw_q = str(args.get("query") or state["query"]).strip()
    user_id = state.get("user_id", "")
    ws_id = state.get("workspace_id") or user_id

    # Deduplication check against prior search calls in the same run
    norm_q = re.sub(r"[^\w\s]", "", raw_q.lower()).strip()
    for tr in state.get("tool_results", []):
        if tr.get("tool") == "search_knowledge":
            prior_q = str(tr.get("result", {}).get("query", ""))
            prior_norm = re.sub(r"[^\w\s]", "", prior_q.lower()).strip()
            if norm_q and (norm_q == prior_norm or (len(norm_q) > 10 and norm_q in prior_norm) or (len(prior_norm) > 10 and prior_norm in norm_q)):
                logger.info("Deduplicating knowledge search query '%s' matching prior '%s'", raw_q, prior_q)
                cached = dict(tr.get("result", {}))
                cached["deduplicated"] = True
                return cached

    from app.services.reranker_service import clean_retrieval_query, rerank

    cleaned_q = clean_retrieval_query(raw_q)
    candidates = hybrid_search(cleaned_q, top_k=6, user_id=user_id, workspace_id=ws_id, mode="hybrid")
    if not candidates:
        return {"found": False, "results": [], "query": raw_q, "message": f"No documents matched query '{raw_q}'."}

    rerank_res = rerank(cleaned_q, candidates, top_k=3)
    results = rerank_res[0] if isinstance(rerank_res, tuple) else (rerank_res or candidates[:3])
    if not results:
        results = candidates[:3]

    snippets = []
    for r in results:
        score_val = r.get("pre_rerank_score") if r.get("pre_rerank_score") is not None else r.get("score", 0.0)
        snippets.append({
            "filename": r.get("filename", "unknown"),
            "chunk_index": r.get("chunk_index", 0),
            "text": r.get("text", "").strip()[:1500],
            "score": float(score_val),
            "rerank_score": float(r.get("score", score_val)),
            "raw_score": float(r.get("raw_score", 0.0)),
            "relevance_score": float(r.get("relevance_score", r.get("score", score_val))),
            "reranked": bool(r.get("reranked", True)),
        })

    return {
        "found": True,
        "query": raw_q,
        "results": snippets,
        "count": len(snippets),
        "message": f"Found {len(snippets)} relevant passages.",
    }


def _run_tool_summarize_document(state: AgentState, args: dict) -> dict:
    filename = str(args.get("filename") or "").strip()
    if not filename:
        return {"error": "filename parameter is required"}

    user_id = state.get("user_id", "")
    ws_id = state.get("workspace_id") or user_id

    results = search_bm25(filename, top_k=5, user_id=user_id, workspace_id=ws_id)
    doc_chunks = [r for r in results if filename.lower() in r.get("filename", "").lower()]
    if not doc_chunks:
        doc_chunks = results[:3]

    if not doc_chunks:
        return {"summary": f"Document '{filename}' not found in knowledge base.", "filename": filename}

    context = "\n\n".join([c["text"] for c in doc_chunks])
    summary = get_llm_response(
        "You are an expert summarizer. Provide a concise, informative summary of the document context.",
        f"Document: {filename}\n\nContent:\n{context}",
        max_tokens=512,
    )
    return {"summary": summary, "filename": filename, "chunks_used": len(doc_chunks)}


def _run_tool_github_repos(state: AgentState, args: dict) -> dict:
    raw_token = state.get("raw_token", "")
    ws_id = state.get("workspace_id") or ""
    try:
        return get_github_repos(raw_token=raw_token, workspace_id=ws_id)
    except Exception as exc:
        logger.error("_run_tool_github_repos failed: %s", exc)
        return {"error": str(exc), "count": 0, "repositories": []}


def _clean_repo_slug(val: Any) -> str:
    """
    Normalize repository strings, stripping URLs, .git suffixes, markdown fences,
    quotes, brackets, and sentence punctuation (trailing periods, commas, colons)
    while strictly preserving valid repository characters such as trailing hyphens.
    """
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


def _resolve_repo_argument(state: AgentState, args: dict) -> tuple[Optional[str], Optional[dict]]:
    """
    Safely resolve the repository full name (owner/repo) from:
    1. Authenticated workspace's live repository list (preferred for exact matches)
    2. args['repo'], args['repo_full_name'], args['repository']
    3. URL or owner/repo pattern in state['query']
    4. Auto-resolution if only 1 repository is connected to the workspace
    Prevents HTTP 400 and 404 bad requests from reaching GitHub API.
    """
    raw_token = state.get("raw_token", "")
    ws_id = state.get("workspace_id") or ""

    # 1. Collect available repositories from session state or live discovery
    available_repos: list[str] = []
    for tr in state.get("tool_results", []):
        tool_name = tr.get("tool")
        res = tr.get("result", {})
        if tool_name in ("list_github_repos", "repo_list_github_repos"):
            for r in res.get("repositories", res.get("repos", [])):
                fn = r.get("full_name")
                if not fn and isinstance(r.get("owner"), dict) and r.get("owner", {}).get("login") and r.get("name"):
                    fn = f"{r['owner']['login']}/{r['name']}"
                elif not fn and r.get("name"):
                    fn = r.get("name")
                if fn:
                    cleaned_fn = _clean_repo_slug(fn)
                    if cleaned_fn and cleaned_fn not in available_repos:
                        available_repos.append(cleaned_fn)
        elif tool_name in (
            "get_github_tree",
            "repo_get_github_tree",
            "get_github_file_content",
            "repo_get_github_file_content",
            "get_github_issues",
            "get_github_pulls",
        ):
            fn = res.get("repository")
            if fn:
                cleaned_fn = _clean_repo_slug(fn)
                if cleaned_fn and cleaned_fn not in available_repos:
                    available_repos.append(cleaned_fn)

    if not available_repos and raw_token:
        try:
            live_res = get_github_repos(raw_token=raw_token, workspace_id=ws_id)
            if isinstance(live_res, list):
                repos_list = live_res
            elif isinstance(live_res, dict) and not live_res.get("error"):
                repos_list = live_res.get("repositories", live_res.get("repos", []))
            else:
                repos_list = []
            for r in repos_list:
                if not isinstance(r, dict):
                    continue
                fn = r.get("full_name")
                if not fn and isinstance(r.get("owner"), dict) and r.get("owner", {}).get("login") and r.get("name"):
                    fn = f"{r['owner']['login']}/{r['name']}"
                elif not fn and r.get("name"):
                    fn = r.get("name")
                if fn:
                    cleaned_fn = _clean_repo_slug(fn)
                    if cleaned_fn and cleaned_fn not in available_repos:
                        available_repos.append(cleaned_fn)
        except Exception as e:
            logger.warning("_resolve_repo_argument: error probing get_github_repos: %s", e)

    # 2. Extract candidate repo from args or query
    raw_repo = args.get("repo") or args.get("repo_full_name") or args.get("repository")
    cleaned_repo = _clean_repo_slug(raw_repo)

    query_text = state.get("query", "")
    if not cleaned_repo and query_text:
        url_match = re.search(r'https?://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)', query_text)
        if url_match:
            cleaned_repo = _clean_repo_slug(url_match.group(1))
        else:
            slug_match = re.search(r'([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)', query_text)
            if slug_match:
                cleaned_repo = _clean_repo_slug(slug_match.group(1))

    # 3. Prefer an exact repository full_name from the authenticated workspace's live repository list
    if available_repos:
        if cleaned_repo:
            for r in available_repos:
                if r == cleaned_repo or r.lower() == cleaned_repo.lower():
                    return r, None

            # Check if cleaned_repo matches the short name (repo name part)
            target_short = cleaned_repo.split("/")[-1].lower() if "/" in cleaned_repo else cleaned_repo.lower()
            target_short_clean = target_short.strip(".-_")
            target_short_alnum = re.sub(r"[^a-z0-9]", "", target_short)

            short_matches = [
                r for r in available_repos
                if r.split("/")[-1].lower() == target_short
                or r.split("/")[-1].lower().strip(".-_") == target_short_clean
                or (target_short_alnum and re.sub(r"[^a-z0-9]", "", r.split("/")[-1].lower()) == target_short_alnum)
            ]
            if len(short_matches) == 1:
                return short_matches[0], None

            # Substring match against available repos
            sub_matches = [
                r for r in available_repos
                if cleaned_repo.lower() in r.lower()
                or r.lower() in cleaned_repo.lower()
                or target_short_clean in r.lower()
            ]
            if len(sub_matches) == 1:
                return sub_matches[0], None
            if len(sub_matches) > 1:
                exact_sub = [
                    r for r in sub_matches
                    if target_short == r.split('/')[-1].lower()
                    or target_short_clean == r.split('/')[-1].lower().strip(".-_")
                ]
                if len(exact_sub) == 1:
                    return exact_sub[0], None
                return None, {
                    "error": f"Ambiguous repository '{cleaned_repo}'. Matching options: {', '.join(sub_matches)}. Please specify 'owner/repo'."
                }

        # If repo was not in args, look for available repo names in query_text
        if not cleaned_repo and query_text:
            q_lower = query_text.lower()
            q_alnum = re.sub(r"[^a-z0-9]", "", q_lower)
            full_matches = [
                r for r in available_repos
                if r.lower() in q_lower or (q_alnum and re.sub(r"[^a-z0-9]", "", r.lower()) in q_alnum)
            ]
            if len(full_matches) == 1:
                return full_matches[0], None

            short_query_matches = [
                r for r in available_repos
                if (r.split("/")[-1].lower() in q_lower)
                or (r.split("/")[-1].lower().strip(".-_") in q_lower)
                or (q_alnum and re.sub(r"[^a-z0-9]", "", r.split("/")[-1].lower()) in q_alnum)
            ]
            if len(short_query_matches) == 1:
                return short_query_matches[0], None

        # Auto-resolve if only 1 repository in workspace
        if not cleaned_repo and len(available_repos) == 1:
            return available_repos[0], None

        if not cleaned_repo and len(available_repos) > 1:
            return None, {
                "error": f"Multiple repositories found: {', '.join(available_repos)}. Please specify which repository to query in the format 'owner/repo'."
            }

    # 4. If no available_repos or no match, fall back to valid cleaned_repo
    if cleaned_repo and "/" in cleaned_repo:
        return cleaned_repo, None

    if cleaned_repo:
        return None, {
            "error": f"Could not resolve repository '{cleaned_repo}'. Please specify the full name in 'owner/repo' format."
        }

    return None, {
        "error": "Missing required repository parameter 'repo' in 'owner/repo' format. Call list_github_repos to inspect available repositories."
    }


def _run_tool_github_issues(state: AgentState, args: dict) -> dict:
    raw_token = state.get("raw_token", "")
    ws_id = state.get("workspace_id") or ""
    st = str(args.get("state") or "all")
    repo, err = _resolve_repo_argument(state, args)
    if err:
        return err
    try:
        return get_github_issues(raw_token=raw_token, repo_full_name=repo, state=st, workspace_id=ws_id)
    except Exception as exc:
        logger.error("_run_tool_github_issues failed: %s", exc)
        return {"error": str(exc), "repository": repo, "success": False}


def _run_tool_github_pulls(state: AgentState, args: dict) -> dict:
    raw_token = state.get("raw_token", "")
    ws_id = state.get("workspace_id") or ""
    st = str(args.get("state") or "all")
    repo, err = _resolve_repo_argument(state, args)
    if err:
        return err
    try:
        return get_github_pulls(raw_token=raw_token, repo_full_name=repo, state=st, workspace_id=ws_id)
    except Exception as exc:
        logger.error("_run_tool_github_pulls failed: %s", exc)
        return {"error": str(exc), "repository": repo, "success": False}


def _run_tool_github_tree(state: AgentState, args: dict) -> dict:
    raw_token = state.get("raw_token", "")
    ws_id = state.get("workspace_id") or ""
    repo, err = _resolve_repo_argument(state, args)
    if err:
        logger.warning("_run_tool_github_tree: could not resolve repo for args %s: %s", args, err)
        return err
    branch = args.get("branch") or args.get("ref")
    path = args.get("path")
    logger.info("_run_tool_github_tree: executing get_github_tree for repo=%s branch=%s path=%s", repo, branch, path)
    try:
        res = get_github_tree(
            raw_token=raw_token,
            repo_full_name=repo,
            branch=branch,
            path=path,
            workspace_id=ws_id,
        )
        logger.info("_run_tool_github_tree: successfully fetched %d tree items for %s", res.get("count", len(res.get("tree", []))), repo)
        return res
    except Exception as exc:
        logger.error("_run_tool_github_tree failed for %s: %s", repo, exc)
        return {"error": str(exc), "repository": repo, "success": False}


def _run_tool_github_file_content(state: AgentState, args: dict) -> dict:
    raw_token = state.get("raw_token", "")
    ws_id = state.get("workspace_id") or ""
    repo, err = _resolve_repo_argument(state, args)
    if err:
        logger.warning("_run_tool_github_file_content: could not resolve repo for args %s: %s", args, err)
        return err
    file_path = str(
        args.get("path")
        or args.get("file")
        or args.get("filepath")
        or args.get("filename")
        or ""
    ).strip()
    if not file_path:
        return {
            "error": "Missing required 'path' parameter for get_github_file_content.",
            "repository": repo,
            "success": False,
        }
    ref = args.get("ref") or args.get("branch")
    logger.info("_run_tool_github_file_content: executing get_github_file_content for repo=%s path=%s ref=%s", repo, file_path, ref)
    try:
        res = get_github_file_content(
            raw_token=raw_token,
            repo_full_name=repo,
            path=file_path,
            ref=ref,
            workspace_id=ws_id,
        )
        logger.info("_run_tool_github_file_content: successfully fetched file %s from %s (%d chars)", file_path, repo, len(res.get("content", "")))
        return res
    except Exception as exc:
        logger.error("_run_tool_github_file_content failed for %s/%s: %s", repo, file_path, exc)
        return {"error": str(exc), "repository": repo, "path": file_path, "success": False}


def _resolve_task_id(state: AgentState, args: dict) -> str:
    """Safely resolve task_id from args, query regex, or prior create_task / list_tasks results."""
    tid = str(args.get("task_id") or args.get("id") or args.get("_id") or "").strip()
    if tid and not (tid.startswith("<") and tid.endswith(">")) and tid.lower() not in ("task_id", "undefined", "null", "none"):
        return tid

    # Check state task_created
    if state.get("task_created") and isinstance(state["task_created"], dict):
        created_tid = state["task_created"].get("task_id") or state["task_created"].get("id") or state["task_created"].get("_id")
        if created_tid:
            return str(created_tid)

    # Check query for explicit 24-hex ObjectId
    q = state.get("query", "")
    hex_match = re.search(r'\b([0-9a-fA-F]{24})\b', q)
    if hex_match:
        return hex_match.group(1)

    # Check prior tool_results
    for tr in reversed(state.get("tool_results", [])):
        res = tr.get("result", {})
        if tr.get("tool") == "create_task":
            candidate = res.get("task_id") or res.get("id") or (res.get("task") or {}).get("_id")
            if candidate:
                return str(candidate)
        if tr.get("tool") in ("list_tasks", "search_tasks"):
            tasks = res.get("tasks", [])
            target_title = str(args.get("title") or "").lower()
            if target_title and tasks:
                for t in tasks:
                    if target_title in str(t.get("title", "")).lower():
                        return str(t.get("task_id") or t.get("_id") or t.get("id"))
            if len(tasks) == 1:
                return str(tasks[0].get("task_id") or tasks[0].get("_id") or tasks[0].get("id"))
    return tid


def _run_tool_create_task(state: AgentState, args: dict) -> dict:
    from app.services.agent_service import tool_create_task

    role = state.get("role", "member")
    if role == "viewer":
        return {
            "task_created": False,
            "error": "Forbidden: Viewers have read-only access and cannot create tasks.",
        }

    # Guard: prevent duplicate create_task calls within the same session
    already_created = any(
        tr.get("tool") == "create_task" and tr.get("result", {}).get("task_created")
        for tr in state.get("tool_results", [])
    )
    if already_created:
        # Return the existing task result rather than creating again
        for tr in reversed(state.get("tool_results", [])):
            if tr.get("tool") == "create_task" and tr.get("result", {}).get("task_created"):
                existing = tr["result"]
                logger.warning(
                    "_run_tool_create_task: duplicate create_task call blocked; returning existing task_id=%s",
                    existing.get("task_id"),
                )
                return {**existing, "message": f"Task already created (ID: {existing.get('task_id')}). Skipping duplicate creation."}

    title = str(args.get("title") or state["query"][:200]).strip()
    description = str(args.get("description") or "").strip()
    priority = str(args.get("priority") or "medium").lower()

    # Resolve due_date from multiple possible key names
    due_date = (
        args.get("due_date")
        or args.get("dueDate")
        or args.get("due")
        or args.get("deadline")
    )
    if not due_date:
        date_match = re.search(r'\b(20\d\d-\d{2}-\d{2})\b', state.get("query", ""))
        if date_match:
            due_date = date_match.group(1)

    # Resolve assigned_to from multiple possible key names; map "current_user" aliases
    raw_assignee = (
        args.get("assigned_to")
        or args.get("assignee")
        or args.get("assignedTo")
        or args.get("assign_to")
    )
    assigned_to: str | None = None
    if raw_assignee is not None:
        a_str = str(raw_assignee).strip()
        if a_str.lower() in ("current_user", "current-user", "current user", "me", "self", "myself"):
            # Map to authenticated user id from state
            assigned_to = state.get("user_id") or "current_user"
        elif a_str.lower() not in ("null", "none", "undefined", ""):
            assigned_to = a_str  # pass-through; tool_create_task validates format
    if not assigned_to:
        q_lower = state.get("query", "").lower()
        if any(p in q_lower for p in ("current user", "to me", "myself", "assign to me", "assign it to me", "assign me")):
            assigned_to = state.get("user_id") or "current_user"

    if not args.get("priority"):
        q_lower = state.get("query", "").lower()
        if "high" in q_lower and "priority" in q_lower:
            priority = "high"
        elif "low" in q_lower and "priority" in q_lower:
            priority = "low"
        elif "medium" in q_lower and "priority" in q_lower:
            priority = "medium"

    if not args.get("title"):
        title_match = re.search(r'(?:titled?|called|named)\s+["\']([^"\']+)["\']', state.get("query", ""), re.IGNORECASE)
        if title_match:
            title = title_match.group(1).strip()

    if not args.get("description"):
        desc_match = re.search(r'(?:description|with description)\s*(?::|\s)\s*["\']([^"\']+)["\']', state.get("query", ""), re.IGNORECASE)
        if desc_match:
            description = desc_match.group(1).strip()

    logger.info(
        "_run_tool_create_task: creating task title=%r priority=%r due_date=%r assigned_to=%r",
        title[:60], priority, due_date, assigned_to,
    )

    return tool_create_task(
        title=title,
        description=description,
        priority=priority,
        due_date=due_date,
        assigned_to=assigned_to,
        raw_token=state.get("raw_token", ""),
        conversation_id=state.get("conversation_id"),
    )


def _run_tool_list_tasks(state: AgentState, args: dict) -> dict:
    from app.services.agent_service import tool_list_tasks
    return tool_list_tasks(
        status=args.get("status"),
        priority=args.get("priority"),
        limit=int(args.get("limit", 20)),
        raw_token=state.get("raw_token", ""),
    )


def _run_tool_get_task(state: AgentState, args: dict) -> dict:
    from app.services.agent_service import tool_get_task
    task_id = _resolve_task_id(state, args)
    return tool_get_task(task_id=task_id, raw_token=state.get("raw_token", ""))


def _run_tool_search_tasks(state: AgentState, args: dict) -> dict:
    from app.services.agent_service import tool_search_tasks
    q = str(args.get("query") or state.get("query", "")).strip()
    return tool_search_tasks(query=q, raw_token=state.get("raw_token", ""))


def _run_tool_update_task(state: AgentState, args: dict) -> dict:
    from app.services.agent_service import tool_update_task
    role = state.get("role", "member")
    if role == "viewer":
        return {
            "task_updated": False,
            "error": "Forbidden: Viewers have read-only access and cannot update tasks.",
        }
    task_id = _resolve_task_id(state, args)

    # Extract status with aliases or fallback to query keywords
    status = (
        args.get("status")
        or args.get("new_status")
        or args.get("state")
        or args.get("task_status")
    )
    if not status:
        q_lower = state.get("query", "").lower()
        if any(w in q_lower for w in ("in-progress", "in_progress", "inprogress", "doing")):
            status = "in_progress"
        elif any(w in q_lower for w in ("completed", "complete", "done")):
            status = "completed"
        elif any(w in q_lower for w in ("todo", "to-do", "to_do", "pending")):
            status = "todo"
        elif any(w in q_lower for w in ("cancelled", "canceled")):
            status = "cancelled"

    priority = args.get("priority") or args.get("new_priority")
    title = args.get("title") or args.get("new_title")
    description = args.get("description") or args.get("new_description")

    # Resolve due_date from multiple possible key names
    due_date = (
        args.get("due_date")
        or args.get("dueDate")
        or args.get("due")
        or args.get("deadline")
    )

    # Resolve assigned_to and map current-user aliases to actual user id
    raw_assignee = (
        args.get("assigned_to")
        or args.get("assignee")
        or args.get("assignedTo")
        or args.get("assign_to")
    )
    assigned_to: str | None = None
    if raw_assignee is not None:
        a_str = str(raw_assignee).strip()
        if a_str.lower() in ("current_user", "current-user", "current user", "me", "self"):
            assigned_to = state.get("user_id") or "current_user"
        elif a_str.lower() not in ("null", "none", "undefined", ""):
            assigned_to = a_str

    return tool_update_task(
        task_id=task_id,
        title=title,
        description=description,
        status=status,
        priority=priority,
        due_date=due_date,
        assigned_to=assigned_to,
        raw_token=state.get("raw_token", ""),
    )


def _run_tool_delete_task(state: AgentState, args: dict) -> dict:
    from app.services.agent_service import tool_delete_task

    role = state.get("role", "member")
    if role == "viewer":
        return {
            "deleted": False,
            "error": "Forbidden: Viewers have read-only access and cannot delete tasks.",
        }
    task_id = _resolve_task_id(state, args)
    return tool_delete_task(task_id=task_id, raw_token=state.get("raw_token", ""))


ACTION_ALIASES: dict[str, str] = {
    # Repository listing aliases
    "repo_list_github_repos": "list_github_repos",
    "repo_list": "list_github_repos",
    "github_list_repos": "list_github_repos",
    "list_repos": "list_github_repos",
    "list_repositories": "list_github_repos",
    "get_github_repos": "list_github_repos",
    "get_repos": "list_github_repos",
    "get_repositories": "list_github_repos",
    "github_repos": "list_github_repos",
    "repo_browser.list_github_repos": "list_github_repos",
    "browser.list_github_repos": "list_github_repos",

    # Issues aliases
    "repo_get_github_issues": "get_github_issues",
    "github_get_issues": "get_github_issues",
    "list_github_issues": "get_github_issues",
    "get_issues": "get_github_issues",
    "list_issues": "get_github_issues",
    "github_issues": "get_github_issues",
    "repo_issues": "get_github_issues",
    "get_repo_issues": "get_github_issues",
    "list_repo_issues": "get_github_issues",
    "fetch_issues": "get_github_issues",
    "fetch_github_issues": "get_github_issues",
    "repo_browser.get_github_issues": "get_github_issues",
    "browser.get_github_issues": "get_github_issues",

    # Pull requests aliases
    "repo_get_github_pulls": "get_github_pulls",
    "github_get_pulls": "get_github_pulls",
    "list_github_pulls": "get_github_pulls",
    "get_github_prs": "get_github_pulls",
    "list_github_prs": "get_github_pulls",
    "get_pulls": "get_github_pulls",
    "get_prs": "get_github_pulls",
    "list_pulls": "get_github_pulls",
    "list_prs": "get_github_pulls",
    "github_pulls": "get_github_pulls",
    "github_prs": "get_github_pulls",
    "get_pull_requests": "get_github_pulls",
    "list_pull_requests": "get_github_pulls",
    "get_github_pull_requests": "get_github_pulls",
    "list_github_pull_requests": "get_github_pulls",
    "repo_pulls": "get_github_pulls",
    "repo_prs": "get_github_pulls",
    "repo_pull_requests": "get_github_pulls",
    "fetch_pulls": "get_github_pulls",
    "fetch_prs": "get_github_pulls",
    "repo_browser.get_github_pulls": "get_github_pulls",
    "browser.get_github_pulls": "get_github_pulls",

    # Repository tree aliases
    "repo_get_github_tree": "get_github_tree",
    "github_get_tree": "get_github_tree",
    "get_tree": "get_github_tree",
    "list_tree": "get_github_tree",
    "github_tree": "get_github_tree",
    "repo_tree": "get_github_tree",
    "get_repo_tree": "get_github_tree",
    "list_files": "get_github_tree",
    "list_repo_files": "get_github_tree",
    "get_files": "get_github_tree",
    "get_repo_files": "get_github_tree",
    "repo_files": "get_github_tree",
    "repo_browser.get_github_tree": "get_github_tree",
    "browser.get_github_tree": "get_github_tree",

    # Repository file content aliases
    "repo_get_github_file_content": "get_github_file_content",
    "github_get_file_content": "get_github_file_content",
    "get_github_file": "get_github_file_content",
    "get_file": "get_github_file_content",
    "get_file_content": "get_github_file_content",
    "read_file": "get_github_file_content",
    "read_github_file": "get_github_file_content",
    "read_repo_file": "get_github_file_content",
    "github_file": "get_github_file_content",
    "fetch_file": "get_github_file_content",
    "get_content": "get_github_file_content",
    "get_github_content": "get_github_file_content",
    "repo_browser.get_github_file_content": "get_github_file_content",
    "browser.get_github_file_content": "get_github_file_content",

    "remove_task": "delete_task",
    "destroy_task": "delete_task",
}

def normalize_action_name(action: str) -> str:
    """Normalize tool names, resolving model aliases and removing spurious prefixes."""
    if not action:
        return "final_answer"
    act = action.strip()
    if act in ACTION_ALIASES:
        return ACTION_ALIASES[act]

    # Strip provider/tool prefixes (e.g. repo_browser., browser., repo_, tool.)
    for prefix in ("repo_browser.", "browser.", "repo_", "tool_"):
        if act.startswith(prefix):
            candidate = act[len(prefix):]
            if candidate in ACTION_ALIASES:
                return ACTION_ALIASES[candidate]
            if candidate in TOOL_RUNNERS:
                return candidate

    # Suffix or keyword matching for known registered tools
    act_lower = act.lower()
    if "list_github_repos" in act_lower or ("list" in act_lower and "repo" in act_lower and "github" in act_lower):
        return "list_github_repos"
    if "get_github_issues" in act_lower or ("issue" in act_lower and ("github" in act_lower or "repo" in act_lower)):
        return "get_github_issues"
    if "get_github_pulls" in act_lower or (("pull" in act_lower or "pr" in act_lower) and ("github" in act_lower or "repo" in act_lower)):
        return "get_github_pulls"
    if "get_github_tree" in act_lower or ("tree" in act_lower and ("github" in act_lower or "repo" in act_lower)) or ("files" in act_lower and ("list" in act_lower or "tree" in act_lower) and "github" in act_lower):
        return "get_github_tree"
    if "get_github_file_content" in act_lower or ("file" in act_lower and ("content" in act_lower or "read" in act_lower or "fetch" in act_lower) and "github" in act_lower):
        return "get_github_file_content"

    return act


TOOL_RUNNERS = {
    "search_knowledge": _run_tool_search_knowledge,
    "summarize_document": _run_tool_summarize_document,
    "list_github_repos": _run_tool_github_repos,
    "get_github_issues": _run_tool_github_issues,
    "get_github_pulls": _run_tool_github_pulls,
    "get_github_tree": _run_tool_github_tree,
    "get_github_file_content": _run_tool_github_file_content,
    "create_task": _run_tool_create_task,
    "list_tasks": _run_tool_list_tasks,
    "get_task": _run_tool_get_task,
    "search_tasks": _run_tool_search_tasks,
    "update_task": _run_tool_update_task,
    "delete_task": _run_tool_delete_task,
}

# Register aliases in TOOL_RUNNERS as well for direct runner lookups
for alias, target in ACTION_ALIASES.items():
    if target in TOOL_RUNNERS and alias not in TOOL_RUNNERS:
        TOOL_RUNNERS[alias] = TOOL_RUNNERS[target]


def _select_next_arch_file(paths: list[str], read_files: set[str]) -> Optional[str]:
    """
    Select the next most valuable file to inspect for repository architecture analysis.
    Prioritizes configuration/manifests, entry points, and routers across frontend, backend, and AI service.
    """
    normalized_read = {str(rf).lower().strip("/\\") for rf in read_files if rf}

    # Priority candidates designed to cover backend, frontend, AI service, entry points, and docs
    priority_candidates = [
        "backend/package.json",
        "frontend/package.json",
        "ai-service/app/main.py",
        "ai-service/requirements.txt",
        "readme.md",
        "backend/server.js",
        "backend/src/app.js",
        "backend/src/server.js",
        "backend/src/routes/github.js",
        "backend/src/routes/auth.js",
        "frontend/src/app.tsx",
        "frontend/src/app.jsx",
        "frontend/src/services/api.ts",
        "package.json",
    ]

    for cand in priority_candidates:
        matched = next(
            (p for p in paths if p and p.lower().strip("/\\") == cand and p.lower().strip("/\\") not in normalized_read),
            None,
        )
        if matched:
            return matched

    # Fallback to any unread manifest or entry point
    for p in paths:
        if not p:
            continue
        p_clean = p.lower().strip("/\\")
        if p_clean in normalized_read:
            continue
        if p_clean.endswith("package.json") or p_clean.endswith("requirements.txt") or p_clean.endswith("dockerfile"):
            return p
        if p_clean.endswith("main.py") or p_clean.endswith("server.js") or p_clean.endswith("app.js") or p_clean.endswith("app.tsx"):
            return p

    return None


# ── LangGraph Nodes ───────────────────────────────────────────────────────────

def agent_reason_node(state: AgentState) -> dict:
    """
    LLM reasoning node: Decides what tool to call next or whether to produce the final answer.
    """
    current_iter = state.get("iterations", 0) + 1
    steps = list(state.get("steps", []))

    # Build history of prior tool calls and observations
    scratchpad_lines = []
    for tc, tr in zip(state.get("tool_calls", []), state.get("tool_results", [])):
        scratchpad_lines.append(f"Tool Called: {tc['tool']}")
        scratchpad_lines.append(f"Arguments: {json.dumps(tc.get('arguments', {}))}")
        obs_str = json.dumps(tr.get('result', {}))
        if len(obs_str) > 2500:
            obs_str = obs_str[:2500] + "... (truncated)"
        scratchpad_lines.append(f"Observation: {obs_str}")
    scratchpad = "\n".join(scratchpad_lines) if scratchpad_lines else "None yet."

    has_successful_knowledge = any(
        tr.get("tool") == "search_knowledge" and (tr.get("result", {}).get("found") or bool(tr.get("result", {}).get("results")))
        for tr in state.get("tool_results", [])
    )

    system_prompt = f"""You are the AIRA {state.get('agent_name', 'Agent')}.
You have access to the following tools:
{TOOLS_PROMPT_STR}

To call a tool, respond with ONLY a valid JSON object in this exact format:
{{
  "thought": "Your step-by-step reasoning about what info is needed",
  "action": "tool_name",
  "action_input": {{ "arg1": "value" }}
}}

If you have sufficient information to answer the user or no tool is needed, respond with:
{{
  "thought": "I have enough information to answer",
  "action": "final_answer",
  "action_input": {{ "answer": "Your full, comprehensive markdown answer" }}
}}

IMPORTANT:
- Respond ONLY with the JSON object. Do not include markdown codeblocks or extra text.
- If you have retrieved relevant passages or data from tools, DO NOT keep calling the same tool or similar searches repeatedly. Immediately synthesize and return "action": "final_answer".
- If the user asks about GitHub repositories, call list_github_repos.
- If the user asks about GitHub issues, call get_github_issues (passing 'repo' in 'owner/repo' format from list_github_repos).
- If the user asks about GitHub pull requests, call get_github_pulls (passing 'repo' in 'owner/repo' format from list_github_repos).
- If the user asks to explain a repository architecture, inspect repository files, or check codebase structure, call get_github_tree to inspect the file hierarchy, and sequentially call get_github_file_content to inspect key configuration and code files (e.g. backend/package.json, frontend/package.json, Ai-Service/app/main.py, README.md). You MUST inspect these files before formulating your final architecture answer.
- When explaining repository architecture, identify its frontend, backend services, main technologies, and important API endpoints using actual GitHub repository data, and cite the exact files used.
- If get_github_issues, get_github_pulls, get_github_tree, or get_github_file_content returned an error, report the actual error clearly. NEVER state there are 0 issues or 0 pull requests or fabricate repository data when an error occurred.
- If the user asks about documents, project specs, or guidelines, call search_knowledge.
- If the user asks to find, list, search, or check existing tasks, call list_tasks, get_task, or search_tasks. NEVER call search_knowledge for tasks.
- If the user asks to create a task, call create_task ONCE with all available fields: title, description, priority, due_date (YYYY-MM-DD), assigned_to ('current_user' for the authenticated user, or a specific user ID). After a successful create_task, call get_task with the returned task_id to verify persistence. Then produce final_answer with all verified task details. NEVER call create_task more than once per request.
- If the user asks to update a task, call update_task.
- Never output raw tool-call payloads (e.g. browser.open or raw JSON) as your final answer."""

    if has_successful_knowledge:
        system_prompt += "\n- NOTE: You have already retrieved relevant knowledge base passages. Do NOT call search_knowledge again. Formulate your comprehensive final_answer now."

    user_prompt = f"""User Request: {state['query']}

Scratchpad / Prior Tool Observations:
{scratchpad}

What is your next action?"""

    raw_output = ""
    try:
        raw_output = get_llm_response(system_prompt, user_prompt, max_tokens=1024)
        fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_output.strip())
        candidate_json = fence_match.group(1).strip() if fence_match else raw_output.strip()

        try:
            parsed = json.loads(candidate_json, strict=False)
        except Exception:
            try:
                sanitized = re.sub(r'[\x00-\x1f\x7f-\x9f]', lambda m: '\n' if m.group(0) == '\n' else ' ', candidate_json)
                parsed = json.loads(sanitized, strict=False)
            except Exception:
                text_lower = raw_output.lower()
                detected_action = None
                action_match = re.search(r'"action"\s*:\s*"([a-zA-Z0-9_]+)"', raw_output)
                if action_match:
                    detected_action = action_match.group(1)
                elif "final_answer" in text_lower or "final answer" in text_lower:
                    detected_action = "final_answer"
                elif "list_github_repos" in text_lower or ("list" in text_lower and "repo" in text_lower and "github" in text_lower):
                    detected_action = "list_github_repos"
                elif "get_github_issues" in text_lower or ("issue" in text_lower and "github" in text_lower):
                    detected_action = "get_github_issues"
                elif "get_github_pulls" in text_lower or ("pull" in text_lower and "github" in text_lower) or ("pr" in text_lower and "github" in text_lower):
                    detected_action = "get_github_pulls"
                elif "get_github_tree" in text_lower or ("tree" in text_lower and "github" in text_lower):
                    detected_action = "get_github_tree"
                elif "get_github_file_content" in text_lower or ("file" in text_lower and "content" in text_lower and "github" in text_lower):
                    detected_action = "get_github_file_content"
                elif "search_knowledge" in text_lower:
                    detected_action = "search_knowledge"
                elif "update_task" in text_lower or ("update" in text_lower and "task" in text_lower):
                    detected_action = "update_task"
                elif "delete_task" in text_lower or ("delete" in text_lower and "task" in text_lower):
                    detected_action = "delete_task"
                elif "get_task" in text_lower or (any(w in text_lower for w in ("get", "retrieve", "view", "show", "details", "fetch")) and "task" in text_lower and re.search(r'\b[0-9a-fA-F]{24}\b', state.get("query", ""))):
                    detected_action = "get_task"
                elif "list_tasks" in text_lower:
                    detected_action = "list_tasks"
                elif "create_task" in text_lower:
                    detected_action = "create_task"

                if detected_action:
                    logger.info("agent_reason_node: inferred action '%s' from non-JSON output", detected_action)
                    parsed = {
                        "thought": raw_output[:200],
                        "action": detected_action,
                        "action_input": {},
                    }
                else:
                    raise

        thought = parsed.get("thought", "")
        action = parsed.get("action") or parsed.get("name") or "final_answer"
        action_input = parsed.get("action_input") if "action_input" in parsed else parsed.get("arguments", {})

        # Normalize action aliases (e.g. repo_list_github_repos -> list_github_repos)
        normalized = normalize_action_name(action)
        if normalized != action:
            logger.info("agent_reason_node: normalized action '%s' -> canonical '%s'", action, normalized)
            action = normalized

        if thought:
            steps.append(f"💭 {thought}")

        # Normalization and resolution of final_answer inputs
        if action == "final_answer":
            if not action_input:
                for k in ("answer", "final_answer", "response", "content", "explanation", "summary", "text"):
                    if k in parsed and parsed[k]:
                        action_input = {"answer": parsed[k]}
                        break
            elif isinstance(action_input, str):
                action_input = {"answer": action_input}
            elif isinstance(action_input, dict) and "answer" not in action_input:
                for k in ("final_answer", "response", "content", "explanation", "summary", "text"):
                    if k in action_input and action_input[k]:
                        action_input["answer"] = action_input[k]
                        break

        # Redundant search guard: If knowledge was already retrieved, redirect redundant search to final_answer synthesis
        if action == "search_knowledge" and has_successful_knowledge:
            logger.info("agent_reason_node: knowledge already retrieved; redirecting redundant search to final_answer synthesis.")
            action = "final_answer"
            if not action_input or not isinstance(action_input, dict) or not action_input.get("answer"):
                action_input = {"answer": ""}

        # Duplicate create_task guard: prevent creating a task more than once per session
        if action == "create_task":
            already_created = any(
                tr.get("tool") == "create_task" and tr.get("result", {}).get("task_created")
                for tr in state.get("tool_results", [])
            )
            if already_created:
                logger.warning("agent_reason_node: duplicate create_task blocked; redirecting to get_task for verification.")
                # Find the task_id from the prior creation
                prior_task_id = ""
                for tr in reversed(state.get("tool_results", [])):
                    if tr.get("tool") == "create_task" and tr.get("result", {}).get("task_created"):
                        prior_task_id = tr["result"].get("task_id", "")
                        break
                if prior_task_id:
                    action = "get_task"
                    action_input = {"task_id": prior_task_id}
                    steps.append(f"🔍 Task already created (ID: {prior_task_id}); verifying persistence instead.")
                else:
                    action = "final_answer"
                    action_input = {"answer": ""}

        # Post-creation guard: after a successful create_task, verify with get_task before finalizing
        created_task_tr = next(
            (tr for tr in state.get("tool_results", [])
             if tr.get("tool") == "create_task" and tr.get("result", {}).get("task_created")),
            None,
        )
        if created_task_tr:
            created_task_id = created_task_tr["result"].get("task_id", "")
            get_task_verified = any(
                tr.get("tool") == "get_task" and tr.get("result", {}).get("found")
                and str(tr.get("result", {}).get("task", {}).get("task_id", "")) == str(created_task_id)
                for tr in state.get("tool_results", [])
            )
            if not get_task_verified and created_task_id and action != "get_task":
                logger.info(
                    "agent_reason_node: task %s created; directing to get_task to verify persistence.",
                    created_task_id,
                )
                steps.append(f"🔍 Verifying persisted task (ID: {created_task_id}) with get_task.")
                action = "get_task"
                action_input = {"task_id": created_task_id}

        # Guard: If action is not in registered TOOL_RUNNERS and not final_answer, reject it
        if action not in TOOL_RUNNERS and action != "final_answer":
            logger.warning("agent_reason_node: model proposed unsupported tool '%s'. Rejecting.", action)
            steps.append(f"⚠️ Unsupported action '{action}' rejected. Finalizing response.")
            return {
                "iterations": current_iter,
                "next_action": "final_answer",
                "next_action_input": {
                    "answer": f"I do not have access to an external tool named '{action}'. Let me synthesize the response from available workspace data."
                },
                "steps": steps,
            }

        q_lower = state.get("query", "").lower()
        is_repo_arch_query = any(w in q_lower for w in ("architecture", "codebase", "structure", "tech stack", "frontend", "backend", "endpoint", "endpoints", "technologies")) and any(w in q_lower for w in ("github", "repository", "repo", "aira"))

        # Architecture exploration guard: If file tree has been retrieved, ensure key architecture files are read before finalizing
        if is_repo_arch_query and current_iter < MAX_TOOL_ITERATIONS - 1:
            tree_tr = next((tr for tr in state.get("tool_results", []) if tr.get("tool") in ("get_github_tree", "repo_get_github_tree") and not tr.get("result", {}).get("error")), None)
            if tree_tr:
                tree_res = tree_tr.get("result", {})
                tree_items = tree_res.get("tree", [])
                paths = [item.get("path", "") for item in tree_items if isinstance(item, dict) and item.get("path")]
                read_files = {
                    tr.get("result", {}).get("path")
                    for tr in state.get("tool_results", [])
                    if tr.get("tool") in ("get_github_file_content", "repo_get_github_file_content")
                    and tr.get("result", {}).get("path")
                }
                repo_for_files = tree_res.get("repository") or _resolve_repo_argument(state, {})[0]

                # If model chose final_answer, search_knowledge, or repeated tree call prematurely with < 3 key files read:
                if (action in ("final_answer", "search_knowledge") or action in ("get_github_tree", "repo_get_github_tree")) and len(read_files) < 3 and repo_for_files:
                    next_file = _select_next_arch_file(paths, read_files)
                    if next_file:
                        logger.info("agent_reason_node: directing architecture query to inspect key file '%s' in '%s'", next_file, repo_for_files)
                        steps.append(f"🔍 Inspecting key repository file '{next_file}' for architecture analysis.")
                        action = "get_github_file_content"
                        action_input = {"repo": repo_for_files, "path": next_file}

        return {
            "iterations": current_iter,
            "next_action": action,
            "next_action_input": action_input,
            "steps": steps,
        }

    except Exception as exc:
        logger.warning("agent_reason_node: LLM reasoning error (%s). Checking deterministic intent fallback.", exc)
        q_lower = state.get("query", "").lower()
        inferred_action = None
        inferred_input = {}

        has_repos = any(tr.get("tool") in ("list_github_repos", "repo_list_github_repos") for tr in state.get("tool_results", []))
        has_tree = any(tr.get("tool") in ("get_github_tree", "repo_get_github_tree") for tr in state.get("tool_results", []))
        has_file = any(tr.get("tool") in ("get_github_file_content", "repo_get_github_file_content") for tr in state.get("tool_results", []))

        is_repo_arch_query = any(w in q_lower for w in ("architecture", "codebase", "structure", "tech stack", "frontend", "backend", "endpoint", "endpoints", "technologies")) and any(w in q_lower for w in ("github", "repository", "repo", "aira"))

        if is_repo_arch_query:
            repo_match, _ = _resolve_repo_argument(state, {})
            if not repo_match and not has_repos:
                inferred_action = "list_github_repos"
                inferred_input = {}
            elif repo_match and not has_tree:
                inferred_action = "get_github_tree"
                inferred_input = {"repo": repo_match}
            elif repo_match and has_tree:
                tree_res = next((tr.get("result", {}) for tr in state.get("tool_results", []) if tr.get("tool") in ("get_github_tree", "repo_get_github_tree")), {})
                tree_items = tree_res.get("tree", [])
                paths = [item.get("path", "") for item in tree_items if isinstance(item, dict) and item.get("path")]
                read_files = {
                    tr.get("result", {}).get("path")
                    for tr in state.get("tool_results", [])
                    if tr.get("tool") in ("get_github_file_content", "repo_get_github_file_content")
                    and tr.get("result", {}).get("path")
                }
                next_file = _select_next_arch_file(paths, read_files) if len(read_files) < 4 else None
                if next_file and current_iter < MAX_TOOL_ITERATIONS - 1:
                    inferred_action = "get_github_file_content"
                    inferred_input = {"repo": repo_match, "path": next_file}
                else:
                    inferred_action = "final_answer"
                    inferred_input = {}
        elif any(w in q_lower for w in ("pull request", "pull requests", "pulls", " pr ", "prs")) and any(w in q_lower for w in ("github", "repo", "/", "list", "show", "get", "check")):
            inferred_action = "get_github_pulls"
            repo_match, _ = _resolve_repo_argument(state, {})
            if repo_match:
                inferred_input = {"repo": repo_match, "state": "all"}
        elif any(w in q_lower for w in ("issue", "issues", "bug", "bugs")) and any(w in q_lower for w in ("github", "repo", "/", "list", "show", "get", "check")):
            inferred_action = "get_github_issues"
            repo_match, _ = _resolve_repo_argument(state, {})
            if repo_match:
                inferred_input = {"repo": repo_match, "state": "all"}
        elif any(w in q_lower for w in ("repo", "repos", "repositories", "repository")) and any(w in q_lower for w in ("list", "show", "get", "all", "what")):
            inferred_action = "list_github_repos"
        elif any(w in q_lower for w in ("update", "change", "set", "mark")) and any(w in q_lower for w in ("task", "status", "todo", "in-progress", "in_progress", "completed", "done")):
            inferred_action = "update_task"
            task_id_match = _resolve_task_id(state, {})
            inferred_input = {"task_id": task_id_match}
        elif any(w in q_lower for w in ("delete", "remove", "cancel")) and "task" in q_lower and re.search(r'\b[0-9a-fA-F]{24}\b', state.get("query", "")):
            inferred_action = "delete_task"
            task_id_match = _resolve_task_id(state, {})
            inferred_input = {"task_id": task_id_match}
        elif any(w in q_lower for w in ("get", "retrieve", "show", "view", "details", "fetch", "status of")) and "task" in q_lower and re.search(r'\b[0-9a-fA-F]{24}\b', state.get("query", "")):
            inferred_action = "get_task"
            task_id_match = _resolve_task_id(state, {})
            inferred_input = {"task_id": task_id_match}
        elif any(w in q_lower for w in ("task", "tasks")) and any(w in q_lower for w in ("list", "show", "get", "all", "find")):
            inferred_action = "list_tasks"
        elif any(w in q_lower for w in ("create", "add", "make", "new")) and "task" in q_lower:
            inferred_action = "create_task"
            # Extract title from query heuristically
            title_match = re.search(r'(?:titled?|called|named)\s+["\']?([^"\']+?)["\']?\s*(?:with|desc|priority|due|assign|$)', q_lower)
            inferred_input = {"title": title_match.group(1).strip() if title_match else state["query"][:200]}
        elif any(w in q_lower for w in ("knowledge", "doc", "document", "spec", "architecture")):
            inferred_action = "search_knowledge"
            inferred_input = {"query": state["query"]}

        if inferred_action and (state.get("iterations", 0) == 0 or (is_repo_arch_query and inferred_action != "final_answer")):
            logger.info("agent_reason_node: successfully inferred action '%s' despite LLM error", inferred_action)
            steps.append(f"⚡ Inferred tool action '{inferred_action}' directly from query.")
            return {
                "iterations": current_iter,
                "next_action": inferred_action,
                "next_action_input": inferred_input,
                "steps": steps,
            }

        steps.append("⚙️ Synthesizing direct response.")
        fallback_answer = _extract_text_from_answer(raw_output) if not is_raw_tool_json(raw_output) else ""
        return {
            "iterations": current_iter,
            "next_action": "final_answer",
            "next_action_input": {"answer": fallback_answer},
            "steps": steps,
        }


def execute_tool_node(state: AgentState) -> dict:
    """
    Executes the requested tool, enforces permissions, and records results.
    """
    raw_tool_name = state.get("next_action") or ""
    tool_name = normalize_action_name(raw_tool_name)
    tool_args = state.get("next_action_input") or {}
    steps = list(state.get("steps", []))
    tool_calls = list(state.get("tool_calls", []))
    tool_results = list(state.get("tool_results", []))
    task_created = state.get("task_created")

    runner = TOOL_RUNNERS.get(tool_name)
    if not runner:
        err_msg = f"Unknown tool: '{tool_name}'."
        steps.append(f"⚠️ {err_msg}")
        tool_results.append({"tool": tool_name, "result": {"error": err_msg}})
        return {"steps": steps, "tool_results": tool_results}

    steps.append(f"⚡ Executing tool '{tool_name}' with args {json.dumps(tool_args)}")
    try:
        res = runner(state, tool_args)

        # Track task creation if this was create_task
        if tool_name == "create_task" and res.get("task_created"):
            task_created = res

        if res.get("error"):
            summary = f"Failed: {res.get('error')}"
            steps.append(f"❌ {summary}")
        else:
            summary = res.get("message") or f"Completed {tool_name} successfully."
            steps.append(f"✓ {summary}")

        tool_calls.append({
            "tool": tool_name,
            "arguments": tool_args,
            "result_summary": str(summary)[:200],
        })
        tool_results.append({"tool": tool_name, "result": res})

    except Exception as exc:
        logger.error("execute_tool_node: tool %s threw error: %s", tool_name, exc)
        steps.append(f"⚠️ Tool error: {str(exc)[:150]}")
        tool_calls.append({
            "tool": tool_name,
            "arguments": tool_args,
            "result_summary": f"Error: {exc}",
        })
        tool_results.append({"tool": tool_name, "result": {"error": str(exc)}})

    return {
        "steps": steps,
        "tool_calls": tool_calls,
        "tool_results": tool_results,
        "task_created": task_created,
    }


def finalize_node(state: AgentState) -> dict:
    """
    Final answer node: Ensures the final answer is complete, user-facing (never raw tool JSON),
    extracts deduplicated citations, and calculates calibrated confidence.
    """
    steps = list(state.get("steps", []))
    raw_answer = ""

    action_input = state.get("next_action_input")
    if state.get("next_action") == "final_answer":
        if isinstance(action_input, dict):
            for k in ("answer", "final_answer", "response", "content", "explanation", "summary", "text"):
                if isinstance(action_input.get(k), str) and action_input[k].strip():
                    raw_answer = action_input[k].strip()
                    break
            if not raw_answer:
                raw_answer = str(action_input.get("answer", ""))
        elif isinstance(action_input, str):
            raw_answer = action_input

    raw_answer = _extract_text_from_answer(raw_answer)

    has_retrieval = any(
        tr.get("tool") == "search_knowledge" and bool(tr.get("result", {}).get("results"))
        for tr in state.get("tool_results", [])
    )
    has_github_evidence = any(
        tr.get("tool") in ("get_github_tree", "repo_get_github_tree", "get_github_file_content", "repo_get_github_file_content")
        and not tr.get("result", {}).get("error")
        for tr in state.get("tool_results", [])
    )
    has_evidence = has_retrieval or has_github_evidence

    has_arch_disclaimer = any(
        phrase in raw_answer.lower()
        for phrase in (
            "unable to retrieve",
            "return no data",
            "cannot provide",
            "cannot produce",
            "no data and no error",
            "attempts to read files",
            "cannot inspect",
        )
    )

    needs_synthesis = (
        not raw_answer
        or len(raw_answer.strip()) < 20
        or is_raw_tool_json(raw_answer)
        or (has_evidence and is_answer_incomplete(state["query"], raw_answer))
        or (has_github_evidence and has_arch_disclaimer)
    )

    # If answer is empty, contains leaked raw tool-call JSON, or is incomplete, synthesize full user-facing answer
    if needs_synthesis:
        steps.append("⚙️ Synthesizing user-facing response from gathered workspace evidence...")

        evidence_blocks = []
        seen_evidence = set()
        for tr in state.get("tool_results", []):
            tool = tr.get("tool")
            res = tr.get("result", {})
            if tool == "search_knowledge" and res.get("results"):
                for chunk in res["results"]:
                    fn = chunk.get("filename", "doc")
                    ci = chunk.get("chunk_index", 0)
                    txt = chunk.get("text", "").strip()
                    ev_key = (fn, ci, txt[:80])
                    if ev_key not in seen_evidence and txt:
                        seen_evidence.add(ev_key)
                        evidence_blocks.append(f"[{fn} - Chunk {ci}]\n{txt}")
            elif tool in ("get_github_issues", "get_github_pulls", "list_github_repos", "repo_list_github_repos"):
                ts = json.dumps(res, default=str)[:3000]
                if ts not in seen_evidence:
                    seen_evidence.add(ts)
                    evidence_blocks.append(f"[{tool}]\n{ts}")
            elif tool in ("get_github_tree", "repo_get_github_tree"):
                tree_items = res.get("tree", [])
                paths = [item.get("path") for item in tree_items if isinstance(item, dict) and item.get("path")]
                paths_summary = "\n".join(paths[:120]) if paths else json.dumps(res, default=str)[:2000]
                ev_str = f"[GitHub Repository Tree for {res.get('repository', 'repo')}]\nTotal files/folders: {res.get('count', len(paths))}\n{paths_summary}"
                if ev_str not in seen_evidence:
                    seen_evidence.add(ev_str)
                    evidence_blocks.append(ev_str)
            elif tool in ("get_github_file_content", "repo_get_github_file_content"):
                file_path = res.get("path") or "file"
                content_text = res.get("content") or ""
                ev_str = f"[GitHub File: {file_path} in {res.get('repository', 'repo')}]\n{content_text[:4000]}"
                if ev_str not in seen_evidence:
                    seen_evidence.add(ev_str)
                    evidence_blocks.append(ev_str)
            elif tool in ("create_task", "update_task", "list_tasks", "get_task", "search_tasks"):
                ts = json.dumps(res, default=str)[:600]
                if ts not in seen_evidence:
                    seen_evidence.add(ts)
                    evidence_blocks.append(f"[{tool}]\n{ts}")

        evidence_str = "\n\n".join(evidence_blocks)[:16000] if evidence_blocks else "No raw evidence blocks available."

        synth_prompt = f"""User Request:
{state['query']}

Retrieved Workspace Evidence:
{evidence_str}

CRITICAL SYNTHESIS INSTRUCTIONS:
- You must synthesize a thorough, well-structured, and complete Markdown answer that directly addresses every aspect of the user request using the retrieved workspace evidence.
- GITHUB INTEGRATION RULES:
  * When repositories are retrieved, list each repository's name, owner (owner.login), and html_url link clearly.
  * If GitHub returned an error or authentication failure, clearly state the real failure to the user. Do not claim success when no GitHub call succeeded, and do not invent repository details.
  * If a tool returned an error (such as 401, 403, 404, or inaccessible repository), report the exact error. You must NEVER state that there are 0 issues or 0 pull requests when an error occurred.
  * Report 0 issues or 0 pull requests ONLY when the tool returned a successful response with an empty list.
  * If the response is marked as mock or disconnected, inform the user clearly that mock reference data is shown.
  * When explaining repository architecture, identify the repository's frontend, backend services, main technologies, and important API endpoints using the retrieved repository tree and file content evidence.
  * You MUST include dedicated sections with Markdown headings (###):
    ### Architecture Overview & System Design
    ### Frontend Architecture & Technologies (citing frontend/package.json or frontend files)
    ### Backend Services & Node/Express Architecture (citing backend/package.json, routes, controllers)
    ### AI Service & Retrieval Action Pipeline (citing Ai-Service/app/main.py, requirements.txt, or agent services)
    ### Main Technologies & Databases (MongoDB, Qdrant, Express, FastAPI, React, etc.)
    ### Key API Endpoints & Routes (citing route definitions)
    ### Citations & Inspected Files
  * Always cite the exact repository files used in your analysis (e.g. backend/package.json, frontend/package.json, Ai-Service/app/main.py, README.md).
- KNOWLEDGE BASE RULES:
  * GROUNDING & FACTUAL INTEGRITY:
    - Base your explanation strictly on the retrieved passages above and cite the source passages.
    - Strictly distinguish between DOCUMENTED FACTS (explicitly confirmed in the document passages) and MISSING OR UNDOCUMENTED DETAILS.
    - DO NOT present standard industry practices, typical conventions, or external assumptions (e.g. bcrypt salt rounds, specific SQL queries, Redis caching, refresh tokens, role tables) as facts from the uploaded document unless explicitly stated in the retrieved passages.
    - If any requested section's technical details are not established or mentioned in the source documents, you must explicitly state under that section heading: 'The provided document does not establish [details].' Do NOT omit the section, and do NOT invent or hallucinate missing endpoints, hashing algorithms, queries, or token storage.
  * If the user requested specific sections or structural headings (such as Frontend, Backend, Database, Authentication, Request Flow, Missing or Undocumented Details), you MUST include an explicit markdown heading (###) for EACH of them.
- Provide the complete human-readable explanation directly. Do NOT output raw JSON or code fences."""

        synth_err_msg = ""
        try:
            synth_response = get_llm_response(
                f"You are the AIRA {state.get('agent_name', 'Agent')}. Provide a rich, professional, complete Markdown answer.",
                synth_prompt,
                max_tokens=3072,
            )
            extracted_synth = _extract_text_from_answer(synth_response)
            if extracted_synth and len(extracted_synth.strip()) >= 20 and not is_raw_tool_json(extracted_synth):
                raw_answer = extracted_synth
        except Exception as exc:
            logger.warning("finalize_node: synthesis generation failed: %s", exc)
            synth_err_msg = str(exc)

        raw_answer = clean_parser_artifacts(sanitize_mojibake(raw_answer))

        is_partial = False
        # Check if the synthesized answer is still incomplete (e.g. cut off by upstream model token limit)
        if is_answer_incomplete(state["query"], raw_answer) and not is_raw_tool_json(raw_answer) and raw_answer.strip():
            is_partial = True
            if "Incomplete Output Warning" not in raw_answer:
                raw_answer = (
                    raw_answer.strip()
                    + "\n\n> ⚠️ **Incomplete Output Warning**: Answer generation reached the output limit before completing all requested sections. Please refer to the available sections above."
                )

        # Fail-safe fallback if LLM produced empty, malformed, or raw tool JSON
        if is_raw_tool_json(raw_answer) or not raw_answer.strip() or len(raw_answer.strip()) < 20:
            agent_label = state.get("agent_name", "Knowledge Agent")
            has_any = False
            tool_summary_items = []

            for tr in state.get("tool_results", []):
                t = tr.get("tool")
                r = tr.get("result", {})
                if t in ("get_github_issues", "repo_get_github_issues"):
                    has_any = True
                    if r.get("error"):
                        tool_summary_items.append(f"❌ **GitHub Issues Error**: {r.get('error')}")
                    else:
                        issues = r.get("issues", [])
                        repo_name = r.get("repository") or "repository"
                        if not issues:
                            tool_summary_items.append(f"✓ **GitHub Issues for `{repo_name}`**: No issues found (0 issues).")
                        else:
                            tool_summary_items.append(f"✓ **GitHub Issues for `{repo_name}`** ({len(issues)} found):\n")
                            for iss in issues[:25]:
                                num = iss.get("number")
                                title = iss.get("title", "")
                                author = iss.get("user", {}).get("login") if isinstance(iss.get("user"), dict) else "unknown"
                                url = iss.get("html_url", "")
                                state_str = iss.get("state", "open")
                                link_text = f"[#{num}]({url})" if url else f"#{num}"
                                tool_summary_items.append(f"  * {link_text} **{title}** (`{state_str}`) by @{author}")
                        if r.get("is_mock"):
                            tool_summary_items.append("\n  *(Note: Showing mock fallback data — workspace is disconnected from GitHub)*")

                elif t in ("get_github_pulls", "repo_get_github_pulls"):
                    has_any = True
                    if r.get("error"):
                        tool_summary_items.append(f"❌ **GitHub Pull Requests Error**: {r.get('error')}")
                    else:
                        pulls = r.get("pulls", [])
                        repo_name = r.get("repository") or "repository"
                        if not pulls:
                            tool_summary_items.append(f"✓ **GitHub Pull Requests for `{repo_name}`**: No pull requests found (0 pull requests).")
                        else:
                            tool_summary_items.append(f"✓ **GitHub Pull Requests for `{repo_name}`** ({len(pulls)} found):\n")
                            for pr in pulls[:25]:
                                num = pr.get("number")
                                title = pr.get("title", "")
                                author = pr.get("user", {}).get("login") if isinstance(pr.get("user"), dict) else "unknown"
                                url = pr.get("html_url", "")
                                state_str = pr.get("state", "open")
                                link_text = f"[#{num}]({url})" if url else f"#{num}"
                                tool_summary_items.append(f"  * {link_text} **{title}** (`{state_str}`) by @{author}")
                        if r.get("is_mock"):
                            tool_summary_items.append("\n  *(Note: Showing mock fallback data — workspace is disconnected from GitHub)*")

                elif t in ("list_github_repos", "repo_list_github_repos"):
                    has_any = True
                    if r.get("error"):
                        tool_summary_items.append(f"❌ **GitHub Repositories Error**: {r.get('error')}")
                    else:
                        repos = r.get("repositories", [])
                        tool_summary_items.append(f"✓ **GitHub Repositories** ({len(repos)} found):\n")
                        for repo_item in repos[:20]:
                            repo_name = repo_item.get("name", "Unknown")
                            owner_login = repo_item.get("owner", {}).get("login") if isinstance(repo_item.get("owner"), dict) else (repo_item.get("owner") or "")
                            html_url = repo_item.get("html_url", "")
                            tool_summary_items.append(f"  * **{repo_name}** (Owner: `{owner_login}`): {html_url}")
                        if r.get("source") == "mock" or r.get("is_mock"):
                            tool_summary_items.append("\n  *(Note: Showing mock fallback data — workspace is disconnected from GitHub)*")

                elif t in ("get_github_tree", "repo_get_github_tree"):
                    has_any = True
                    if r.get("error"):
                        tool_summary_items.append(f"❌ **GitHub Repository Tree Error**: {r.get('error')}")
                    else:
                        repo_name = r.get("repository") or "repository"
                        tree_items = r.get("tree", [])
                        paths = [item.get("path") for item in tree_items if isinstance(item, dict) and item.get("path")]
                        tool_summary_items.append(f"✓ **GitHub File Tree for `{repo_name}`** ({len(paths)} files/directories indexed):\n")
                        for p in paths[:30]:
                            tool_summary_items.append(f"  * `{p}`")
                        if len(paths) > 30:
                            tool_summary_items.append(f"  * ... and {len(paths) - 30} more items.")
                        if r.get("is_mock"):
                            tool_summary_items.append("\n  *(Note: Showing mock fallback data — workspace is disconnected from GitHub)*")

                elif t in ("get_github_file_content", "repo_get_github_file_content"):
                    has_any = True
                    if r.get("error"):
                        tool_summary_items.append(f"❌ **GitHub File Content Error**: {r.get('error')}")
                    else:
                        repo_name = r.get("repository") or "repository"
                        file_path = r.get("path") or "file"
                        tool_summary_items.append(f"✓ **Retrieved File `{file_path}` from `{repo_name}`**:\n```\n{r.get('content', '')[:1000]}\n```")
                        if r.get("is_mock"):
                            tool_summary_items.append("\n  *(Note: Showing mock fallback data — workspace is disconnected from GitHub)*")

                elif t == "search_knowledge" and r.get("results"):
                    has_any = True
                    for item in r["results"]:
                        tool_summary_items.append(f"**Document**: `{item.get('filename', 'doc')}` (Chunk {item.get('chunk_index', 0)})")
                        tool_summary_items.append(f"> {item.get('text', '').strip()}\n")

                elif t == "update_task":
                    has_any = True
                    if r.get("updated") or r.get("task_updated"):
                        tool_summary_items.append(f"✓ **Task Updated**: Task `{r.get('task_id')}` status is now `{r.get('status', 'updated')}`.")
                    else:
                        tool_summary_items.append(f"❌ **Task Update Error**: {r.get('error', 'Update failed')}")

                elif t == "create_task":
                    has_any = True
                    tool_summary_items.append(f"- **Task Created**: Task `{r.get('task_id')}` created with title **{r.get('title')}**.")

                elif t in ("list_tasks", "get_task", "search_tasks"):
                    has_any = True
                    tasks = r.get("tasks", [])
                    tool_summary_items.append(f"✓ **Tasks** ({len(tasks)} found):")
                    for tk in tasks[:15]:
                        tool_summary_items.append(f"  * **{tk.get('title', 'Untitled')}** (`{tk.get('status', 'todo')}`) [Priority: {tk.get('priority', 'medium')}]")

            diagnostic_reason = synth_err_msg or "upstream generation issue"

            if has_any:
                summary_parts = [
                    f"### ⚠️ {agent_label} Synthesis Notice\n",
                    f"> **Notice**: Answer synthesis could not be completed for your query due to an upstream generation issue ({diagnostic_reason}). "
                    "The operational results below were successfully executed and retrieved from your workspace for reference:\n",
                    "### Retrieved Workspace Evidence\n",
                ] + tool_summary_items
            else:
                summary_parts = [
                    f"### ⚠️ {agent_label} Service Notice\n\n",
                    f"> **Notice**: The AI language model could not complete your request due to an upstream generation issue ({diagnostic_reason}).\n\n",
                    "No tools were executed for this query. Please verify that your LLM provider credentials and quotas are active, or try again in a moment."
                ]

            raw_answer = "\n".join(summary_parts)

    raw_answer = clean_parser_artifacts(sanitize_mojibake(raw_answer))

    # Guard: Ensure GitHub tool errors are never masked as zero issues / zero PRs in raw_answer
    for tr in state.get("tool_results", []):
        t = tr.get("tool")
        r = tr.get("result", {})
        err_msg = r.get("error")
        if err_msg:
            if t in ("get_github_issues", "repo_get_github_issues"):
                if re.search(r'\b(?:0|zero|no)\s+(?:open\s+|closed\s+)?issues\b', raw_answer, re.I) or not any(kw in raw_answer.lower() for kw in ("error", "failed", "inaccessible", "not found", "401", "403", "404", "429")):
                    repo_str = r.get("repository") or "repository"
                    raw_answer = f"❌ **GitHub Issues Error for `{repo_str}`**: {err_msg}"
            elif t in ("get_github_pulls", "repo_get_github_pulls"):
                if re.search(r'\b(?:0|zero|no)\s+(?:open\s+|closed\s+)?(?:pull\s*requests|pulls|prs)\b', raw_answer, re.I) or not any(kw in raw_answer.lower() for kw in ("error", "failed", "inaccessible", "not found", "401", "403", "404", "429")):
                    repo_str = r.get("repository") or "repository"
                    raw_answer = f"❌ **GitHub Pull Requests Error for `{repo_str}`**: {err_msg}"
            elif t in ("list_github_repos", "repo_list_github_repos"):
                if re.search(r'\b(?:0|zero|no)\s+repos(?:itories)?\b', raw_answer, re.I) or not any(kw in raw_answer.lower() for kw in ("error", "failed", "inaccessible", "not found", "401", "403", "404")):
                    raw_answer = f"❌ **GitHub Repositories Error**: {err_msg}"
            elif t in ("get_github_tree", "repo_get_github_tree"):
                if not any(kw in raw_answer.lower() for kw in ("error", "failed", "inaccessible", "not found", "401", "403", "404", "429")):
                    repo_str = r.get("repository") or "repository"
                    raw_answer = f"❌ **GitHub Repository Tree Error for `{repo_str}`**: {err_msg}"
            elif t in ("get_github_file_content", "repo_get_github_file_content"):
                if not any(kw in raw_answer.lower() for kw in ("error", "failed", "inaccessible", "not found", "401", "403", "404", "429")):
                    repo_str = r.get("repository") or "repository"
                    file_str = r.get("path") or "file"
                    raw_answer = f"❌ **GitHub File Content Error for `{repo_str}/{file_str}`**: {err_msg}"

    # Guard: Ensure Task update / get / delete tool errors or uncalled operations are never masked as success
    for tr in state.get("tool_results", []):
        t = tr.get("tool")
        r = tr.get("result", {})
        err_msg = r.get("error")
        if t == "create_task":
            if not r.get("task_created") or err_msg:
                real_err = err_msg or r.get("message") or "Task creation failed."
                raw_answer = f"❌ **Task Creation Error**: {real_err}"
            elif r.get("task_created") and not any(tr2.get("tool") == "get_task" and tr2.get("result", {}).get("found") for tr2 in state.get("tool_results", [])):
                t_title = r.get("title", "Untitled")
                t_id = r.get("task_id", "")
                t_prio = r.get("priority", "medium")
                t_status = r.get("status", "todo")
                t_due = r.get("due_date")
                t_assigned = r.get("assigned_to")
                due_line = f"\n- **Due Date**: {t_due}" if t_due else ""
                assignee_raw = t_assigned
                if assignee_raw and isinstance(assignee_raw, dict):
                    assignee_display = assignee_raw.get("name") or assignee_raw.get("email") or str(assignee_raw.get("_id", ""))
                elif assignee_raw:
                    assignee_display = str(assignee_raw)
                else:
                    assignee_display = None
                assignee_line = f"\n- **Assigned To**: {assignee_display}" if assignee_display else ""
                raw_answer = (
                    f"✅ **Task Created**:\n"
                    f"- **Task ID**: `{t_id}`\n"
                    f"- **Title**: {t_title}\n"
                    f"- **Status**: `{t_status}`\n"
                    f"- **Priority**: `{t_prio}`"
                    f"{due_line}"
                    f"{assignee_line}"
                )
        elif t == "update_task":
            if not (r.get("updated") or r.get("task_updated")) or err_msg:
                real_err = err_msg or "Task update failed or task not found in your workspace."
                raw_answer = f"❌ **Task Update Error**: {real_err}"
        elif t == "delete_task":
            if not r.get("deleted") or err_msg:
                real_err = err_msg or "Task deletion failed or task not found in your workspace."
                raw_answer = f"❌ **Task Deletion Error**: {real_err}"
        elif t == "get_task":
            if not r.get("found") or err_msg:
                real_err = err_msg or r.get("message") or "Task was not found in your workspace or access is not authorized."
                raw_answer = f"❌ **Task Retrieval Error**: {real_err}"
            elif r.get("found") and r.get("task"):
                t_data = r["task"]
                # Check if this get_task was a post-creation verification
                was_created = any(
                    ctr.get("tool") == "create_task" and ctr.get("result", {}).get("task_created")
                    and str(ctr.get("result", {}).get("task_id", "")) == str(t_data.get("task_id", ""))
                    for ctr in state.get("tool_results", [])
                )
                intro = "✅ **Task Created and Verified**" if was_created else f"✓ **Task Details for `{t_data.get('task_id', '')}`**"
                due_line = f"\n- **Due Date**: {t_data['due_date']}" if t_data.get("due_date") else ""
                assignee_raw = t_data.get("assigned_to")
                if assignee_raw and isinstance(assignee_raw, dict):
                    assignee_display = assignee_raw.get("name") or assignee_raw.get("email") or str(assignee_raw.get("_id", ""))
                elif assignee_raw:
                    assignee_display = str(assignee_raw)
                else:
                    assignee_display = None
                assignee_line = f"\n- **Assigned To**: {assignee_display}" if assignee_display else ""
                raw_answer = (
                    f"{intro}:\n"
                    f"- **Task ID**: `{t_data.get('task_id', '')}`\n"
                    f"- **Title**: {t_data.get('title', 'Untitled')}\n"
                    f"- **Description**: {t_data.get('description', '')}\n"
                    f"- **Status**: `{t_data.get('status', 'todo')}`\n"
                    f"- **Priority**: `{t_data.get('priority', 'medium')}`"
                    f"{due_line}"
                    f"{assignee_line}\n"
                    f"- **Created At**: {t_data.get('created_at', '')}"
                )

    # Guard: If query requested a task status update, but update_task was never executed:
    q_lower = state.get("query", "").lower()
    if any(w in q_lower for w in ("update task", "change task", "mark task", "set task", "update the task")) and any(w in q_lower for w in ("status", "in-progress", "in_progress", "todo", "completed", "done")):
        update_called = any(tr.get("tool") == "update_task" for tr in state.get("tool_results", []))
        if not update_called:
            raw_answer = "❌ **Task Update Error**: The task update tool was not executed for this request. No changes were persisted to the database."

    # Guard: If query requested task creation, but create_task was never executed:
    if (
        (any(w in q_lower for w in ("create task", "add task", "new task", "schedule task", "create a task"))
         or ("task" in q_lower and any(w in q_lower for w in ("create", "add", "make a task"))))
        and not any(w in q_lower for w in ("update", "change", "set", "mark", "delete", "remove", "cancel", "list", "search", "get", "retrieve", "view", "show", "details"))
    ):
        create_called = any(tr.get("tool") == "create_task" for tr in state.get("tool_results", []))
        if not create_called:
            raw_answer = "❌ **Task Creation Error**: The task creation tool was not executed for this request. No task was persisted to the database."

    # Guard: If query requested task retrieval by ID, but get_task was never executed or failed:
    is_get_request = (
        any(w in q_lower for w in ("get task", "retrieve task", "view task", "show task", "fetch task", "check task", "find task", "details of task", "task details"))
        or (
            re.search(r'\b[0-9a-fA-F]{24}\b', state.get("query", ""))
            and "task" in q_lower
            and not any(w in q_lower for w in ("update", "change", "set", "mark", "create", "delete", "remove", "cancel"))
        )
    )
    if is_get_request:
        get_called = any(tr.get("tool") == "get_task" for tr in state.get("tool_results", []))
        has_found = any(tr.get("tool") == "get_task" and tr.get("result", {}).get("found") for tr in state.get("tool_results", []))
        if not get_called or not has_found:
            task_err = "Task was not found in your workspace or access is not authorized."
            for tr in state.get("tool_results", []):
                if tr.get("tool") == "get_task":
                    task_err = tr.get("result", {}).get("error") or tr.get("result", {}).get("message") or task_err
            raw_answer = f"❌ **Task Retrieval Error**: {task_err}"

    is_notice = "Synthesis Notice" in raw_answer or "Service Notice" in raw_answer or "❌ **GitHub" in raw_answer or "❌ **Task" in raw_answer
    is_incomplete = "Incomplete Output Warning" in raw_answer or is_answer_incomplete(state["query"], raw_answer)

    if is_notice:
        steps.append("⚠️ Response finalized with operational notice.")
        status_val = "notice"
    elif is_incomplete:
        steps.append("⚠️ Response generated with partial output (incomplete sections).")
        status_val = "partial"
    else:
        steps.append("✓ Response generated successfully.")
        status_val = "success"

    # Extract deduplicated citations from knowledge search results
    citations = []
    seen_chunks = set()
    for tr in state.get("tool_results", []):
        if tr.get("tool") == "search_knowledge" and tr.get("result", {}).get("results"):
            for chunk in tr["result"]["results"]:
                fn = chunk.get("filename", "unknown")
                ci = chunk.get("chunk_index", 0)
                chunk_key = (fn, ci)
                if chunk_key not in seen_chunks:
                    seen_chunks.add(chunk_key)
                    is_reranked = chunk.get("reranked")
                    if is_reranked is None:
                        is_reranked = bool("raw_score" in chunk or "rerank_score" in chunk)
                    ret_mode = chunk.get("retrieval_mode")
                    if not ret_mode:
                        ret_mode = "hybrid" if ("rrf_score" in chunk or chunk.get("score", 0.0) < 0.1) else "semantic"

                    citations.append({
                        "filename": fn,
                        "chunk_index": ci,
                        "excerpt": chunk.get("text", "")[:180],
                        "score": float(chunk.get("score", 0.0)),
                        "rerank_score": float(chunk.get("rerank_score", chunk.get("score", 0.0))),
                        "raw_score": float(chunk.get("raw_score", chunk.get("score", 0.0))),
                        "relevance_score": float(chunk.get("relevance_score", chunk.get("score", 0.0))),
                        "reranked": bool(is_reranked),
                        "retrieval_mode": str(ret_mode),
                    })
        elif tr.get("tool") in ("get_github_file_content", "repo_get_github_file_content") and tr.get("result", {}).get("content"):
            r = tr["result"]
            file_path = r.get("path", "file")
            chunk_key = (f"github:{file_path}", 0)
            if chunk_key not in seen_chunks:
                seen_chunks.add(chunk_key)
                citations.append({
                    "filename": file_path,
                    "repository": r.get("repository", ""),
                    "chunk_index": 0,
                    "excerpt": (r.get("content") or "")[:180],
                    "score": 1.0,
                    "rerank_score": 1.0,
                    "raw_score": 1.0,
                    "relevance_score": 1.0,
                    "reranked": False,
                    "retrieval_mode": "github",
                })

    from app.services.rag_engine import calculate_confidence
    if citations:
        conf_val, _ = calculate_confidence(citations)
        confidence = float(conf_val)
    elif state.get("tool_calls"):
        has_errors = any("error" in tr.get("result", {}) for tr in state.get("tool_results", []))
        confidence = 0.70 if has_errors else 0.85
    else:
        confidence = 0.75

    return {
        "final_answer": raw_answer,
        "steps": steps,
        "citations": citations,
        "confidence": confidence,
        "status": status_val,
    }


def should_continue(state: AgentState) -> str:
    """Routing condition: check if we should execute another tool or finalize."""
    action = state.get("next_action")
    iterations = state.get("iterations", 0)

    if action == "final_answer" or not action:
        return "finalize"
    if iterations >= MAX_TOOL_ITERATIONS:
        logger.info("LangGraph agent reached max iterations (%d). Finalizing.", MAX_TOOL_ITERATIONS)
        return "finalize"
    return "continue"


# ── Compile Graph ─────────────────────────────────────────────────────────────

def _build_agent_graph():
    builder = StateGraph(AgentState)
    builder.add_node("agent_reason", agent_reason_node)
    builder.add_node("execute_tool", execute_tool_node)
    builder.add_node("finalize", finalize_node)

    builder.add_edge(START, "agent_reason")
    builder.add_conditional_edges(
        "agent_reason",
        should_continue,
        {
            "continue": "execute_tool",
            "finalize": "finalize",
        },
    )
    builder.add_edge("execute_tool", "agent_reason")
    builder.add_edge("finalize", END)

    return builder.compile()


_graph = _build_agent_graph()


def run_langgraph_agent(
    agent_id: str,
    query: str,
    user_id: str = "",
    workspace_id: str = "",
    role: str = "member",
    raw_token: str = "",
    conversation_id: Optional[str] = None,
) -> dict:
    """
    Execute an agent workflow via the compiled LangGraph state machine.
    """
    from app.services.agent_service import AGENTS

    agent_cfg = AGENTS.get(agent_id, {
        "name": "General Agent",
        "description": "Multi-purpose AIRA assistant",
    })

    initial_state: AgentState = {
        "query": query,
        "agent_id": agent_id,
        "agent_name": agent_cfg["name"],
        "user_id": user_id,
        "workspace_id": workspace_id or user_id,
        "role": role,
        "raw_token": raw_token,
        "conversation_id": conversation_id,
        "messages": [{"role": "user", "content": query}],
        "tool_calls": [],
        "tool_results": [],
        "steps": [f"🚀 Initializing {agent_cfg['name']} (LangGraph orchestration)"],
        "iterations": 0,
        "next_action": None,
        "next_action_input": None,
        "final_answer": "",
        "task_created": None,
        "citations": [],
        "confidence": 0.8,
        "error": None,
        "status": "in_progress",
    }

    final_state = _graph.invoke(initial_state)

    # Sanitize: ensure transient credentials and raw errors are never in return dict
    return {
        "agent_id": agent_id,
        "agent_name": agent_cfg["name"],
        "query": query,
        "answer": final_state.get("final_answer", ""),
        "steps": final_state.get("steps", []),
        "tool_calls": final_state.get("tool_calls", []),
        "task_created": final_state.get("task_created"),
        "citations": final_state.get("citations", []),
        "confidence": final_state.get("confidence", 0.85),
        "status": final_state.get("status", "success"),
    }
