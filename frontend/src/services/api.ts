// AIRA API Service - Typed client for the FastAPI AI Backend
const BASE_URL = "http://localhost:8000/api/v1";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Citation {
  filename: string;
  chunk_index: number;
  excerpt: string;
  score: number;
}

export interface ChatResponse {
  answer: string;
  confidence: number;
  confidence_label: "High" | "Medium" | "Low";
  reasoning_steps: string[];
  citations: Citation[];
  chunks_found: number;
  query: string;
}

export interface IngestResponse {
  status: string;
  filename: string;
  file_size_kb: number;
  chunks_created: number;
  vectors_stored: number;
  message: string;
}

export interface SearchResult {
  text: string;
  filename: string;
  chunk_index: number;
  score: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  count: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

export interface AgentExecuteResponse {
  agent_id: string;
  agent_name: string;
  query: string;
  steps: string[];
  answer: string;
  task_created: Record<string, unknown> | null;
  knowledge_results: SearchResult[];
  status: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  llm_provider: string;
  indexed_vectors: number;
}

// Streaming event types
export type StreamEvent =
  | { type: "reasoning_step"; text: string }
  | { type: "token"; text: string }
  | { type: "done"; confidence: number; confidence_label: string; citations: Citation[]; chunks_found: number }
  | { type: "error"; message: string };

// ── API Helper ─────────────────────────────────────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Network error" }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── API Functions ──────────────────────────────────────────────────────────────

export async function checkHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export async function sendChatMessage(query: string, top_k = 5): Promise<ChatResponse> {
  return request<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({ query, top_k }),
  });
}

/**
 * Stream chat response via Server-Sent Events.
 * Calls onEvent for each parsed event. Returns a cleanup function.
 */
export function streamChatMessage(
  query: string,
  onEvent: (event: StreamEvent) => void,
  top_k = 5
): () => void {
  const url = `${BASE_URL}/chat/stream?query=${encodeURIComponent(query)}&top_k=${top_k}`;
  const es = new EventSource(url);

  es.onmessage = (e) => {
    try {
      const event: StreamEvent = JSON.parse(e.data);
      onEvent(event);
      if (event.type === "done" || event.type === "error") {
        es.close();
      }
    } catch {
      // ignore parse errors
    }
  };

  es.onerror = () => {
    onEvent({ type: "error", message: "Connection lost. Is the backend running?" });
    es.close();
  };

  return () => es.close();
}

export async function ingestDocument(file: File): Promise<IngestResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE_URL}/ingest`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<IngestResponse>;
}

export async function listDocuments(): Promise<{ documents: string[]; count: number }> {
  return request<{ documents: string[]; count: number }>("/ingest/list");
}

export async function deleteDocument(filename: string): Promise<{ status: string; message: string }> {
  return request(`/ingest/${encodeURIComponent(filename)}`, { method: "DELETE" });
}

export async function searchKnowledge(query: string, top_k = 5): Promise<SearchResponse> {
  return request<SearchResponse>(`/search?q=${encodeURIComponent(query)}&top_k=${top_k}`);
}

export async function getAgents(): Promise<{ agents: AgentInfo[]; count: number }> {
  return request<{ agents: AgentInfo[]; count: number }>("/agents");
}

export async function executeAgent(agent_id: string, query: string): Promise<AgentExecuteResponse> {
  return request<AgentExecuteResponse>("/agents/execute", {
    method: "POST",
    body: JSON.stringify({ agent_id, query }),
  });
}

// ── GitHub Integration Types & Functions ─────────────────────────────────────

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string;
  open_issues_count: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  html_url: string;
  comments: number;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  html_url: string;
  draft: boolean;
}

export async function getGithubRepos(): Promise<{ repositories: GitHubRepo[]; count: number }> {
  return request<{ repositories: GitHubRepo[]; count: number }>("/github/repos");
}

export async function getGithubIssues(repo?: string): Promise<{ issues: GitHubIssue[]; count: number; repository: string | null }> {
  const url = repo ? `/github/issues?repo=${encodeURIComponent(repo)}` : "/github/issues";
  return request<{ issues: GitHubIssue[]; count: number; repository: string | null }>(url);
}

export async function getGithubPulls(repo?: string): Promise<{ pulls: GitHubPullRequest[]; count: number; repository: string | null }> {
  const url = repo ? `/github/pulls?repo=${encodeURIComponent(repo)}` : "/github/pulls";
  return request<{ pulls: GitHubPullRequest[]; count: number; repository: string | null }>(url);
}
