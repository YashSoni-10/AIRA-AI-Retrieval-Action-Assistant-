// AIRA Auth Service - Typed client for Node.js Auth Backend
const AUTH_BASE = "http://localhost:5000/api";

export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  role: "admin" | "member" | "viewer";
  avatar: string;
  isActive: boolean;
  createdAt: string;
}

export interface AuthResponse {
  success: boolean;
  token: string;
  user: AuthUser;
}

async function authRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("aira_token");
  const res = await fetch(`${AUTH_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
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
  localStorage.setItem("aira_user", JSON.stringify(data.user));
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await authRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem("aira_token", data.token);
  localStorage.setItem("aira_user", JSON.stringify(data.user));
  return data;
}

export async function getMe(): Promise<{ success: boolean; user: AuthUser }> {
  const data = await authRequest<{ success: boolean; user: AuthUser }>("/auth/me");
  if (data.success) {
    localStorage.setItem("aira_user", JSON.stringify(data.user));
  }
  return data;
}

export async function updateProfile(name: string, role?: string): Promise<{ success: boolean; user: AuthUser }> {
  const data = await authRequest<{ success: boolean; user: AuthUser }>("/auth/update-profile", {
    method: "PATCH",
    body: JSON.stringify({ name, role }),
  });
  if (data.success) {
    localStorage.setItem("aira_user", JSON.stringify(data.user));
  }
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthResponse> {
  const data = await authRequest<AuthResponse>("/auth/change-password", {
    method: "PATCH",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  localStorage.setItem("aira_token", data.token);
  localStorage.setItem("aira_user", JSON.stringify(data.user));
  return data;
}

export function logout(): void {
  localStorage.removeItem("aira_token");
  localStorage.removeItem("aira_user");
}

export function getToken(): string | null {
  return localStorage.getItem("aira_token");
}

export function getUser(): AuthUser | null {
  const userStr = localStorage.getItem("aira_user");
  if (!userStr) return null;
  try {
    return JSON.parse(userStr) as AuthUser;
  } catch {
    return null;
  }
}
