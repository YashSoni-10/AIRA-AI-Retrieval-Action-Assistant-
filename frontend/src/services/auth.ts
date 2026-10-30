// AIRA Auth Service - Typed client for Node.js Auth Backend
const AUTH_BASE = "http://localhost:5000/api";

export interface AuthUser {
  _id: string;
  id?: string;
  name: string;
  email: string;
  role: "admin" | "member" | "viewer";
  avatar: string;
  isActive: boolean;
  isEmailVerified?: boolean;
  createdAt: string;
  workspace?: { _id?: string; name: string };
}

export interface AuthResponse {
  success: boolean;
  token: string;
  user: AuthUser;
}

// ── Token helpers ─────────────────────────────────────────────────────────────

export const getToken = () => localStorage.getItem("aira_token");
export const getUser = (): AuthUser | null => {
  try { return JSON.parse(localStorage.getItem("aira_user") ?? "null"); }
  catch { return null; }
};

export const setUser = (user: AuthUser | null): void => {
  if (user) {
    localStorage.setItem("aira_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("aira_user");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("aira_user_updated", { detail: user }));
  }
};

let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempt a silent token refresh using the httpOnly cookie.
 * Coordinates concurrent calls so multiple 401 responses share a single refresh request.
 * Returns the fresh access token string or null if refresh failed.
 */
export async function silentRefresh(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${AUTH_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include", // send the httpOnly cookie
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return null;
      const data: AuthResponse = await res.json();
      if (data.success && data.token) {
        localStorage.setItem("aira_token", data.token);
        if (data.user) {
          setUser(data.user);
        }
        return data.token;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

interface AuthRequestOptions extends RequestInit {
  _isRetry?: boolean;
}

const PUBLIC_AUTH_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
  "/auth/resend-verification",
];

/** Shared authenticated fetch with automatic silent-refresh on 401. */
export async function authRequest<T>(path: string, options?: AuthRequestOptions): Promise<T> {
  const isRetry = options?._isRetry || false;
  const isPublicAuthPath = PUBLIC_AUTH_PATHS.some(p => path.startsWith(p));

  const makeRequest = (token: string | null) => {
    const { _isRetry, ...restOptions } = options || {};
    return fetch(`${AUTH_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include", // always send cookies (needed for refresh and session)
      ...restOptions,
    });
  };

  let res = await makeRequest(getToken());

  // Silent refresh on 401 for protected endpoints — attempt at most once
  if (res.status === 401 && !isRetry && !isPublicAuthPath) {
    const newToken = await silentRefresh();
    if (newToken) {
      // Retry the original request exactly once with the fresh token
      res = await makeRequest(newToken);
      if (res.status === 401) {
        logout(false);
        throw new Error("Session expired. Please log in again.");
      }
    } else {
      // Refresh failed — clear auth state gracefully and reject
      logout(false); // false = skip server call to avoid loop
      throw new Error("Session expired. Please log in again.");
    }
  }

  const data = await res.json().catch(() => ({ success: false, message: "Network error" }));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data as T;
}


export async function register(name: string, email: string, password: string): Promise<AuthResponse> {
  const data = await authRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
  localStorage.setItem("aira_token", data.token);
  setUser(data.user);
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await authRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem("aira_token", data.token);
  setUser(data.user);
  return data;
}

export async function getMe(): Promise<{ success: boolean; user: AuthUser }> {
  const data = await authRequest<{ success: boolean; user: AuthUser }>("/auth/me");
  if (data.success && data.user) {
    setUser(data.user);
  }
  return data;
}

export async function updateProfile(name: string): Promise<{ success: boolean; user: AuthUser }> {
  const data = await authRequest<{ success: boolean; user: AuthUser }>("/auth/update-profile", {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  if (data.success && data.user) {
    setUser(data.user);
  }
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthResponse> {
  const data = await authRequest<AuthResponse>("/auth/change-password", {
    method: "PATCH",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  localStorage.setItem("aira_token", data.token);
  setUser(data.user);
  return data;
}

/** Clears local storage and (optionally) asks the server to clear the httpOnly cookie. */
export function logout(callServer = true): void {
  localStorage.removeItem("aira_token");
  setUser(null);
  if (callServer) {
    // Fire-and-forget — don't block or throw
    fetch(`${AUTH_BASE}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  }
}


export async function uploadAvatar(file: File): Promise<{ success: boolean; avatar: string; user?: AuthUser }> {
  const token = getToken();
  const formData = new FormData();
  formData.append("avatar", file);

  const res = await fetch(`${AUTH_BASE}/auth/avatar`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: "include",
    body: formData,
  });

  const data = await res.json().catch(() => ({ success: false, message: "Network error" }));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

  if (data.user) {
    setUser(data.user);
  } else if (data.avatar) {
    const cur = getUser();
    if (cur) {
      setUser({ ...cur, avatar: data.avatar });
    }
  }
  return data;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Workspace {
  _id: string;
  name: string;
  owner_id: string;
  is_default: boolean;
  description: string;
  settings: { max_file_size_mb: number; allowed_file_types: string[] };
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  _id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  message_count: number;
  last_message_at: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  _id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources: Array<{
    filename: string;
    chunk_index: number;
    excerpt: string;
    score: number;
    page_number?: number;
    score_label?: string;
    raw_score?: number;
    score_type?: string;
  }>;
  meta: { confidence: number | null; confidence_label: string | null; chunks_found: number | null };
  createdAt: string;
}

// ── Workspace API ─────────────────────────────────────────────────────────────

export async function getDefaultWorkspace(): Promise<{ success: boolean; workspace: Workspace }> {
  return authRequest<{ success: boolean; workspace: Workspace }>("/workspace/me");
}

// ── Conversation API ──────────────────────────────────────────────────────────

export async function createConversation(title?: string): Promise<{ success: boolean; conversation: Conversation }> {
  return authRequest<{ success: boolean; conversation: Conversation }>("/conversations", {
    method: "POST",
    body: JSON.stringify({ title: title || "New Conversation" }),
  });
}

export async function listConversations(page = 1, limit = 20): Promise<{
  success: boolean;
  conversations: Conversation[];
  total: number;
}> {
  return authRequest<{ success: boolean; conversations: Conversation[]; total: number }>(
    `/conversations?page=${page}&limit=${limit}`
  );
}

export async function getConversation(id: string): Promise<{ success: boolean; conversation: Conversation }> {
  return authRequest<{ success: boolean; conversation: Conversation }>(`/conversations/${id}`);
}

export async function deleteConversation(id: string): Promise<{ success: boolean; message: string }> {
  return authRequest<{ success: boolean; message: string }>(`/conversations/${id}`, { method: "DELETE" });
}

export async function clearAllConversations(workspaceId?: string): Promise<{
  success: boolean;
  message: string;
  deletedCount?: number;
  messagesDeletedCount?: number;
}> {
  const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  return authRequest<{
    success: boolean;
    message: string;
    deletedCount?: number;
    messagesDeletedCount?: number;
  }>(`/conversations${query}`, { method: "DELETE" });
}

export async function saveMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  sources?: ChatMessage["sources"],
  meta?: ChatMessage["meta"]
): Promise<{ success: boolean; message: ChatMessage }> {
  return authRequest<{ success: boolean; message: ChatMessage }>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ role, content, sources, meta }),
  });
}

