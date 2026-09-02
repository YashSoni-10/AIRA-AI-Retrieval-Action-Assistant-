import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { getAgents, executeAgent, type AgentInfo, type AgentExecuteResponse } from "../services/api";

const AGENT_ICONS: Record<string, string> = {
  knowledge: "🧠",
  engineering: "⚙️",
  task: "📋",
};

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
  task_created: Record<string, unknown> | null;
  timestamp: string;
}

function AgentsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [execLogs, setExecLogs] = useState<ExecutionLog[]>([]);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const logIdRef = useRef(0);

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

  const runAgent = async () => {
    if (!selectedAgent || !query.trim() || running) return;
    setRunning(true);
    try {
      const result: AgentExecuteResponse = await executeAgent(selectedAgent, query.trim());
      const log: ExecutionLog = {
        id: ++logIdRef.current,
        agent_id: result.agent_id,
        agent_name: result.agent_name,
        query: result.query,
        answer: result.answer,
        steps: result.steps,
        task_created: result.task_created,
        timestamp: new Date().toLocaleTimeString(),
      };
      setExecLogs((prev) => [log, ...prev]);
      setExpandedLog(log.id);
      setQuery("");
    } catch (err) {
      const errLog: ExecutionLog = {
        id: ++logIdRef.current,
        agent_id: selectedAgent,
        agent_name: selectedAgent,
        query: query.trim(),
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

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">

      {/* Header */}
      <div className={`border-b px-8 py-5 backdrop-blur-xl transition-colors duration-300 ${
        isDark ? "border-white/10 bg-[#090b15]/80 text-white" : "border-slate-200/80 bg-white/80 text-slate-900 shadow-sm"
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>AI Agents</h2>
            <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
              AI agents that can reason, search, and perform tasks
            </p>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            isDark ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-emerald-300 bg-emerald-50 text-emerald-700"
          }`}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            {agents.length} agents online
          </div>
        </div>
      </div>

      <main className={`relative flex-1 px-8 py-8 transition-colors duration-300 ${isDark ? "bg-[#060812]" : "bg-slate-50"}`}>
        <div className="mx-auto max-w-6xl space-y-8">

          {/* Agent Cards */}
          {loadingAgents ? (
            <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-500"}`}>Loading agents...</p>
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
                      {AGENT_ICONS[agent.id] ?? "🤖"}
                    </div>
                    <h3 className={`mt-3 font-bold ${isDark ? "text-white" : "text-slate-900"}`}>{agent.name}</h3>
                    <p className={`mt-1 text-xs leading-5 ${isDark ? "text-zinc-400" : "text-slate-500"}`}>{agent.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {agent.tools.map((tool) => (
                        <span key={tool} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isDark ? "bg-white/10 text-zinc-400" : "bg-slate-100 text-slate-500"
                        }`}>
                          {tool}
                        </span>
                      ))}
                    </div>
                    {isSelected && (
                      <div className={`mt-3 text-xs font-bold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                        ✓ Selected
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Query Input */}
          <div className={`rounded-2xl border p-6 backdrop-blur-2xl ${
            isDark ? "border-white/10 bg-white/[0.03]" : "border-white/80 bg-white/50 shadow-md"
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
                    : "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
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
                    isDark ? "border-white/10 bg-white/[0.03]" : "border-white/80 bg-white/50 shadow-sm"
                  }`}>
                    {/* Log Header */}
                    <button
                      onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                      className="flex w-full items-start justify-between gap-4 p-4 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{AGENT_ICONS[log.agent_id] ?? "🤖"}</span>
                          <span className={`text-xs font-bold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                            {log.agent_name}
                          </span>
                          <span className={`text-xs ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                            · {log.timestamp}
                          </span>
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
                        {/* Steps */}
                        {log.steps.length > 0 && (
                          <div>
                            <p className={`mb-2 text-xs font-semibold ${isDark ? "text-zinc-500" : "text-slate-400"}`}>Steps taken</p>
                            <div className="space-y-1">
                              {log.steps.map((step, i) => (
                                <p key={i} className={`text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>{step}</p>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Answer */}
                        <div>
                          <p className={`mb-2 text-xs font-semibold ${isDark ? "text-zinc-500" : "text-slate-400"}`}>Answer</p>
                          <p className={`whitespace-pre-wrap text-sm leading-6 ${isDark ? "text-zinc-200" : "text-slate-700"}`}>
                            {log.answer}
                          </p>
                        </div>
                        {/* Task Created */}
                        {log.task_created && (
                          <div className={`rounded-xl border p-3 ${isDark ? "border-emerald-400/20 bg-emerald-500/10" : "border-emerald-200 bg-emerald-50"}`}>
                            <p className={`text-xs font-bold ${isDark ? "text-emerald-300" : "text-emerald-700"}`}>
                              ✅ Task Created: {String((log.task_created as Record<string, unknown>).task_id ?? "")}
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
