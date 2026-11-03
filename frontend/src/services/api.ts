// AIRA API Service - Typed client for the FastAPI AI Backend
import { getToken, silentRefresh, logout, authRequest } from "./auth";

// NOTE: Use 127.0.0.1 instead of localhost.
// On Windows 11, `localhost` resolves to ::1 (IPv6) first.
// The FastAPI AI service binds to 127.0.0.1 (IPv4 only), so requests
// to localhost:8000 are refused before they even reach the server.
const BASE_URL = "http://127.0.0.1:8000/api/v1";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Citation {
  filename: string;
  chunk_index: number;
  excerpt: string;
  score: number;
  page_number?: number;
  raw_score?: number;
  score_label?: string;
  score_type?: string;
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
  page_number?: number;
  raw_score?: number;
  score_label?: string;
  score_type?: string;
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

export interface AgentToolCall {
  tool: string;
  arguments: Record<string, unknown>;
  result_summary: string;
}

export interface AgentExecuteResponse {
  agent_id: string;
  agent_name: string;
  query: string;
  steps: string[];
  answer: string;
  tool_calls?: AgentToolCall[];
  citations?: Citation[];
  confidence?: number;
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

// ── Auth header helper ─────────────────────────────────────────────────────────

/** Returns Authorization header object if a token is stored, or empty object. */
function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── API Helper ─────────────────────────────────────────────────────────────────

async function request<T>(path: string, options?: RequestInit & { _isRetry?: boolean }): Promise<T> {
  const isRetry = options?._isRetry || false;
  const { _isRetry, ...restOptions } = options || {};

  let res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
    ...restOptions,
  });

  // Attempt silent refresh on 401 from FastAPI backend
  if (res.status === 401 && !isRetry) {
    const newToken = await silentRefresh();
    if (newToken) {
      res = await fetch(`${BASE_URL}${path}`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newToken}`,
        },
        ...restOptions,
      });
    } else {
      logout(false);
      throw new Error("Session expired. Please log in again.");
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Network error" }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── API Functions ──────────────────────────────────────────────────────────────

/** Health check — intentionally unauthenticated (public endpoint). */
export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE_URL}/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<HealthResponse>;
}

export async function sendChatMessage(query: string, top_k = 5): Promise<ChatResponse> {
  return request<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({ query, top_k }),
  });
}

/**
 * Stream chat response via Server-Sent Events.
 *
 * Authentication: the JWT is passed as a ?token= query parameter because the
 * browser's native EventSource API cannot set custom headers (W3C spec limitation).
 * The server verifies the token cryptographically — it is never logged.
 *
 * Calls onEvent for each parsed event. Returns a cleanup function.
 */
export function streamChatMessage(
  query: string,
  onEvent: (event: StreamEvent) => void,
  top_k = 5,
  conversation_id?: string | null,
): () => void {
  const token = getToken() ?? "";
  const convParam = conversation_id ? `&conversation_id=${encodeURIComponent(conversation_id)}` : "";
  const url = `${BASE_URL}/chat/stream?query=${encodeURIComponent(query)}&top_k=${top_k}&token=${encodeURIComponent(token)}${convParam}`;
  const es = new EventSource(url);

  // Guard flag: set to true once the server sends the final 'done' or 'error'
  // event so that the onerror handler (which fires when the server closes the
  // SSE connection) does not surface a spurious "Connection lost" message.
  let isDone = false;

  es.onmessage = (e) => {
    try {
      const event: StreamEvent = JSON.parse(e.data);
      onEvent(event);
      if (event.type === "done" || event.type === "error") {
        isDone = true;
        es.close();
      }
    } catch {
      // ignore non-JSON lines (e.g. SSE comment lines starting with ':')
    }
  };

  es.onerror = () => {
    // When the server closes the connection after the final event, EventSource
    // fires onerror. Only report an error if we never received a terminal event.
    if (!isDone) {
      onEvent({ type: "error", message: "Connection lost. Is the AI service running on 127.0.0.1:8000?" });
    }
    isDone = true;
    es.close();
  };

  return () => {
    isDone = true;  // prevent onerror from firing if caller aborts the stream
    es.close();
  };
}

export async function ingestDocument(file: File): Promise<IngestResponse> {
  const formData = new FormData();
  formData.append("file", file);
  // Note: Do NOT set Content-Type manually for FormData —
  // the browser must set it automatically to include the multipart boundary.
  const makeUpload = (token: string | null) =>
    fetch(`${BASE_URL}/ingest`, {
      method: "POST",
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  let res = await makeUpload(getToken());
  if (res.status === 401) {
    const newToken = await silentRefresh();
    if (newToken) {
      res = await makeUpload(newToken);
    } else {
      logout(false);
      throw new Error("Session expired. Please log in again.");
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<IngestResponse>;
}

export async function listDocuments(): Promise<{ documents: string[]; count: number }> {
  return request<{ documents: string[]; count: number }>("/ingest/list");
}

// Rich document listing from Node backend (includes ingestion_status, chunk_count, etc.)
export interface BackendDocument {
  _id: string;
  filename: string;
  original_filename: string;
  file_type: string;
  file_size_bytes: number;
  ingestion_status: "indexed" | "processing" | "failed" | "pending";
  chunk_count: number;
  vectors_stored: number;
  createdAt: string;
}

export async function listDocumentsFromBackend(): Promise<{
  success: boolean;
  documents: BackendDocument[];
  total: number;
}> {
  return authRequest<{
    success: boolean;
    documents: BackendDocument[];
    total: number;
  }>("/documents", { cache: "no-store" });
}

export async function deleteDocument(filename: string): Promise<{ status: string; message: string }> {
  return request(`/ingest/${encodeURIComponent(filename)}`, { method: "DELETE" });
}

/**
 * Delete a document's metadata record from the Express/MongoDB backend.
 * Called after deleteDocument() removes the vectors from Qdrant.
 * Uses the MongoDB _id so the correct record is removed even if the filename
 * was re-used across multiple uploads.
 */
export async function deleteDocumentById(id: string): Promise<{ success: boolean; message: string }> {
  return authRequest<{ success: boolean; message: string }>(`/documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export interface DocumentChunkPreview {
  text: string;
  chunk_index: number;
  page_number?: number;
  file_type?: string;
}

export interface DocumentPreviewResponse {
  status: "success" | "empty" | "error";
  filename: string;
  chunks: DocumentChunkPreview[];
  total_chunks: number;
  preview_text: string;
  message?: string;
}

export async function getDocumentPreview(filename: string, maxChunks = 5): Promise<DocumentPreviewResponse> {
  return request<DocumentPreviewResponse>(
    `/ingest/preview?filename=${encodeURIComponent(filename)}&max_chunks=${maxChunks}`
  );
}

export async function searchKnowledge(query: string, top_k = 8): Promise<SearchResponse> {
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
  owner?: {
    login: string;
    avatar_url?: string;
  } | null;
  is_mock?: boolean;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  html_url: string;
  comments: number;
  is_mock?: boolean;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  html_url: string;
  draft: boolean;
  is_mock?: boolean;
}

export interface GitHubReposResponse {
  repositories: GitHubRepo[];
  count: number;
  is_mock: boolean;
  source?: string;
}

export async function getGithubRepos(): Promise<GitHubReposResponse> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;
  const res = await fetch("http://localhost:5000/api/github/repos", { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `Failed to load repositories (HTTP ${res.status})`);
  }
  return (await res.json()) as GitHubReposResponse;
}

export async function addGithubRepo(repo: {
  name: string;
  full_name?: string;
  description?: string;
  language?: string;
}): Promise<{ success: boolean; repository: GitHubRepo }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;
  const res = await fetch("http://localhost:5000/api/github/repos", {
    method: "POST",
    headers,
    body: JSON.stringify(repo),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Failed to add repository" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return (await res.json()) as { success: boolean; repository: GitHubRepo };
}

export async function getGithubIssues(repo?: string): Promise<{ issues: GitHubIssue[]; count: number; repository: string | null; is_mock?: boolean }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;
  const query = repo ? `?repo=${encodeURIComponent(repo)}` : "";
  const res = await fetch(`http://localhost:5000/api/github/issues${query}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `Failed to load issues (HTTP ${res.status})`);
  }
  return (await res.json()) as { issues: GitHubIssue[]; count: number; repository: string | null; is_mock?: boolean };
}

export async function getGithubPulls(repo?: string): Promise<{ pulls: GitHubPullRequest[]; count: number; repository: string | null; is_mock?: boolean }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;
  const query = repo ? `?repo=${encodeURIComponent(repo)}` : "";
  const res = await fetch(`http://localhost:5000/api/github/pulls${query}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `Failed to load pull requests (HTTP ${res.status})`);
  }
  return (await res.json()) as { pulls: GitHubPullRequest[]; count: number; repository: string | null; is_mock?: boolean };
}

// ── Dashboard Statistics ─────────────────────────────────────────────────────

export interface RecentActivityItem {
  id: string;
  type: "document" | "task" | "conversation";
  icon: string;
  title: string;
  detail: string;
  timestamp: string;
}

export interface DashboardStats {
  totalUsers?: number;
  usersByRole?: {
    admin: number;
    member: number;
    viewer: number;
  };
  totalDocuments: number;
  totalConversations: number;
  totalTasks?: number;
  githubConnected: boolean;
  githubUsername: string | null;
  avatarUrl: string | null;
  status: string;
  isReadOnly?: boolean;
  recentActivity?: RecentActivityItem[];
}

export async function getDashboardStats(): Promise<{ success: boolean; role: string; stats: DashboardStats }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;
  const res = await fetch("http://localhost:5000/api/dashboard/stats", { headers });
  if (!res.ok) throw new Error(`Failed to load dashboard statistics (HTTP ${res.status})`);
  return (await res.json()) as { success: boolean; role: string; stats: DashboardStats };
}

// ── GitHub Workspace Integration ─────────────────────────────────────────────

export interface GitHubConnectionStatus {
  connected: boolean;
  githubUsername: string | null;
  avatarUrl: string | null;
  repositoryCount: number;
  status: "connected" | "disconnected" | "error";
  connected_at?: string;
  is_mock: boolean;
  workspace_id?: string | null;
}

export async function getGithubStatus(workspaceId?: string): Promise<GitHubConnectionStatus> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  const res = await fetch(`http://localhost:5000/api/github/status${query}`, { headers });
  if (!res.ok) throw new Error(`Failed to load GitHub status (HTTP ${res.status})`);
  return (await res.json()) as GitHubConnectionStatus;
}

