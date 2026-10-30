import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { getAgents, executeAgent, type AgentInfo, type AgentExecuteResponse, type AgentToolCall, type Citation } from "../services/api";
import { createConversation, saveMessage, getMessages, getUser, type ChatMessage } from "../services/auth";
import MarkdownRenderer from "../components/MarkdownRenderer";
import {
  IconBrain,
  IconWorkflow,
  IconClipboardList,
  IconBot,
  IconSearch,
  IconFileText,
  IconListChecks,
  IconEdit,
  IconGithub,
  IconBug,
  IconGitPullRequest,
  IconZap,
  IconCheck,
  IconCheckCircle2,
} from "../components/icons";



function AgentIcon({ id, className = "h-5 w-5" }: { id: string; className?: string }) {
  if (id === "knowledge") return <IconBrain className={className} />;
  if (id === "engineering") return <IconWorkflow className={className} />;
  if (id === "task") return <IconClipboardList className={className} />;
  return <IconBot className={className} />;
}

function ToolIcon({ tool, className = "h-4 w-4" }: { tool: string; className?: string }) {
  switch (tool) {
    case "search_knowledge":
    case "get_task":
    case "search_tasks":
      return <IconSearch className={className} />;
    case "summarize_document":
      return <IconFileText className={className} />;
    case "create_task":
      return <IconClipboardList className={className} />;
    case "list_tasks":
      return <IconListChecks className={className} />;
    case "update_task":
      return <IconEdit className={className} />;
    case "list_github_repos":
      return <IconGithub className={className} />;
    case "get_github_issues":
      return <IconBug className={className} />;
    case "get_github_pulls":
      return <IconGitPullRequest className={className} />;
    default:
      return <IconZap className={className} />;
  }
}

const AGENT_COLORS: Record<string, { dark: string; light: string }> = {
  knowledge: {
    dark: "border-cyan-400/20 bg-cyan-500/10 text-cyan-300",
    light: "border-blue-200 bg-blue-50 text-blue-600",
  },
  engineering: {
    dark: "border-violet-400/20 bg-violet-500/10 text-violet-300",
    light: "border-violet-200 bg-violet-50 text-violet-600",
  },
  task: {
    dark: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
    light: "border-emerald-200 bg-emerald-50 text-emerald-600",
  },
};



interface ExecutionLog {
  id: number;
  agent_id: string;
  agent_name: string;
  query: string;
  answer: string;
  steps: string[];
  tool_calls?: AgentToolCall[];
  citations?: Citation[];
  confidence?: number;
  task_created: Record<string, unknown> | null;
  timestamp: string;
}

function AgentsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const currentUser = getUser();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [execLogs, setExecLogs] = useState<ExecutionLog[]>([]);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const logIdRef = useRef(0);
  // User-scoped conversation ID for persisting agent session to MongoDB (Phase 5B)
  const agentConvIdRef = useRef<string | null>(null);
  const agentConvKey = currentUser
    ? `aira_agent_conv_${currentUser._id || currentUser.id || "default"}`
    : "aira_agent_conversation_id";

  const fetchAgents = useCallback(async () => {
    try {
      const data = await getAgents();
      setAgents(data.agents);
      if (data.agents.length > 0) setSelectedAgent(data.agents[0].id);
    } catch {
      setAgents([]);
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // On mount: restore or create the persistent agent conversation, then load logs
  useEffect(() => {
    let cancelled = false;
    async function initAgentSession() {
      const storedConvId = localStorage.getItem(agentConvKey);
      let convId = storedConvId;

      if (convId) {
        // Validate stored conversation is accessible by current user
        try {
          const res = await getMessages(convId, 1, 100);
          if (cancelled) return;
          if (res.success && Array.isArray(res.messages)) {
            agentConvIdRef.current = convId;
            // Pair user+assistant messages back into ExecutionLogs
            const msgs = res.messages;
            const restored: ExecutionLog[] = [];
            for (let i = 0; i < msgs.length - 1; i += 2) {
              const userMsg: ChatMessage = msgs[i];
              const aiMsg: ChatMessage = msgs[i + 1];
              if (userMsg?.role !== "user" || aiMsg?.role !== "assistant") continue;

              let steps: string[] = [];
              let answer = aiMsg.content;
              let agent_id = "knowledge";
              let agent_name = "Knowledge Agent";
              let tool_calls: AgentToolCall[] = [];
              let task_created: Record<string, unknown> | null = null;

              try {
                const parsed = JSON.parse(aiMsg.content);
                answer = parsed.answer ?? aiMsg.content;
                steps = parsed.steps ?? [];
                agent_id = parsed.agent_id ?? "knowledge";
                agent_name = parsed.agent_name ?? (agent_id.charAt(0).toUpperCase() + agent_id.slice(1) + " Agent");
                tool_calls = parsed.tool_calls ?? [];
                task_created = parsed.task_created ?? null;
              } catch {
                // plain text answer fallback
              }

              restored.push({
                id: ++logIdRef.current,
                agent_id,
                agent_name,
                query: userMsg.content,
                answer,
                steps,
                tool_calls,
                citations: aiMsg.sources?.map((s) => ({
                  filename: s.filename,
                  chunk_index: s.chunk_index,
                  excerpt: s.excerpt,
                  score: s.score,
                  page_number: s.page_number,
                  score_label: s.score_label,
                  raw_score: s.raw_score,
                  score_type: s.score_type,
                })),
                confidence: aiMsg.meta?.confidence ?? undefined,
                task_created,
                timestamp: new Date(aiMsg.createdAt).toLocaleTimeString(),
              });
            }
            if (restored.length > 0) {
              setExecLogs(restored.reverse()); // most recent first
            }
            return;
          }
        } catch {
          // Stored ID belongs to another user or no longer exists in DB — reset it
          localStorage.removeItem(agentConvKey);
          convId = null;
        }
      }

      // If no valid conversation exists, create a fresh "Agent Session"
      if (!convId) {
        try {
          const res = await createConversation("Agent Session");
          if (!cancelled && res.success) {
            agentConvIdRef.current = res.conversation._id;
            localStorage.setItem(agentConvKey, res.conversation._id);
          }
        } catch {
          // DB offline — proceed without persistence
        }
      }
    }
    initAgentSession();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentConvKey]);

  // Sanitize tool calls to avoid persisting access tokens or secrets
  const sanitizeToolCalls = (calls?: AgentToolCall[]): AgentToolCall[] | undefined => {
    if (!calls || calls.length === 0) return undefined;
    return calls.map((c) => {
      const cleanArgs: Record<string, unknown> = {};
      if (c.arguments) {
        for (const [k, v] of Object.entries(c.arguments)) {
          if (/token|password|secret|key|auth/i.test(k)) {
            cleanArgs[k] = "[REDACTED]";
          } else if (typeof v === "string" && (v.startsWith("ghp_") || v.startsWith("github_pat_"))) {
            cleanArgs[k] = "[REDACTED]";
          } else {
            cleanArgs[k] = v;
          }
        }
      }
      return { ...c, arguments: cleanArgs };
    });
  };

  const runAgent = async () => {
    if (!selectedAgent || !query.trim() || running) return;
    setRunning(true);
    const queryText = query.trim();
    try {
      const result: AgentExecuteResponse = await executeAgent(selectedAgent, queryText);
      const log: ExecutionLog = {
        id: ++logIdRef.current,
        agent_id: result.agent_id,
        agent_name: result.agent_name,
        query: result.query,
        answer: result.answer,
        steps: result.steps,
        tool_calls: result.tool_calls,
        citations: result.citations,
        confidence: result.confidence,
        task_created: result.task_created,
        timestamp: new Date().toLocaleTimeString(),
      };
      setExecLogs((prev) => [log, ...prev]);
      setExpandedLog(log.id);
      setQuery("");

      // Persist to MongoDB (fire-and-forget — UI never blocks)
      if (agentConvIdRef.current) {
        const convId = agentConvIdRef.current;
        saveMessage(convId, "user", queryText).catch(() => {});
        // Encode full agent metadata so it can be restored on reload
        const aiContent = JSON.stringify({
          agent_id: result.agent_id,
          agent_name: result.agent_name,
          answer: result.answer,
          steps: result.steps,
          tool_calls: sanitizeToolCalls(result.tool_calls) || [],
          task_created: result.task_created || null,
        });
        saveMessage(
          convId,
          "assistant",
          aiContent,
          (result.citations ?? []).map((c) => ({
            filename: c.filename,
            chunk_index: c.chunk_index,
            excerpt: c.excerpt,
            score: c.score,
            page_number: c.page_number,
            score_label: c.score_label,
            raw_score: c.raw_score,
            score_type: c.score_type,
          })),
          { confidence: result.confidence ?? null, confidence_label: null, chunks_found: null }
        ).catch(() => {});
      }
    } catch (err) {
      const errLog: ExecutionLog = {
        id: ++logIdRef.current,
        agent_id: selectedAgent,
        agent_name: selectedAgent,
        query: queryText,
        answer: err instanceof Error ? `Error: ${err.message}` : "Unknown error",
        steps: [],
        task_created: null,
        timestamp: new Date().toLocaleTimeString(),
      };
      setExecLogs((prev) => [errLog, ...prev]);
    } finally {
      setRunning(false);
    }
  };

  const clearAgentLogs = () => {
    setExecLogs([]);
    setExpandedLog(null);
    localStorage.removeItem(agentConvKey);
    agentConvIdRef.current = null;
    // Start a fresh conversation for the next session
    createConversation("Agent Session")
      .then((res) => {
        if (res.success) {
          agentConvIdRef.current = res.conversation._id;
          localStorage.setItem(agentConvKey, res.conversation._id);
        }
      })
      .catch(() => {});
  };


  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">

      {/* Header */}
      <div className={`border-b px-8 py-5 backdrop-blur-xl transition-colors duration-300 ${
        isDark ? "border-white/10 bg-[#090b15]/80 text-white" : "border-slate-200/80 bg-white/80 text-slate-900 shadow-sm"
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>AI Agents</h2>
            <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
              AI agents that can reason, search, and perform tasks
            </p>
          </div>
          <div className="flex items-center gap-2">
            {execLogs.length > 0 && (
              <button
                id="agent-clear-logs-btn"
                onClick={clearAgentLogs}
                title="Clear all execution logs and start a new session"
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  isDark ? "border-white/10 text-zinc-400 hover:border-rose-400/50 hover:text-rose-400" : "border-slate-200 text-slate-500 hover:border-rose-400 hover:text-rose-600"
                }`}
              >
                Clear Logs
              </button>
            )}
            <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              isDark ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-emerald-300 bg-emerald-50 text-emerald-700"
            }`}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {agents.length} agents online
            </div>
          </div>
        </div>
      </div>

      <main className={`relative flex-1 px-8 py-8 transition-colors duration-300 ${isDark ? "bg-[#060812]" : "bg-slate-50"}`}>
        <div className="mx-auto max-w-6xl space-y-8">

          {/* Agent Cards */}
          {loadingAgents ? (
            <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Loading agents...</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {agents.map((agent) => {
                const colors = AGENT_COLORS[agent.id] ?? AGENT_COLORS.knowledge;
                const isSelected = selectedAgent === agent.id;
                return (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent.id)}
                    className={`rounded-2xl border p-5 text-left transition-all hover:-translate-y-1 ${
                      isSelected
                        ? isDark
                          ? "border-cyan-400/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(6,182,212,0.2)]"
                          : "border-blue-400 bg-blue-50 shadow-lg shadow-blue-100"
                        : isDark
                        ? "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                        : "border-white/80 bg-white/45 hover:border-slate-300 hover:bg-white/70 hover:shadow-md"
                    }`}
                  >
                    <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border text-2xl ${
                      isDark ? colors.dark : colors.light
                    }`}>
                      <AgentIcon id={agent.id} className="h-6 w-6" />
                    </div>
                    <h3 className={`mt-3 font-bold ${isDark ? "text-white" : "text-slate-900"}`}>{agent.name}</h3>
                    <p className={`mt-1 text-xs leading-5 ${isDark ? "text-zinc-400" : "text-slate-600"}`}>{agent.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {agent.tools?.map((tool) => (
                        <span key={tool} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isDark ? "bg-white/10 text-zinc-400" : "bg-slate-100 text-slate-700"
                        }`}>
                          {tool}
                        </span>
                      ))}
                    </div>
                    {isSelected && (
                      <div className={`mt-3 text-xs font-bold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                        <span className="inline-flex items-center gap-1"><IconCheck className="h-3.5 w-3.5" /><span>Selected</span></span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Query Input */}
          <div className={`rounded-2xl border p-6 backdrop-blur-2xl ${
            isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white shadow-sm"
          }`}>
            <h3 className={`text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
              Run Agent: <span className={isDark ? "text-cyan-400" : "text-blue-600"}>
                {agents.find((a) => a.id === selectedAgent)?.name ?? "Select an agent above"}
              </span>
            </h3>
            <div className="mt-4 flex gap-3">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runAgent(); }}
                placeholder={
                  selectedAgent === "task"
                    ? "e.g. Create a task to review the API documentation"
                    : selectedAgent === "engineering"
                    ? "e.g. Explain the payment service architecture"
                    : "e.g. What is the remote work policy?"
                }
                disabled={running || !selectedAgent}
                className={`flex-1 rounded-xl border px-4 py-3 text-sm outline-none transition ${
                  isDark
                    ? "border-white/10 bg-zinc-950/60 text-white placeholder:text-zinc-500 focus:border-cyan-400/60"
                    : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                }`}
              />
              <button
                onClick={runAgent}
                disabled={!query.trim() || running || !selectedAgent}
                className={`rounded-xl px-5 py-3 text-sm font-bold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${
                  isDark
                    ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white"
                    : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md"
                }`}
              >
                {running ? "Running..." : "Run ▶"}
              </button>
            </div>
          </div>

          {/* Execution Logs */}
          {execLogs.length > 0 && (
            <div>
              <h3 className={`mb-3 text-sm font-bold ${isDark ? "text-zinc-300" : "text-slate-700"}`}>
                Execution History ({execLogs.length})
              </h3>
              <div className="space-y-3">
                {execLogs.map((log) => (
                  <div key={log.id} className={`rounded-2xl border backdrop-blur-2xl ${
                    isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white shadow-sm"
                  }`}>
                    {/* Log Header */}
                    <button
                      onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                      className="flex w-full items-start justify-between gap-4 p-4 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <AgentIcon id={log.agent_id} className="h-5 w-5" />
                          <span className={`text-xs font-bold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                            {log.agent_name}
                          </span>
                          <span className={`text-xs ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                            · {log.timestamp}
                          </span>
                          {log.confidence !== undefined && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                              log.confidence >= 0.75
                                ? isDark ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-emerald-300 bg-emerald-50 text-emerald-700"
                                : log.confidence >= 0.5
                                ? isDark ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-amber-300 bg-amber-50 text-amber-700"
                                : isDark ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : "border-rose-300 bg-rose-50 text-rose-700"
                            }`}>
                              {Math.round(log.confidence * 100)}% confidence
                            </span>
                          )}
                        </div>
                        <p className={`mt-1 truncate text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>
                          {log.query}
                        </p>
                      </div>
                      <span className={`text-xs ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                        {expandedLog === log.id ? "▲" : "▼"}
                      </span>
                    </button>

                    {/* Expanded */}
                    {expandedLog === log.id && (
                      <div className={`border-t px-4 pb-4 pt-3 space-y-4 ${isDark ? "border-white/10" : "border-slate-100"}`}>
                        {/* Tool Executions */}
                        {log.tool_calls && log.tool_calls.length > 0 && (
                          <div>
                            <p className={`mb-2 text-xs font-semibold ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                              Tool Executions ({log.tool_calls.length})
                            </p>
                            <div className="space-y-2">
                              {log.tool_calls.map((tc, idx) => (
                                <div
                                  key={idx}
                                  className={`rounded-xl border p-3 ${
                                    isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200/80 bg-slate-50/80"
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <ToolIcon tool={tc.tool} className="h-4 w-4" />
                                    <span className={`text-xs font-mono font-semibold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                                      {tc.tool}
                                    </span>
                                  </div>
                                  {tc.arguments && Object.keys(tc.arguments).length > 0 && (
                                    <div className={`mt-2 rounded-lg p-2 font-mono text-[11px] overflow-x-auto ${
                                      isDark ? "bg-black/30 text-zinc-300" : "bg-white text-slate-600 border border-slate-200"
                                    }`}>
                                      {Object.entries(tc.arguments).map(([k, v]) => (
                                        <div key={k} className="truncate">
                                          <span className="text-zinc-500">{k}:</span> {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {tc.result_summary && (
                                    <p className={`mt-2 text-xs italic ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                                      ↳ {tc.result_summary}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Citations */}
                        {log.citations && log.citations.length > 0 && (
                          <div>
                            <p className={`mb-2 text-xs font-semibold ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                              Knowledge Citations ({log.citations.length})
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {log.citations.map((cite, i) => (
                                <div
                                  key={i}
                                  className={`rounded-xl border p-2.5 text-xs ${
                                    isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white shadow-xs"
                                  }`}
                                >
                                  <div className="flex items-center justify-between font-mono font-semibold">
                                    <span className={`truncate ${isDark ? "text-cyan-300" : "text-blue-600"}`}>
                                      <span className="inline-flex items-center gap-1.5"><IconFileText className="h-3.5 w-3.5" /><span>{cite.filename}</span></span>
                                    </span>
                                    <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                                      chunk {cite.chunk_index} · {cite.score.toFixed(3)}
                                    </span>
                                  </div>
                                  {cite.excerpt && (
                                    <p className={`mt-1.5 line-clamp-3 text-[11px] leading-relaxed italic ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                                      "{cite.excerpt}"
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Steps */}
                        {log.steps.length > 0 && (
                          <div>
                            <p className={`mb-2 text-xs font-semibold ${isDark ? "text-zinc-500" : "text-slate-400"}`}>Steps taken</p>
                            <div className="space-y-1">
                              {log.steps.map((step, i) => (
                                <p key={i} className={`text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>{step}</p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Answer */}
                        <div>
                          <p className={`mb-2 text-xs font-semibold ${isDark ? "text-zinc-500" : "text-slate-400"}`}>Answer</p>
                          <MarkdownRenderer content={log.answer} isDark={isDark} />
                        </div>

                        {/* Task Created */}
                        {log.task_created && (
                          <div className={`rounded-xl border p-3 ${isDark ? "border-emerald-400/20 bg-emerald-500/10" : "border-emerald-200 bg-emerald-50"}`}>
                            <p className={`text-xs font-bold ${isDark ? "text-emerald-300" : "text-emerald-700"}`}>
                              <span className="inline-flex items-center gap-1.5"><IconCheckCircle2 className="h-4 w-4 text-emerald-500" /><span>Task Created: {String((log.task_created as Record<string, unknown>).task_id ?? "")}</span></span>
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default AgentsPage;
