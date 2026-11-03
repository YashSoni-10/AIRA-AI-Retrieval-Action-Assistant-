import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import {
  getGithubRepos,
  getGithubIssues,
  getGithubPulls,
  getGithubStatus,
  addGithubRepo,
  type GitHubRepo,
  type GitHubIssue,
  type GitHubPullRequest,
} from "../services/api";
import { getUser } from "../services/auth";
import {
  IconGithub,
  IconFolder,
  IconAlertTriangle,
  IconGitFork,
  IconX,
} from "../components/icons";

function ProjectsPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const isDark = theme === "dark";
  const user = getUser();
  const role = user?.role || "member";
  const canAddRepo = role === "admin" || role === "member";

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState<boolean>(false);
  const [isGithubConnected, setIsGithubConnected] = useState<boolean>(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);

  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);

  const [pulls, setPulls] = useState<GitHubPullRequest[]>([]);
  const [loadingPulls, setLoadingPulls] = useState(false);

  const [activeTab, setActiveTab] = useState<"issues" | "pulls">("issues");

  // Add Repository Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDesc, setNewRepoDesc] = useState("");
  const [newRepoLang, setNewRepoLang] = useState("TypeScript");
  const [addingRepo, setAddingRepo] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true);
    setRepoError(null);
    try {
      const [reposRes, statusRes] = await Promise.allSettled([
        getGithubRepos(),
        getGithubStatus(),
      ]);

      if (reposRes.status === "fulfilled") {
        setRepos(reposRes.value.repositories);
        setIsMock(Boolean(reposRes.value.is_mock));
        if (reposRes.value.repositories.length > 0) {
          setSelectedRepo((prev) => prev || reposRes.value.repositories[0].full_name);
        }
      } else {
        throw new Error("Failed to load repositories");
      }

      if (statusRes.status === "fulfilled") {
        setIsGithubConnected(Boolean(statusRes.value.connected));
      }
    } catch (err) {
      setRepoError(err instanceof Error ? err.message : "Failed to load repositories");
      setRepos([]);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  const fetchRepoDetails = useCallback(async (repoFullName: string) => {
    setLoadingIssues(true);
    setLoadingPulls(true);
    try {
      const issuesData = await getGithubIssues(repoFullName);
      setIssues(issuesData.issues);

      const pullsData = await getGithubPulls(repoFullName);
      setPulls(pullsData.pulls);
    } catch {
      setIssues([]);
      setPulls([]);
    } finally {
      setLoadingIssues(false);
      setLoadingPulls(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  useEffect(() => {
    if (selectedRepo) {
      fetchRepoDetails(selectedRepo);
    }
  }, [selectedRepo, fetchRepoDetails]);

  const handleAddRepository = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepoName.trim()) {
      setAddError("Repository name is required.");
      return;
    }

    setAddingRepo(true);
    setAddError(null);

    try {
      const fullName = newRepoName.includes("/")
        ? newRepoName.trim()
        : `workspace/${newRepoName.trim()}`;

      const res = await addGithubRepo({
        name: newRepoName.trim().split("/").pop() || newRepoName.trim(),
        full_name: fullName,
        description: newRepoDesc.trim() || "User connected repository.",
        language: newRepoLang,
      });

      const created = res.repository;
      setRepos((prev) => [created, ...prev]);
      setSelectedRepo(created.full_name);
      setNewRepoName("");
      setNewRepoDesc("");
      setShowAddModal(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add repository.");
    } finally {
      setAddingRepo(false);
    }
  };

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">
      {/* Page Header */}
      <div
        className={`border-b px-8 py-5 backdrop-blur-xl transition-colors duration-300 ${
          isDark
            ? "border-white/10 bg-[#090a13]/80 text-white"
            : "border-slate-200/80 bg-white/80 text-slate-900 shadow-sm"
        }`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
              Projects & Repositories
            </h2>
            <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
              Explore GitHub integration workspace status, issues, and pull requests
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Status indicator */}
            {loadingRepos ? (
              <div
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  isDark
                    ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300"
                    : "border-blue-200 bg-blue-50 text-blue-700"
                }`}
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                Connecting to GitHub...
              </div>
            ) : repoError ? (
              <div className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                Offline / Error
              </div>
            ) : isMock ? (
              <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                Development Mock Fallback
              </div>
            ) : (
              <div
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  isDark
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Connected • Live GitHub Data
              </div>
            )}

            {/* Add Repository Option (Visible to Admin & Member) */}
            {canAddRepo && (
              <button
                onClick={() => setShowAddModal(true)}
                className={`rounded-xl px-4 py-2 text-xs font-bold shadow-md transition hover:brightness-110 active:scale-95 ${
                  isDark
                    ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white"
                    : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
                }`}
              >
                + Add Repository
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main
        className={`relative flex-1 px-8 py-8 transition-colors duration-300 ${
          isDark ? "bg-[#060812]" : "bg-slate-50"
        }`}
      >
        <div className="mx-auto max-w-6xl space-y-6">
          {/* GitHub Connection Notice */}
          {!isGithubConnected && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <IconGithub className="h-6 w-6 text-amber-500 shrink-0" />
                <div>
                  <p className="font-bold">GitHub Workspace Not Connected</p>
                  <p className="text-zinc-400">
                    {canAddRepo
                      ? "Connect your workspace to GitHub to synchronize real repositories, track issues, and view pull requests."
                      : "GitHub integration is not currently connected for this workspace."}
                  </p>
                </div>
              </div>

              {canAddRepo ? (
                <button
                  onClick={() => navigate("/github")}
                  className="self-start sm:self-auto shrink-0 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 font-bold text-black transition hover:brightness-110 active:scale-95"
                >
                  Connect GitHub →
                </button>
              ) : (
                <span className="text-[11px] font-semibold text-amber-400">
                  Viewer (Read-Only)
                </span>
              )}
            </div>
          )}

          {/* Section: Projects Header & Grid */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h3
                className={`text-sm font-bold uppercase tracking-wider ${
                  isDark ? "text-zinc-400" : "text-slate-600"
                }`}
              >
                Select Repository ({repos.length})
              </h3>
              {repoError && (
                <button
                  onClick={fetchRepos}
                  className="rounded-lg border border-cyan-500/30 px-3 py-1 text-xs font-semibold text-cyan-400 hover:bg-cyan-500/10"
                >
                  Retry
                </button>
              )}
            </div>

            {loadingRepos ? (
              <div className="py-12 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                <p className={`mt-3 text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                  Loading projects from GitHub...
                </p>
              </div>
            ) : repoError ? (
              <div
                className={`rounded-2xl border p-8 text-center backdrop-blur-2xl ${
                  isDark ? "border-red-500/20 bg-red-500/5" : "border-red-200 bg-red-50/50"
                }`}
              >
                <IconAlertTriangle className="h-8 w-8 text-rose-500 mx-auto" />
                <h4 className={`mt-2 font-bold ${isDark ? "text-white" : "text-slate-800"}`}>
                  Could not load repositories
                </h4>
                <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                  {repoError}
                </p>
                <button
                  onClick={fetchRepos}
                  className="mt-4 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-cyan-500"
                >
                  Retry Connection
                </button>
              </div>
            ) : repos.length === 0 ? (
              <div
                className={`rounded-2xl border p-12 text-center backdrop-blur-2xl ${
                  isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white/60 shadow-sm"
                }`}
              >
                <IconFolder className="h-8 w-8 text-cyan-400 mx-auto" />
                <h4 className={`mt-2 font-bold ${isDark ? "text-white" : "text-slate-800"}`}>
                  No repositories found
                </h4>
                <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                  {canAddRepo
                    ? "Add your first GitHub repository to track issues and pull requests."
                    : "No repositories have been connected to this workspace yet."}
                </p>
                {canAddRepo && (
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="mt-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:brightness-110"
                  >
                    + Add Repository
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {repos.map((repo) => {
                  const isSelected = selectedRepo === repo.full_name;
                  return (
                    <button
                      key={repo.id}
                      onClick={() => setSelectedRepo(repo.full_name)}
                      className={`rounded-2xl border p-5 text-left transition-all hover:-translate-y-1 ${
                        isSelected
                          ? isDark
                            ? "border-cyan-400/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(6,182,212,0.2)]"
                            : "border-blue-400 bg-blue-50 shadow-lg shadow-blue-100"
                          : isDark
                          ? "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70 shadow-sm hover:shadow-md"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <IconFolder className="h-5 w-5 text-cyan-400" />
                        {repo.html_url ? (
                          <a
                            href={repo.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className={`text-[11px] font-bold underline ${
                              isDark
                                ? "text-cyan-400 hover:text-cyan-300"
                                : "text-blue-600 hover:text-blue-800"
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Open in GitHub ↗
                          </a>
                        ) : (
                          <span className="text-[10px] font-semibold text-zinc-500">
                            Workspace Repo
                          </span>
                        )}
                      </div>

                      <h4
                        className={`mt-3 truncate text-lg font-bold ${
                          isDark ? "text-white" : "text-slate-900"
                        }`}
                      >
                        {repo.name}
                      </h4>
                      <p
                        className={`mt-1.5 line-clamp-2 text-xs leading-5 ${
                          isDark ? "text-zinc-400" : "text-slate-600"
                        }`}
                      >
                        {repo.description || "No description provided."}
                      </p>

                      <div className="mt-4 flex items-center gap-3 text-[11px] font-semibold">
                        <span
                          className={`rounded-full px-2 py-0.5 ${
                            isDark ? "bg-white/10 text-zinc-300" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {repo.language || "Unknown"}
                        </span>
                        <span className={isDark ? "text-zinc-500" : "text-slate-600"}>
                          ⭐ {repo.stargazers_count}
                        </span>
                        <span className={isDark ? "text-zinc-500" : "text-slate-600"}>
                          <span className="inline-flex items-center gap-1"><IconGitFork className="h-3 w-3" /><span>{repo.forks_count}</span></span>
                        </span>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t pt-3 text-[11px]">
                        <span className={isDark ? "text-zinc-500" : "text-slate-600"}>
                          {repo.full_name}
                        </span>
                        <span
                          className={`font-bold ${
                            repo.open_issues_count > 0 ? "text-amber-500" : "text-emerald-500"
                          }`}
                        >
                          {repo.open_issues_count} issues
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section: Repository Live Details (Issues / PRs) */}
          {selectedRepo && (
            <div
              className={`rounded-2xl border p-6 backdrop-blur-2xl ${
                isDark
                  ? "border-white/10 bg-white/[0.03]"
                  : "border-white/80 bg-white/50 shadow-md"
              }`}
            >
              <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                    Active Status:{" "}
                    <span className={isDark ? "text-cyan-400" : "text-blue-600"}>
                      {selectedRepo.includes("/") ? selectedRepo.split("/")[1] : selectedRepo}
                    </span>
                  </h3>
                  <p className={`text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                    {isMock ? "Development Mock Fallback" : "Connected • Live GitHub Data"}
                  </p>
                </div>

                {/* Tabs */}
                <div
                  className={`flex rounded-xl border p-1 ${
                    isDark
                      ? "border-white/10 bg-white/[0.04]"
                      : "border-slate-200 bg-slate-100"
                  }`}
                >
                  <button
                    onClick={() => setActiveTab("issues")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeTab === "issues"
                        ? isDark
                          ? "border border-cyan-400/20 bg-cyan-500/20 text-white"
                          : "bg-white text-slate-800 shadow-sm"
                        : isDark
                        ? "text-zinc-400"
                        : "text-slate-500"
                    }`}
                  >
                    Issues ({issues.length})
                  </button>
                  <button
                    onClick={() => setActiveTab("pulls")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeTab === "pulls"
                        ? isDark
                          ? "border border-cyan-400/20 bg-cyan-500/20 text-white"
                          : "bg-white text-slate-800 shadow-sm"
                        : isDark
                        ? "text-zinc-400"
                        : "text-slate-500"
                    }`}
                  >
                    Pull Requests ({pulls.length})
                  </button>
                </div>
              </div>

              {/* Tab Content */}
              <div className="mt-5">
                {activeTab === "issues" ? (
                  loadingIssues ? (
                    <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                      Loading repository issues...
                    </p>
                  ) : issues.length === 0 ? (
                    <p
                      className={`py-6 text-center text-sm ${
                        isDark ? "text-zinc-500" : "text-slate-600"
                      }`}
                    >
                      No issues found in this repository.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {issues.map((issue) => (
                        <div
                          key={issue.number}
                          className={`flex items-center justify-between rounded-xl border p-4 transition ${
                            isDark
                              ? "border-white/5 bg-white/[0.02] hover:border-cyan-400/20"
                              : "border-slate-100 bg-white/70 hover:border-blue-300 hover:shadow-sm"
                          }`}
                        >
                          <div className="min-w-0 flex-1 pr-4">
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase ${
                                  issue.state === "open"
                                    ? "border border-amber-500/30 bg-amber-500/20 text-amber-400"
                                    : "border border-purple-500/30 bg-purple-500/20 text-purple-400"
                                }`}
                              >
                                {issue.state}
                              </span>
                              <span
                                className={`text-[10px] ${
                                  isDark ? "text-zinc-500" : "text-slate-600"
                                }`}
                              >
                                #{issue.number} by {issue.user.login}
                              </span>
                            </div>
                            <h5
                              className={`mt-1.5 truncate text-sm font-semibold ${
                                isDark ? "text-white" : "text-slate-800"
                              }`}
                            >
                              {issue.title}
                            </h5>
                          </div>

                          <a
                            href={issue.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className={`text-xs font-semibold ${
                              isDark
                                ? "text-cyan-400 hover:text-cyan-300"
                                : "text-blue-600 hover:text-blue-800"
                            }`}
                          >
                            View ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  )
                ) : loadingPulls ? (
                  <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                    Loading repository pull requests...
                  </p>
                ) : pulls.length === 0 ? (
                  <p
                    className={`py-6 text-center text-sm ${
                      isDark ? "text-zinc-500" : "text-slate-600"
                    }`}
                  >
                    No pull requests found.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {pulls.map((pr) => (
                      <div
                        key={pr.number}
                        className={`flex items-center justify-between rounded-xl border p-4 transition ${
                          isDark
                            ? "border-white/5 bg-white/[0.02] hover:border-cyan-400/20"
                            : "border-slate-100 bg-white/70 hover:border-blue-300 hover:shadow-sm"
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-4">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase ${
                                pr.state === "open"
                                  ? pr.draft
                                    ? "border border-zinc-500/30 bg-zinc-500/20 text-zinc-400"
                                    : "border border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                                  : "border border-purple-500/30 bg-purple-500/20 text-purple-400"
                              }`}
                            >
                              {pr.state} {pr.draft && "(draft)"}
                            </span>
                            <span
                              className={`text-[10px] ${
                                isDark ? "text-zinc-500" : "text-slate-600"
                              }`}
                            >
                              #{pr.number} by {pr.user.login}
                            </span>
                          </div>
                          <h5
                            className={`mt-1.5 truncate text-sm font-semibold ${
                              isDark ? "text-white" : "text-slate-800"
                            }`}
                          >
                            {pr.title}
                          </h5>
                        </div>

                        <a
                          href={pr.html_url}
                          target="_blank"
                          rel="noreferrer"
                          className={`text-xs font-semibold ${
                            isDark
                              ? "text-cyan-400 hover:text-cyan-300"
                              : "text-blue-600 hover:text-blue-800"
                          }`}
                        >
                          View ↗
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Add Repository Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl transition-colors duration-300 ${
              isDark ? "border-white/10 bg-[#0c1021] text-white" : "border-slate-200 bg-white text-slate-900"
            }`}
          >
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-base font-bold">Add GitHub Repository</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className={`rounded-lg p-1 text-xs hover:bg-white/10 ${
                  isDark ? "text-zinc-400 hover:text-white" : "text-slate-400 hover:text-slate-800"
                }`}
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddRepository} className="mt-4 space-y-4">
              {addError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                  {addError}
                </div>
              )}

              <div>
                <label className={`block text-xs font-semibold ${isDark ? "text-zinc-300" : "text-slate-700"}`}>
                  Repository Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. acme/backend-api or user-portal"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  className={`mt-1.5 w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-cyan-400 ${
                    isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-300 bg-slate-50 text-slate-900"
                  }`}
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold ${isDark ? "text-zinc-300" : "text-slate-700"}`}>
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Brief summary of the repository purpose..."
                  value={newRepoDesc}
                  onChange={(e) => setNewRepoDesc(e.target.value)}
                  className={`mt-1.5 w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-cyan-400 ${
                    isDark ? "border-white/10 bg-white/5 text-white" : "border-slate-300 bg-slate-50 text-slate-900"
                  }`}
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold ${isDark ? "text-zinc-300" : "text-slate-700"}`}>
                  Primary Language
                </label>
                <select
                  value={newRepoLang}
                  onChange={(e) => setNewRepoLang(e.target.value)}
                  className={`mt-1.5 w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-cyan-400 ${
                    isDark ? "border-white/10 bg-[#12162b] text-white" : "border-slate-300 bg-slate-50 text-slate-900"
                  }`}
                >
                  <option value="TypeScript">TypeScript</option>
                  <option value="JavaScript">JavaScript</option>
                  <option value="Python">Python</option>
                  <option value="Go">Go</option>
                  <option value="Rust">Rust</option>
                  <option value="Java">Java</option>
                </select>
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={`rounded-xl border px-4 py-2 text-xs font-semibold ${
                    isDark ? "border-white/10 hover:bg-white/5" : "border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingRepo}
                  className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-50"
                >
                  {addingRepo ? "Adding..." : "Add Repository"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectsPage;