export async function connectGithubPat(token: string, workspaceId?: string): Promise<{ success: boolean; message: string; connection: GitHubConnectionStatus }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;
  const res = await fetch("http://localhost:5000/api/github/connect-pat", {
    method: "POST",
    headers,
    body: JSON.stringify({ token, workspace_id: workspaceId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Failed to connect token" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return (await res.json()) as { success: boolean; message: string; connection: GitHubConnectionStatus };
}

export async function disconnectGithub(workspaceId?: string): Promise<{ success: boolean; message: string }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;
  const res = await fetch("http://localhost:5000/api/github/disconnect", {
    method: "POST",
    headers,
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Failed to disconnect GitHub" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return (await res.json()) as { success: boolean; message: string };
}

export async function getGithubOAuthAuthorizeUrl(workspaceId?: string): Promise<string> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  const res = await fetch(`http://localhost:5000/api/github/oauth/authorize${query}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Failed to initiate GitHub OAuth" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.authorization_url) {
    throw new Error("Authorization URL not received from server");
  }
  return data.authorization_url;
}

// ========================
// Task Management API (Phase B)
// ========================

export interface TaskItem {
  _id: string;
  workspace_id: string;
  created_by: { _id: string; name: string; email: string } | string;
  assigned_to?: { _id: string; name: string; email: string } | string | null;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high";
  due_date?: string | null;
  source?: "manual" | "agent";
  conversation_id?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getTasks(filters?: {
  status?: string;
  priority?: string;
  mine?: boolean;
  q?: string;
}): Promise<{ success: boolean; tasks: TaskItem[]; count: number }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;

  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.priority) params.set("priority", filters.priority);
  if (filters?.mine) params.set("mine", "true");
  if (filters?.q) params.set("q", filters.q);

  const query = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`http://localhost:5000/api/tasks${query}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || "Failed to load tasks");
  }
  return res.json();
}

export async function getTask(id: string): Promise<{ success: boolean; task: TaskItem }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;

  const res = await fetch(`http://localhost:5000/api/tasks/${id}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || "Failed to load task");
  }
  return res.json();
}

export async function createTask(data: {
  title: string;
  description?: string;
  priority?: string;
  due_date?: string | null;
  assigned_to?: string | null;
}): Promise<{ success: boolean; task: TaskItem }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;

  const res = await fetch("http://localhost:5000/api/tasks", {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || "Failed to create task");
  }
  return res.json();
}

export async function updateTask(
  id: string,
  data: Partial<{
    title: string;
    description: string;
    status: string;
    priority: string;
    due_date: string | null;
    assigned_to: string | null;
  }>
): Promise<{ success: boolean; task: TaskItem }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;

  const res = await fetch(`http://localhost:5000/api/tasks/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || "Failed to update task");
  }
  return res.json();
}

export async function deleteTask(id: string): Promise<{ success: boolean; message: string }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;

  const res = await fetch(`http://localhost:5000/api/tasks/${id}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || "Failed to delete task");
  }
  return res.json();
}

// ── Workspace Members (assignee dropdown) ─────────────────────────────────────

export interface WorkspaceMember {
  _id: string;
  name: string;
  role: "admin" | "member" | "viewer";
  email?: string; // only present for admin callers
}

export async function getWorkspaceMembers(): Promise<{ success: boolean; members: WorkspaceMember[]; count: number }> {
  const nodeToken = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (nodeToken) headers.Authorization = `Bearer ${nodeToken}`;

  const res = await fetch("http://localhost:5000/api/workspace/members", { headers, cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || "Failed to load workspace members");
  }
  return res.json();
}



