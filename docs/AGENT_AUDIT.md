# AIRA — Agent Audit
**Date:** 2026-09-09 | Source: `Ai-Service/app/services/agent_service.py`

---

## Verdict: PARTIALLY IMPLEMENTED (Scripted, Not Graph-based)

The agent system executes and produces results. However, it is a **scripted multi-step function**, not a real agentic graph with dynamic planning, LLM-driven tool selection, or iterative reasoning.

---

## What Exists

### Agent Registry (`agent_service.py AGENTS dict`)

| Agent | ID | Tools Listed |
|-------|----|-------------|
| Knowledge Agent | `knowledge` | search_knowledge, summarize_document, answer_question |
| Engineering Agent | `engineering` | search_knowledge, list_github_repos, get_github_issues, get_github_pulls, answer_question |
| Task Agent | `task` | search_knowledge, create_task, answer_question |

---

## Tool Implementations

| Tool Function | Implementation | Output | Real/Simulated |
|---------------|---------------|--------|----------------|
| `tool_search_knowledge(query)` | `similarity_search(query, top_k=3)` | `{found, results, message}` | **REAL** |
| `tool_summarize_document(filename)` | `similarity_search("summary of {filename}", top_k=5)` → LLM | `{summary, filename, chunks_used}` | **REAL** |
| `tool_create_task(title, description, priority)` | `str(uuid.uuid4())[:8]` — returns dict, not persisted | `{task_id, title, status}` | **SIMULATED** |
| `tool_answer_question(question)` | `get_llm_response()` without KB context | `{answer}` | **REAL** |
| `tool_list_github_repos()` | `get_github_repos()` | `{repositories, count}` | **REAL (mock fallback)** |
| `tool_get_github_issues(repo)` | `get_github_issues(repo)` | `{repository, issues, count}` | **REAL (mock fallback)** |
| `tool_get_github_pulls(repo)` | `get_github_pulls(repo)` | `{repository, pulls, count}` | **REAL (mock fallback)** |

---

## `execute_agent()` Flow Analysis

**File:** `agent_service.py` lines 137-224

```
execute_agent(agent_id, query)
  1. Validate agent_id exists in AGENTS dict
  2. ALWAYS call tool_search_knowledge(query) [ALL agents]
  3. IF (agent_id == "engineering") OR (query contains "github/issue/pr/pull request/repo"):
       IF "issue" in query: call tool_get_github_issues()
       ELIF "pr"/"pull request" in query: call tool_get_github_pulls()
       ELSE: call tool_list_github_repos()
  4. Build context string from KB results + GitHub results
  5. Call get_llm_response(agent_system_prompt, context+query, max_tokens=768)
  6. IF (agent_id == "task") AND (query contains "create/add/make/new task/todo/action item"):
       call tool_create_task(title=query[:80], description=answer[:300], priority="Medium")
  7. Return {agent_id, agent_name, steps, answer, task_created, knowledge_results}
```

### Problems with this approach

| Issue | Impact |
|-------|--------|
| Tool selection is hardcoded (keyword matching, not LLM-driven) | Not a real agent — deterministic script |
| Single-pass — no iteration | Cannot plan, reflect, or try again |
| Tools listed in agent definition not fully used | `summarize_document` listed for knowledge agent but never called in `execute_agent()` |
| No dynamic tool discovery | Cannot use tools not explicitly wired |
| No state machine | No concept of "current state" in the graph sense |
| Task creation not persisted | `tool_create_task()` returns a dict with a UUID but saves nothing to DB |
| No error recovery | If KB search returns nothing + LLM fails, error propagates as 500 |

---

## LangGraph Comparison

| Feature | LangGraph (Required) | AIRA Agent (Actual) |
|---------|---------------------|---------------------|
| Graph framework | `langgraph` library | Not used |
| State object | TypedDict/BaseModel state | Not implemented |
| Nodes | Python functions as graph nodes | Python functions (not in graph) |
| Edges | Explicit connections | Not implemented |
| Conditional routing | `add_conditional_edges()` | Hardcoded if/elif |
| Tool calling | LLM function-calling API | Keyword trigger in query string |
| Iterative reasoning | Agent can loop until answer found | Single pass only |
| Memory | LangGraph checkpoints/persistence | None |
| Human-in-loop | Interrupt + resume | Not implemented |

---

## Agent Execution Trace (Engineering Agent example)

**Input:** `agent_id="engineering"`, `query="Show me open issues in the repo"`

```
Step 1: tool_search_knowledge("Show me open issues in the repo")
  → similarity_search(...) → [KB chunks if any docs uploaded]
  → kb_result = {found: True/False, results: [...]}

Step 2: agent_id == "engineering" → GitHub check
  "issue" in "show me open issues in the repo" → True
  → tool_get_github_issues()
  → get_github_issues(None) → [GITHUB_REPO or mock issues]
  → github_context = JSON string of issues

Step 3: Build context
  → KB results as source blocks + github_context JSON

Step 4: LLM call
  → system_prompt = Engineering Agent prompt
  → user_prompt = "User Query: Show me open issues...\nContext: {kb_context}{github_context}"
  → get_llm_response() → answer string

Step 5: task creation check
  agent_id != "task" → skip

Return: {steps: [...], answer: "...", task_created: None, knowledge_results: [...]}
```

---

## What is Missing for a Real Agent

1. **LangGraph:** Install `langgraph` and build actual graph with State → Plan → Tool → Observe → Decide nodes
2. **LLM Tool Selection:** Use Groq/Gemini function-calling API to let LLM decide which tools to call
3. **Iterative Loop:** Allow agent to call multiple tools in sequence, observe results, plan next step
4. **Agent Memory:** Persist agent state across turns using LangGraph checkpointers
5. **Tool Registry:** Dynamic tool discovery instead of hardcoded agent-tool mapping
6. **Task Persistence:** `tool_create_task()` must write to MongoDB
7. **Error Recovery:** Retry failed tool calls, fallback strategies

---

## Agent Feature Status

| Feature | Status |
|---------|--------|
| Agent definitions (3 types) | ✅ IMPLEMENTED |
| Knowledge search tool (real) | ✅ IMPLEMENTED |
| GitHub tools (real + mock) | ✅ IMPLEMENTED |
| LLM response generation | ✅ IMPLEMENTED |
| Task creation (simulated) | ⚠️ MOCK — not persisted |
| LangGraph framework | ❌ NOT IMPLEMENTED |
| LLM-driven tool selection | ❌ NOT IMPLEMENTED |
| Iterative reasoning | ❌ NOT IMPLEMENTED |
| Agent memory | ❌ NOT IMPLEMENTED |
| Conditional graph routing | ❌ NOT IMPLEMENTED |
| Dynamic tool registry | ❌ NOT IMPLEMENTED |
