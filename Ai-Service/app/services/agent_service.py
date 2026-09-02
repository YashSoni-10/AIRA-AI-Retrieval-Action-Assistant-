"""
Agent Service - Stateful AI agent workforce.
Implements Knowledge Agent, Engineering Agent, and Task Agent
with tool-calling capabilities using LLM.
"""
from __future__ import annotations
import logging
import json
import uuid
from app.services.llm_service import get_llm_response
from app.services.vector_store import similarity_search
from app.services.github_service import get_github_repos, get_github_issues, get_github_pulls

logger = logging.getLogger(__name__)

# ── Tool Definitions ──────────────────────────────────────────────────────────

def tool_search_knowledge(query: str) -> dict:
    """Search the AIRA knowledge base for relevant information."""
    results = similarity_search(query, top_k=3)
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


def tool_summarize_document(filename: str) -> dict:
    """Summarize a specific document from the knowledge base."""
    results = similarity_search(f"summary overview of {filename}", top_k=5)
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


def tool_create_task(title: str, description: str, priority: str = "Medium") -> dict:
    """Create a task/action item (simulated)."""
    task_id = str(uuid.uuid4())[:8].upper()
    return {
        "task_id": f"AIRA-{task_id}",
        "title": title,
        "description": description,
        "priority": priority,
        "status": "Created",
        "message": f"Task AIRA-{task_id} created successfully.",
    }


def tool_answer_question(question: str) -> dict:
    """Answer a general question using the LLM without knowledge base."""
    answer = get_llm_response(
        "You are AIRA, a helpful enterprise AI assistant. Answer professionally and concisely.",
        question,
        max_tokens=512,
    )
    return {"answer": answer}


def tool_list_github_repos() -> dict:
    """List the repositories in the connected GitHub workspace."""
    repos = get_github_repos()
    return {"repositories": [r["full_name"] for r in repos], "count": len(repos)}


def tool_get_github_issues(repo: str | None = None) -> dict:
    """Get the list of open and closed issues for a GitHub repository."""
    issues = get_github_issues(repo)
    return {
        "repository": repo or "default",
        "issues": [{"number": i["number"], "title": i["title"], "state": i["state"]} for i in issues],
        "count": len(issues)
    }


def tool_get_github_pulls(repo: str | None = None) -> dict:
    """Get the list of active and closed pull requests for a GitHub repository."""
    pulls = get_github_pulls(repo)
    return {
        "repository": repo or "default",
        "pulls": [{"number": p["number"], "title": p["title"], "state": p["state"]} for p in pulls],
        "count": len(pulls)
    }


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
- Code review and explanation
- Architecture analysis
- Technical documentation
- API and system design
- GitHub integration (fetching issues, PRs, and repositories)
Search the knowledge base for technical context and use GitHub tools to check code repository status.""",
        "tools": ["search_knowledge", "list_github_repos", "get_github_issues", "get_github_pulls", "answer_question"],
    },
    "task": {
        "name": "Task Agent",
        "description": "Creates tasks, action items, and helps with project management",
        "system_prompt": """You are the AIRA Task Agent. You help teams by:
- Creating structured tasks and action items
- Searching for relevant project context
- Organizing work into manageable steps
Always clarify requirements before creating tasks.""",
        "tools": ["search_knowledge", "create_task", "answer_question"],
    },
}


def execute_agent(agent_id: str, query: str) -> dict:
    """
    Execute an agent with a user query.
    Returns structured response with agent name, steps taken, and final answer.
    """
    agent_config = AGENTS.get(agent_id)
    if not agent_config:
        return {
            "error": f"Unknown agent: '{agent_id}'. Available agents: {list(AGENTS.keys())}",
            "agent_id": agent_id,
        }

    steps = []
    tool_results = {}

    # Step 1: Search knowledge base as first tool for all agents
    steps.append(f"🔍 Searching knowledge base for: '{query}'")
    kb_result = tool_search_knowledge(query)
    tool_results["knowledge_search"] = kb_result
    if kb_result["found"]:
        steps.append(f"✓ {kb_result['message']}")
    else:
        steps.append(f"⚠️ {kb_result['message']}")

    # Step 2: GitHub Context Integration (Engineering Agent or query references)
    github_context = ""
    if agent_id == "engineering" or any(kw in query.lower() for kw in ["github", "issue", "pr", "pull request", "repo"]):
        if "issue" in query.lower():
            steps.append("🔍 Fetching relevant issues from GitHub...")
            issues_res = tool_get_github_issues()
            github_context = f"\n\nGitHub Issues context:\n" + json.dumps(issues_res, indent=2)
            steps.append(f"✓ Retrieved {issues_res['count']} GitHub issues.")
        elif "pr" in query.lower() or "pull request" in query.lower():
            steps.append("🔍 Fetching relevant pull requests from GitHub...")
            pulls_res = tool_get_github_pulls()
            github_context = f"\n\nGitHub Pull Requests context:\n" + json.dumps(pulls_res, indent=2)
            steps.append(f"✓ Retrieved {pulls_res['count']} GitHub pull requests.")
        else:
            steps.append("🔍 Listing repositories from connected GitHub account...")
            repos_res = tool_list_github_repos()
            github_context = f"\n\nGitHub Repositories context:\n" + json.dumps(repos_res, indent=2)
            steps.append(f"✓ Found {repos_res['count']} GitHub repositories.")

    # Step 3: Build enriched context
    context_snippets = []
    if kb_result["found"]:
        for r in kb_result["results"]:
            context_snippets.append(f"[{r['filename']} | score: {r['score']:.2%}]\n{r['text']}")

    context = "\n\n".join(context_snippets) if context_snippets else "No relevant documents found."
    if github_context:
        context += github_context

    # Step 4: Build final prompt for agent
    steps.append(f"⚙️ {agent_config['name']} is synthesizing the answer...")
    user_prompt = f"""User Query: {query}

Context:
{context}

Please provide a comprehensive, professional answer based on the context and your expertise."""

    answer = get_llm_response(agent_config["system_prompt"], user_prompt, max_tokens=768)
    steps.append("✓ Response generated successfully.")

    # Task agent: also create a task if query implies action
    task_created = None
    if agent_id == "task" and any(
        kw in query.lower() for kw in ["create", "add", "make", "new task", "todo", "action item"]
    ):
        steps.append("📋 Creating task based on request...")
        task_created = tool_create_task(
            title=query[:80],
            description=answer[:300],
            priority="Medium",
        )
        steps.append(f"✓ Task {task_created['task_id']} created.")

    return {
        "agent_id": agent_id,
        "agent_name": agent_config["name"],
        "query": query,
        "steps": steps,
        "answer": answer,
        "task_created": task_created,
        "knowledge_results": kb_result.get("results", []),
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