export async function getMessages(conversationId: string, page = 1, limit = 50): Promise<{
  success: boolean;
  messages: ChatMessage[];
  total: number;
}> {
  return authRequest<{ success: boolean; messages: ChatMessage[]; total: number }>(
    `/conversations/${conversationId}/messages?page=${page}&limit=${limit}`
  );
}

// User & Role Management (Admin only)
export async function listUsers(): Promise<{ success: boolean; users: AuthUser[]; count: number }> {
  return authRequest<{ success: boolean; users: AuthUser[]; count: number }>("/auth/users");
}

export async function updateUserRole(
  userId: string,
  role: "admin" | "member" | "viewer"
): Promise<{ success: boolean; user: AuthUser }> {
  return authRequest<{ success: boolean; user: AuthUser }>(`/auth/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function toggleUserStatus(
  userId: string,
  isActive: boolean
): Promise<{ success: boolean; user: AuthUser }> {
  return authRequest<{ success: boolean; user: AuthUser }>(`/auth/users/${userId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ isActive }),
  });
}

// ── Workspace settings (Admin only) ───────────────────────────────────────────

export interface WorkspaceSettingsPayload {
  name?: string;
  description?: string;
  settings?: {
    max_file_size_mb?: number;
    allowed_file_types?: string[];
  };
}

export async function updateWorkspaceSettings(
  workspaceId: string,
  payload: WorkspaceSettingsPayload
): Promise<{ success: boolean; workspace: Workspace }> {
  return authRequest<{ success: boolean; workspace: Workspace }>(
    `/workspace/${workspaceId}/settings`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
}

// ── Password Reset (6B) ────────────────────────────────────────────────────────

/** Triggers a password-reset email (or console log in dev when SMTP is unconfigured). */
export async function forgotPassword(email: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${AUTH_BASE}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({ success: false, message: "Network error" }));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

/**
 * Submits a new password together with the raw reset token from the URL query string.
 * On success the server responds with a fresh access token, which is stored in localStorage.
 */
export async function resetPassword(token: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_BASE}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",     // capture the new httpOnly refresh cookie
    body: JSON.stringify({ token, password }),
  });
  const data: AuthResponse = await res.json().catch(() => ({ success: false, token: "", user: null } as unknown as AuthResponse));
  if (!res.ok) throw new Error((data as any).message || `HTTP ${res.status}`);
  localStorage.setItem("aira_token", data.token);
  setUser(data.user);
  return data;
}

// ── Email Verification (6C) ─────────────────────────────────────────────────────

/**
 * Validates the email verification token from URL query string.
 * Updates isEmailVerified to true in backend and updates local storage if user is logged in.
 */
export async function verifyEmail(token: string): Promise<{ success: boolean; message: string; user?: AuthUser }> {
  const res = await fetch(`${AUTH_BASE}/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({ success: false, message: "Network error" }));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  if (data.success && data.user) {
    const currentUser = getUser();
    if (currentUser && (currentUser._id === data.user._id || currentUser.id === data.user._id || currentUser.email === data.user.email)) {
      setUser({ ...currentUser, ...data.user, isEmailVerified: true });
    }
  }
  return data;
}

/**
 * Resends the verification email to the specified email (or authenticated user).
 * Protected by backend rate limiting.
 */
export async function resendVerification(email?: string): Promise<{ success: boolean; message: string }> {
  const user = getUser();
  const targetEmail = email || user?.email;
  if (!targetEmail) throw new Error("Email is required to resend verification");

  const res = await fetch(`${AUTH_BASE}/auth/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: targetEmail }),
  });
  const data = await res.json().catch(() => ({ success: false, message: "Network error" }));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

