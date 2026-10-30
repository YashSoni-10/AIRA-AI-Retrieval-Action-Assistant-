import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { getUser } from "../services/auth";
import { getDashboardStats, type DashboardStats } from "../services/api";
import Header from "../components/Header";
import SearchBox from "../components/SearchBox";
import AIAssistant from "../components/AIAssistant";
import ActivityPanel from "../components/ActivityPanel";
import {
  IconUsers,
  IconFileText,
  IconMessageSquare,
  IconClipboardList,
  IconGithub,
  IconSparkles,
  IconFolderKanban,
  IconWorkflow,
  IconInfo,
} from "../components/icons";

export default function Dashboard() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const user = getUser();
  const firstName = user?.name ? user.name.split(" ")[0] : "User";
  const role = user?.role || "member";

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      try {
        const res = await getDashboardStats();
        if (!cancelled && res.success) {
          setStats(res.stats);
        }
      } catch (err) {
        console.warn("Failed to load real dashboard stats:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadStats();
    return () => {
      cancelled = true;
    };
  }, []);

  function fmt(val: number | null | undefined): string {
    if (loading) return "…";
    if (val === null || val === undefined) return "—";
    return val.toLocaleString();
  }

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">
      {/* Desktop Header */}
      <div className="hidden md:block">
        <Header />
      </div>

      {/* Main Dashboard Content */}
      <main
        className={`relative flex-1 px-5 py-6 transition-colors duration-300 sm:px-8 md:px-10 md:py-8 ${
          isDark ? "bg-[#060812] text-zinc-100" : "bg-slate-50 text-slate-900"
        }`}
      >
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Welcome Banner */}
          <section
            className={`relative overflow-hidden rounded-3xl border p-6 sm:p-8 backdrop-blur-2xl transition shadow-2xl ${
              isDark
                ? "border-white/10 bg-white/[0.03]"
                : "border-slate-200 bg-white shadow-sm"
            }`}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                    Welcome back, {firstName}
                  </h1>
                  <span
                    className={`rounded-lg px-2.5 py-0.5 text-xs font-black uppercase tracking-wider ${
                      role === "admin"
                        ? isDark
                          ? "border border-purple-500/40 bg-purple-500/20 text-purple-300"
                          : "border border-purple-300 bg-purple-100 text-purple-800"
                        : role === "viewer"
                        ? isDark
                          ? "border border-amber-500/40 bg-amber-500/20 text-amber-300"
                          : "border border-amber-300 bg-amber-100 text-amber-800"
                        : isDark
                        ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                        : "border border-cyan-300 bg-cyan-100 text-cyan-800"
                    }`}
                  >
                    {role === "viewer" ? "Viewer (Read-Only)" : `${role} Dashboard`}
                  </span>
                </div>

                <p className={`mt-2 text-sm max-w-xl leading-relaxed ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                  {role === "admin"
                    ? "Complete administrative overview of users, documents, vector indexes, and workspace integrations."
                    : role === "member"
                    ? "Manage your workspace intelligence, documents, conversations, and GitHub repository workflows."
                    : "Read-only access to explore indexed workspace documents, AI reasoning, and connected repositories."}
                </p>
              </div>

              {/* Status Chips */}
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                    isDark ? "bg-white/5 border border-white/10 text-zinc-300" : "bg-slate-100 border border-slate-300 text-slate-700"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>MongoDB Live</span>
                </div>

                <div
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                    stats?.githubConnected
                      ? isDark
                        ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                        : "bg-emerald-50 border border-emerald-300 text-emerald-800"
                      : isDark
                      ? "bg-amber-500/15 border border-amber-500/30 text-amber-300"
                      : "bg-amber-50 border border-amber-300 text-amber-800"
                  }`}
                >
                  <IconGithub className="h-3.5 w-3.5" />
                  <span>{stats?.githubConnected ? `GitHub: ${stats.githubUsername}` : "GitHub: Disconnected"}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Viewer Read-Only Notice */}
          {role === "viewer" && (
            <div className={`flex items-center gap-3 rounded-2xl border p-4 text-xs font-medium ${
              isDark ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-amber-300 bg-amber-50 text-amber-900"
            }`}>
              <IconInfo className="h-5 w-5 shrink-0 text-amber-500" />
              <span>
                You are viewing AIRA with <strong>Viewer privileges</strong>. Document upload, document deletion, and role modifications are restricted to workspace administrators and members.
              </span>
            </div>
          )}

          {/* Quick Search */}
          <section>
            <SearchBox />
          </section>

          {/* ── Stats Grid ── */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Admin Stats */}
            {role === "admin" && (
              <>
                <div
                  className={`rounded-2xl border p-5 backdrop-blur-xl transition ${
                    isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white shadow-sm"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                      Total Users
                    </span>
                    <IconUsers className={`h-5 w-5 ${isDark ? "text-purple-400" : "text-purple-600"}`} />
                  </div>
                  <p className="mt-3 text-3xl font-black">{fmt(stats?.totalUsers)}</p>
                  <div className={`mt-2 flex items-center gap-2 text-[10px] font-medium ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                    <span>Admin: {fmt(stats?.usersByRole?.admin)}</span>
                    <span>•</span>
                    <span>Member: {fmt(stats?.usersByRole?.member)}</span>
                    <span>•</span>
                    <span>Viewer: {fmt(stats?.usersByRole?.viewer)}</span>
                  </div>
                </div>
              </>
            )}

            {/* Documents */}
            <div
              className={`rounded-2xl border p-5 backdrop-blur-xl transition ${
                isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                  {role === "admin" ? "Total Documents" : "Indexed Documents"}
                </span>
                <IconFileText className={`h-5 w-5 ${isDark ? "text-cyan-400" : "text-cyan-600"}`} />
              </div>
              <p className="mt-3 text-3xl font-black">{fmt(stats?.totalDocuments)}</p>
              <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>Persistent metadata in MongoDB</p>
            </div>

            {/* Conversations */}
            <div
              className={`rounded-2xl border p-5 backdrop-blur-xl transition ${
                isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                  {role === "admin" ? "All Conversations" : "Conversations"}
                </span>
                <IconMessageSquare className={`h-5 w-5 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
              </div>
              <p className="mt-3 text-3xl font-black">{fmt(stats?.totalConversations)}</p>
              <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>Multi-turn chat threads</p>
            </div>

            {/* Tasks */}
            <div
              onClick={() => navigate("/tasks")}
              className={`cursor-pointer rounded-2xl border p-5 backdrop-blur-xl transition hover:scale-[1.01] ${
                isDark ? "border-white/10 bg-white/[0.02] hover:border-emerald-400/40" : "border-slate-200 bg-white shadow-sm hover:border-emerald-400"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                  {role === "admin" ? "All Tasks" : "Action Items"}
                </span>
                <IconClipboardList className={`h-5 w-5 ${isDark ? "text-emerald-400" : "text-emerald-600"}`} />
              </div>
              <p className="mt-3 text-3xl font-black">{fmt(stats?.totalTasks)}</p>
              <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>Click to manage tasks</p>
            </div>

            {/* GitHub Status */}
            <div
              className={`rounded-2xl border p-5 backdrop-blur-xl transition ${
                isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white shadow-sm"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                  GitHub Workspace
                </span>
                <IconGithub className={`h-5 w-5 ${isDark ? "text-indigo-400" : "text-indigo-600"}`} />
              </div>
              <p className="mt-3 text-xl font-bold truncate">
                {stats?.githubConnected ? stats.githubUsername : "Not Linked"}
              </p>
              <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                {stats?.githubConnected ? "OAuth Active & Synced" : "Click GitHub to connect"}
              </p>
            </div>
          </section>

          {/* ── Role-Specific Actions & Shortcuts ── */}
          <section
            className={`rounded-3xl border p-6 backdrop-blur-xl transition ${
              isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white shadow-sm"
            }`}
          >
            <h2 className="text-lg font-bold">Quick Actions</h2>
            <p className={`mt-0.5 text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
              Common operations available for your current permission level.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {role === "admin" ? (
                <>
                  <button
                    onClick={() => navigate("/admin/users")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20"
                        : "border-purple-200 bg-purple-50 hover:bg-purple-100 shadow-sm"
                    }`}
                  >
                    <IconUsers className={`h-6 w-6 shrink-0 ${isDark ? "text-purple-300" : "text-purple-700"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-purple-300" : "text-purple-800"}`}>Manage Users</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Assign roles & permissions</p>
                    </div>
                  </button>

                  <button
                    onClick={() => navigate("/documents")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20"
                        : "border-cyan-200 bg-cyan-50 hover:bg-cyan-100 shadow-sm"
                    }`}
                  >
                    <IconFileText className={`h-6 w-6 shrink-0 ${isDark ? "text-cyan-300" : "text-cyan-700"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-cyan-300" : "text-cyan-800"}`}>Manage Documents</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Upload and curate workspace</p>
                    </div>
                  </button>

                  <button
                    onClick={() => navigate("/github")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20"
                        : "border-indigo-200 bg-indigo-50 hover:bg-indigo-100 shadow-sm"
                    }`}
                  >
                    <IconGithub className={`h-6 w-6 shrink-0 ${isDark ? "text-indigo-300" : "text-indigo-700"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-indigo-300" : "text-indigo-800"}`}>GitHub Integration</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>OAuth & repo settings</p>
                    </div>
                  </button>

                  <button
                    onClick={() => navigate("/chat")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-white/10 bg-white/5 hover:bg-white/10"
                        : "border-slate-300 bg-slate-50 hover:bg-slate-100 shadow-sm"
                    }`}
                  >
                    <IconSparkles className={`h-6 w-6 shrink-0 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Start AI Chat</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>RAG multi-turn assistant</p>
                    </div>
                  </button>
                </>
              ) : role === "member" ? (
                <>
                  <button
                    onClick={() => navigate("/documents")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20"
                        : "border-cyan-200 bg-cyan-50 hover:bg-cyan-100 shadow-sm"
                    }`}
                  >
                    <IconFileText className={`h-6 w-6 shrink-0 ${isDark ? "text-cyan-300" : "text-cyan-700"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-cyan-300" : "text-cyan-800"}`}>Upload Document</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Index PDF, TXT, MD</p>
                    </div>
                  </button>

                  <button
                    onClick={() => navigate("/chat")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20"
                        : "border-blue-200 bg-blue-50 hover:bg-blue-100 shadow-sm"
                    }`}
                  >
                    <IconSparkles className={`h-6 w-6 shrink-0 ${isDark ? "text-blue-300" : "text-blue-700"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-blue-300" : "text-blue-800"}`}>Start Conversation</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Ask questions with RAG</p>
                    </div>
                  </button>

                  <button
                    onClick={() => navigate("/github")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20"
                        : "border-indigo-200 bg-indigo-50 hover:bg-indigo-100 shadow-sm"
                    }`}
                  >
                    <IconGithub className={`h-6 w-6 shrink-0 ${isDark ? "text-indigo-300" : "text-indigo-700"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-indigo-300" : "text-indigo-800"}`}>Connect GitHub</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Link repositories</p>
                    </div>
                  </button>

                  <button
                    onClick={() => navigate("/projects")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-white/10 bg-white/5 hover:bg-white/10"
                        : "border-slate-300 bg-slate-50 hover:bg-slate-100 shadow-sm"
                    }`}
                  >
                    <IconFolderKanban className={`h-6 w-6 shrink-0 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-white" : "text-slate-900"}`}>View Projects</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Issues & pull requests</p>
                    </div>
                  </button>
                </>
              ) : (
                /* Viewer Actions (Read-Only) */
                <>
                  <button
                    onClick={() => navigate("/documents")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-white/10 bg-white/5 hover:bg-white/10"
                        : "border-slate-300 bg-slate-50 hover:bg-slate-100 shadow-sm"
                    }`}
                  >
                    <IconFileText className={`h-6 w-6 shrink-0 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Browse Documents</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>View indexed documents</p>
                    </div>
                  </button>

                  <button
                    onClick={() => navigate("/chat")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20"
                        : "border-cyan-200 bg-cyan-50 hover:bg-cyan-100 shadow-sm"
                    }`}
                  >
                    <IconSparkles className={`h-6 w-6 shrink-0 ${isDark ? "text-cyan-300" : "text-cyan-700"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-cyan-300" : "text-cyan-800"}`}>Ask Anything (Chat)</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Query knowledge base</p>
                    </div>
                  </button>

                  <button
                    onClick={() => navigate("/projects")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20"
                        : "border-blue-200 bg-blue-50 hover:bg-blue-100 shadow-sm"
                    }`}
                  >
                    <IconFolderKanban className={`h-6 w-6 shrink-0 ${isDark ? "text-blue-300" : "text-blue-700"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-blue-300" : "text-blue-800"}`}>View Repositories</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Read issues & PRs</p>
                    </div>
                  </button>

                  <button
                    onClick={() => navigate("/agents")}
                    className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-95 ${
                      isDark
                        ? "border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20"
                        : "border-purple-200 bg-purple-50 hover:bg-purple-100 shadow-sm"
                    }`}
                  >
                    <IconWorkflow className={`h-6 w-6 shrink-0 ${isDark ? "text-purple-300" : "text-purple-700"}`} />
                    <div>
                      <p className={`text-xs font-bold ${isDark ? "text-purple-300" : "text-purple-800"}`}>Explore Agents</p>
                      <p className={`text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Knowledge, Engineering, Task</p>
                    </div>
                  </button>
                </>
              )}
            </div>
          </section>

          {/* Real Workspace Activity Feed */}
          <ActivityPanel activities={stats?.recentActivity} onViewAll={() => navigate("/documents")} />

          {/* Assistant Banner */}
          <AIAssistant />
        </div>
      </main>
    </div>
  );
}
