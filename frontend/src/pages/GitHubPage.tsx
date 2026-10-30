import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { getUser } from "../services/auth";
import {
  IconGithub,
  IconCheck,
  IconSparkles,
  IconLock,
  IconFolder,
  IconBug,
  IconGitPullRequest,
  IconZap,
  IconX,
  IconAlertTriangle,
} from "../components/icons";
import {
  getGithubStatus,
  connectGithubPat,
  disconnectGithub,
  getGithubOAuthAuthorizeUrl,
  type GitHubConnectionStatus,
} from "../services/api";

export default function GitHubPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = getUser();
  const role = user?.role || "member";
  const isViewer = role === "viewer";

  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // PAT Fallback modal state
  const [showPatModal, setShowPatModal] = useState(false);
  const [patToken, setPatToken] = useState("");
  const [patLoading, setPatLoading] = useState(false);

  // Disconnect Confirmation Modal state
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);

  // OAuth Loading state
  const [oauthLoading, setOauthLoading] = useState(false);

  // Handle URL query parameters from OAuth redirect
  useEffect(() => {
    const oauthError = searchParams.get("error");
    const connectionSuccess = searchParams.get("connection");
    const connectedUsername = searchParams.get("username");

    if (oauthError) {
      setError(`GitHub OAuth connection failed: ${decodeURIComponent(oauthError)}`);
    } else if (connectionSuccess === "success") {
      setSuccessMsg(
        connectedUsername
          ? `Successfully connected GitHub account '${connectedUsername}' to your workspace!`
          : "Successfully connected GitHub to your workspace!"
      );
    }
  }, [searchParams]);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const data = await getGithubStatus();
      setStatus(data);
    } catch (err: any) {
      setError(err.message || "Failed to load GitHub connection status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleConnectOAuth() {
    setOauthLoading(true);
    setError(null);
    try {
      const authUrl = await getGithubOAuthAuthorizeUrl();
      window.location.href = authUrl;
    } catch (err: any) {
      setError(err.message || "Failed to initiate GitHub authorization");
      setOauthLoading(false);
    }
  }

  async function handleConnectPat(e: React.FormEvent) {
    e.preventDefault();
    if (!patToken.trim()) return;
    setPatLoading(true);
    setError(null);
    try {
      const res = await connectGithubPat(patToken.trim());
      setSuccessMsg(res.message || "Successfully connected GitHub account");
      setShowPatModal(false);
      setPatToken("");
      await loadStatus();
    } catch (err: any) {
      setError(err.message || "Failed to connect token");
    } finally {
      setPatLoading(false);
    }
  }

  async function handleConfirmDisconnect() {
    setDisconnectLoading(true);
    setError(null);
    try {
      await disconnectGithub();
      setSuccessMsg("Workspace GitHub connection disconnected successfully");
      setShowDisconnectModal(false);
      await loadStatus();
    } catch (err: any) {
      setError(err.message || "Failed to disconnect");
    } finally {
      setDisconnectLoading(false);
    }
  }

  return (
    <div
      className={`min-h-full flex-1 px-5 py-6 transition-colors duration-300 sm:px-8 md:px-10 md:py-8 ${
        theme === "dark" ? "bg-[#060812] text-zinc-100" : "bg-slate-50 text-slate-900"
      }`}
    >
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                GitHub Integration
              </h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                  status?.connected
                    ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                    : "border border-amber-500/30 bg-amber-500/15 text-amber-400"
                }`}
              >
                {loading ? "Checking..." : status?.connected ? "Connected" : "Not Connected"}
              </span>
            </div>
            <p className={`mt-1 text-sm ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
              Manage your workspace-wide GitHub integration for repositories, issues, and pull requests.
            </p>
          </div>

          {/* Role Indicator */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span
              className={`rounded-lg px-2.5 py-1 text-xs font-extrabold uppercase tracking-wider ${
                role === "admin"
                  ? "border border-purple-500/40 bg-purple-500/20 text-purple-300"
                  : role === "viewer"
                  ? "border border-amber-500/40 bg-amber-500/20 text-amber-300"
                  : "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
              }`}
            >
              Role: {role}
            </span>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="flex items-center justify-between rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300 backdrop-blur-xl">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-white" aria-label="Close error"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300 backdrop-blur-xl">
            <span>{successMsg}</span>
            <button
              onClick={() => setSuccessMsg(null)}
              className="text-emerald-400 hover:text-white" aria-label="Close success message"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Main Content Card */}
        <div
          className={`rounded-3xl border p-6 backdrop-blur-2xl transition sm:p-8 ${
            theme === "dark"
              ? "border-white/10 bg-white/[0.03] shadow-2xl"
              : "border-slate-200 bg-white shadow-md"
          }`}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent" />
              <p className="mt-4 text-sm font-semibold text-zinc-400">Loading GitHub status...</p>
            </div>
          ) : status?.connected ? (
            /* Connected State */
            <div className="space-y-6">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between border-b pb-6 border-white/10">
                <div className="flex items-center gap-4">
                  {status.avatarUrl ? (
                    <img
                      src={status.avatarUrl}
                      alt={status.githubUsername || "GitHub User"}
                      className="h-16 w-16 rounded-2xl border border-white/15 object-cover shadow-lg"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-gradient-to-br from-purple-600 to-indigo-600 text-2xl font-bold text-white shadow-lg">
                      <IconGithub className="h-8 w-8" />
                    </div>
                  )}

                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold">
                        {status.githubUsername}
                      </h2>
                      <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-300">
                        Active
                      </span>
                    </div>
                    <p className={`mt-0.5 text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                      Connected to workspace {status.connected_at ? `on ${new Date(status.connected_at).toLocaleDateString()}` : ""}
                    </p>
                    <div className="mt-2 flex items-center gap-4 text-xs font-medium text-zinc-400">
                      <span className="inline-flex items-center gap-1"><IconCheck className="h-3.5 w-3.5 text-emerald-500" /><span>OAuth Verified</span></span>
                      <span className="inline-flex items-center gap-1"><IconCheck className="h-3.5 w-3.5 text-emerald-500" /><span>AES-256-GCM Encrypted</span></span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => navigate("/projects")}
                    className={`rounded-xl px-4 py-2.5 text-sm font-bold shadow-md transition active:scale-95 ${
                      theme === "dark"
                        ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:brightness-110"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    Manage Repositories →
                  </button>

                  {!isViewer && (
                    <button
                      onClick={() => setShowDisconnectModal(true)}
                      className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-bold text-red-300 transition hover:bg-red-500/20 active:scale-95"
                    >
                      Disconnect GitHub
                    </button>
                  )}
                </div>
              </div>

              {/* Connected Workspace Note */}
              <div
                className={`rounded-2xl border p-4 text-xs ${
                  theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-slate-50"
                }`}
              >
                <span className="font-bold">Workspace Access:</span> This GitHub connection is shared with all authenticated members and viewers of this workspace. Viewers can inspect repositories and issues in read-only mode, while administrators and members can manage repository tracking.
              </div>
            </div>
          ) : (
            /* Disconnected State */
            <div className="space-y-8">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/15 bg-white/5 text-4xl shadow-xl">
                  <IconGithub className="h-8 w-8" />
                </div>

                <h2 className="mt-4 text-2xl font-black">
                  Connect your GitHub account
                </h2>
                <p className={`mt-2 max-w-lg text-sm ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
                  Link your GitHub workspace to enable code intelligence, inspect issues, and execute tasks with AIRA agents.
                </p>

                {/* Connection Buttons */}
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  {!isViewer ? (
                    <>
                      <button
                        onClick={handleConnectOAuth}
                        disabled={oauthLoading}
                        className="flex items-center gap-2.5 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <IconSparkles className="h-4 w-4 text-cyan-400" />
                        <span>{oauthLoading ? "Redirecting to GitHub..." : "Connect with GitHub (OAuth)"}</span>
                      </button>

                      <button
                        onClick={() => setShowPatModal(true)}
                        className={`rounded-2xl border px-5 py-3 text-sm font-bold transition hover:bg-white/10 active:scale-95 ${
                          theme === "dark"
                            ? "border-white/15 bg-white/5 text-zinc-300"
                            : "border-slate-300 bg-slate-100 text-slate-700"
                        }`}
                      >
                        Use Personal Access Token (Fallback)
                      </button>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs font-semibold text-amber-300">
                      <span className="inline-flex items-center gap-1.5"><IconLock className="h-4 w-4 text-amber-500" /><span>View-only access: GitHub integration must be connected by a workspace administrator or member.</span></span>
                    </div>
                  )}
                </div>
              </div>

              {/* Benefits Grid */}
              <div className="grid gap-4 border-t border-white/10 pt-8 sm:grid-cols-2 lg:grid-cols-4">
                <div
                  className={`rounded-2xl border p-4 ${
                    theme === "dark" ? "border-white/5 bg-white/[0.02]" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <IconFolder className="h-6 w-6 text-cyan-400 mb-1" />
                  <h3 className="mt-2 text-sm font-bold">Access Repositories</h3>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
                    Browse all your public and private repositories securely inside your workspace.
                  </p>
                </div>

                <div
                  className={`rounded-2xl border p-4 ${
                    theme === "dark" ? "border-white/5 bg-white/[0.02]" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <IconBug className="h-6 w-6 text-amber-400 mb-1" />
                  <h3 className="mt-2 text-sm font-bold">Track Issues</h3>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
                    Monitor bugs, feature proposals, and open discussion threads in real-time.
                  </p>
                </div>

                <div
                  className={`rounded-2xl border p-4 ${
                    theme === "dark" ? "border-white/5 bg-white/[0.02]" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <IconGitPullRequest className="h-6 w-6 text-purple-400 mb-1" />
                  <h3 className="mt-2 text-sm font-bold">Pull Requests</h3>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
                    Stay on top of ongoing code reviews and pull requests across your projects.
                  </p>
                </div>

                <div
                  className={`rounded-2xl border p-4 ${
                    theme === "dark" ? "border-white/5 bg-white/[0.02]" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <IconZap className="h-6 w-6 text-blue-400 mb-1" />
                  <h3 className="mt-2 text-sm font-bold">Agent Assistance</h3>
                  <p className={`mt-1 text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
                    Empower Engineering and Task agents to synthesize answers with live repo context.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── PAT Modal (Development Fallback) ── */}
      {showPatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div
            className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl ${
              theme === "dark" ? "border-white/15 bg-[#0f1222] text-white" : "border-slate-200 bg-white text-slate-900"
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Connect via Personal Access Token</h3>
              <button
                onClick={() => setShowPatModal(false)}
                className="text-zinc-400 hover:text-white"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <p className={`mt-2 text-xs leading-5 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
              Enter a fine-grained or classic GitHub Personal Access Token with <code className="text-cyan-400">repo</code> and <code className="text-cyan-400">read:user</code> scopes. It will be encrypted at rest using AES-256-GCM.
            </p>

            <form onSubmit={handleConnectPat} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">
                  GitHub Token
                </label>
                <input
                  type="password"
                  value={patToken}
                  onChange={(e) => setPatToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  required
                  className={`w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition ${
                    theme === "dark"
                      ? "border-white/15 bg-white/5 text-white focus:border-cyan-400"
                      : "border-slate-300 bg-slate-50 text-slate-900 focus:border-blue-500"
                  }`}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPatModal(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={patLoading || !patToken.trim()}
                  className="rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-black transition hover:bg-cyan-400 disabled:opacity-50"
                >
                  {patLoading ? "Verifying..." : "Connect Token"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Disconnect Warning Modal ── */}
      {showDisconnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div
            className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl ${
              theme === "dark" ? "border-white/15 bg-[#0f1222] text-white" : "border-slate-200 bg-white text-slate-900"
            }`}
          >
            <div className="flex items-center gap-3 text-amber-400">
              <IconAlertTriangle className="h-7 w-7 text-amber-500 mx-auto" />
              <h3 className="text-lg font-bold">Disconnect Workspace GitHub?</h3>
            </div>

            <p className={`mt-3 text-xs leading-relaxed ${theme === "dark" ? "text-zinc-300" : "text-slate-600"}`}>
              Disconnecting GitHub will remove the repository integration for <strong>all users in this workspace</strong>. Viewers and members will lose access to live repository synchronization until reconnected.
            </p>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDisconnectModal(false)}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDisconnect}
                disabled={disconnectLoading}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                {disconnectLoading ? "Disconnecting..." : "Yes, Disconnect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
