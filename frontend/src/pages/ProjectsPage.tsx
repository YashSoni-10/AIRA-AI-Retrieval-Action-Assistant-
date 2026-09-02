import { useCallback, useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { getGithubRepos, getGithubIssues, getGithubPulls, type GitHubRepo, type GitHubIssue, type GitHubPullRequest } from "../services/api";

function ProjectsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  
  const [pulls, setPulls] = useState<GitHubPullRequest[]>([]);
  const [loadingPulls, setLoadingPulls] = useState(false);

  const [activeTab, setActiveTab] = useState<"issues" | "pulls">("issues");

  const fetchRepos = useCallback(async () => {
    try {
      const data = await getGithubRepos();
      setRepos(data.repositories);
      if (data.repositories.length > 0) {
        setSelectedRepo(data.repositories[0].full_name);
      }
    } catch {
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

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">
      
      {/* Page Header */}
      <div className={`border-b px-8 py-5 backdrop-blur-xl transition-colors duration-300 ${
        isDark ? "border-white/10 bg-[#090a13]/80 text-white" : "border-slate-200/80 bg-white/80 text-slate-900 shadow-sm"
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
              Projects & Repositories
            </h2>
            <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
              Explore GitHub integration workspace status, issues, and pull requests
            </p>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            isDark ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300" : "border-blue-200 bg-blue-50 text-blue-700"
          }`}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            GitHub Workspace Connected
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className={`relative flex-1 px-8 py-8 transition-colors duration-300 ${isDark ? "bg-[#060812]" : "bg-slate-50"}`}>
        <div className="mx-auto max-w-6xl space-y-8">
          
          {/* Section: Projects Grid */}
          <div>
            <h3 className={`text-sm font-bold uppercase tracking-wider mb-4 ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
              Select Repository ({repos.length})
            </h3>
            {loadingRepos ? (
              <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-500"}`}>Loading projects from GitHub...</p>
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
                          : "border-white/80 bg-white/45 hover:border-slate-300 hover:bg-white/70 hover:shadow-md"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xl">📁</span>
                        <a 
                          href={repo.html_url} 
                          target="_blank" 
                          rel="noreferrer"
                          className={`text-[11px] font-bold underline ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-800"}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open in GitHub ↗
                        </a>
                      </div>
                      
                      <h4 className={`mt-3 text-lg font-bold truncate ${isDark ? "text-white" : "text-slate-900"}`}>
                        {repo.name}
                      </h4>
                      <p className={`mt-1.5 text-xs line-clamp-2 leading-5 ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                        {repo.description || "No description provided."}
                      </p>

                      <div className="mt-4 flex items-center gap-3 text-[11px] font-semibold">
                        <span className={`rounded-full px-2 py-0.5 ${isDark ? "bg-white/10 text-zinc-300" : "bg-slate-100 text-slate-600"}`}>
                          {repo.language || "Unknown"}
                        </span>
                        <span className={isDark ? "text-zinc-500" : "text-slate-400"}>
                          ⭐ {repo.stargazers_count}
                        </span>
                        <span className={isDark ? "text-zinc-500" : "text-slate-400"}>
                          🍴 {repo.forks_count}
                        </span>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t pt-3 text-[11px]">
                        <span className={isDark ? "text-zinc-500" : "text-slate-400"}>
                          {repo.full_name}
                        </span>
                        <span className={`font-bold ${repo.open_issues_count > 0 ? "text-amber-500" : "text-emerald-500"}`}>
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
            <div className={`rounded-2xl border p-6 backdrop-blur-2xl ${
              isDark ? "border-white/10 bg-white/[0.03]" : "border-white/80 bg-white/50 shadow-md"
            }`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
                <div>
                  <h3 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                    Active Status: <span className={isDark ? "text-cyan-400" : "text-blue-600"}>{selectedRepo.split("/")[1]}</span>
                  </h3>
                  <p className={`text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                    Showing live data fetched from GitHub API
                  </p>
                </div>
                
                {/* Tabs */}
                <div className={`flex rounded-xl p-1 border ${isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-200 bg-slate-100"}`}>
                  <button
                    onClick={() => setActiveTab("issues")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeTab === "issues"
                        ? isDark ? "bg-cyan-500/20 text-white border border-cyan-400/20" : "bg-white text-slate-800 shadow-sm"
                        : isDark ? "text-zinc-400" : "text-slate-500"
                    }`}
                  >
                    Issues ({issues.length})
                  </button>
                  <button
                    onClick={() => setActiveTab("pulls")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      activeTab === "pulls"
                        ? isDark ? "bg-cyan-500/20 text-white border border-cyan-400/20" : "bg-white text-slate-800 shadow-sm"
                        : isDark ? "text-zinc-400" : "text-slate-500"
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
                    <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-500"}`}>Loading repository issues...</p>
                  ) : issues.length === 0 ? (
                    <p className={`text-sm text-center py-6 ${isDark ? "text-zinc-500" : "text-slate-400"}`}>No issues found in this repository.</p>
                  ) : (
                    <div className="space-y-3">
                      {issues.map((issue) => (
                        <div 
                          key={issue.number}
                          className={`flex items-center justify-between rounded-xl border p-4 transition ${
                            isDark ? "border-white/5 bg-white/[0.02] hover:border-cyan-400/20" : "border-slate-100 bg-white/70 hover:border-blue-300 hover:shadow-sm"
                          }`}
                        >
                          <div className="min-w-0 flex-1 pr-4">
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase ${
                                issue.state === "open"
                                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                  : "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                              }`}>
                                {issue.state}
                              </span>
                              <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                                #{issue.number} by {issue.user.login}
                              </span>
                            </div>
                            <h5 className={`mt-1.5 text-sm font-semibold truncate ${isDark ? "text-white" : "text-slate-800"}`}>
                              {issue.title}
                            </h5>
                          </div>
                          
                          <a 
                            href={issue.html_url} 
                            target="_blank" 
                            rel="noreferrer"
                            className={`text-xs font-semibold ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-800"}`}
                          >
                            View ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  loadingPulls ? (
                    <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-500"}`}>Loading repository pull requests...</p>
                  ) : pulls.length === 0 ? (
                    <p className={`text-sm text-center py-6 ${isDark ? "text-zinc-500" : "text-slate-400"}`}>No pull requests found.</p>
                  ) : (
                    <div className="space-y-3">
                      {pulls.map((pr) => (
                        <div 
                          key={pr.number}
                          className={`flex items-center justify-between rounded-xl border p-4 transition ${
                            isDark ? "border-white/5 bg-white/[0.02] hover:border-cyan-400/20" : "border-slate-100 bg-white/70 hover:border-blue-300 hover:shadow-sm"
                          }`}
                        >
                          <div className="min-w-0 flex-1 pr-4">
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase ${
                                pr.state === "open"
                                  ? pr.draft
                                    ? "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30"
                                    : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                              }`}>
                                {pr.state} {pr.draft && "(draft)"}
                              </span>
                              <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                                #{pr.number} by {pr.user.login}
                              </span>
                            </div>
                            <h5 className={`mt-1.5 text-sm font-semibold truncate ${isDark ? "text-white" : "text-slate-800"}`}>
                              {pr.title}
                            </h5>
                          </div>
                          
                          <a 
                            href={pr.html_url} 
                            target="_blank" 
                            rel="noreferrer"
                            className={`text-xs font-semibold ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-800"}`}
                          >
                            View ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default ProjectsPage;
