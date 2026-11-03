import { describe, it, expect, vi, beforeEach } from "vitest";
import { authRequest } from "../services/auth";

describe("Frontend Silent Refresh & 401 Coordination (Phase 6A)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("aira_token", "stale_access_token_123");
    localStorage.setItem("aira_user", JSON.stringify({ _id: "user1", name: "Test User" }));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("1. Single 401 on protected endpoint triggers refresh and single retry with new token", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              token: "fresh_access_token_456",
              user: { _id: "user1", name: "Test User" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }

      if (url.includes("/workspace/me")) {
        callCount++;
        const authHeader = (init?.headers as Record<string, string>)?.Authorization;
        if (authHeader === "Bearer stale_access_token_123") {
          return Promise.resolve(
            new Response(JSON.stringify({ success: false, message: "Token expired" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        if (authHeader === "Bearer fresh_access_token_456") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ success: true, workspace: { name: "Default Workspace" } }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
      }

      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await authRequest<{ success: boolean; workspace: { name: string } }>("/workspace/me");

    expect(result.success).toBe(true);
    expect(result.workspace.name).toBe("Default Workspace");
    expect(callCount).toBe(2); // Original 401 + retry
    expect(localStorage.getItem("aira_token")).toBe("fresh_access_token_456");
  });

  it("2. Concurrent 401 responses share a single refresh operation", async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/auth/refresh")) {
        refreshCalls++;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({
                  success: true,
                  token: "coordinated_fresh_token_789",
                  user: { _id: "user1", name: "Test User" },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              )
            );
          }, 20);
        });
      }

      const authHeader = (init?.headers as Record<string, string>)?.Authorization;
      if (authHeader === "Bearer coordinated_fresh_token_789") {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      // Initial call fails with 401
      return Promise.resolve(
        new Response(JSON.stringify({ success: false, message: "Token expired" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    // Fire 3 simultaneous requests
    const [res1, res2, res3] = await Promise.all([
      authRequest<{ success: boolean }>("/conversations"),
      authRequest<{ success: boolean }>("/workspace/me"),
      authRequest<{ success: boolean }>("/tasks"),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res3.success).toBe(true);
    // Crucial check: exactly ONE call to /auth/refresh was made
    expect(refreshCalls).toBe(1);
    expect(localStorage.getItem("aira_token")).toBe("coordinated_fresh_token_789");
  });

  it("3. Failed refresh clears client auth state and rejects gracefully", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: false, message: "Refresh token revoked" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: false, message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(authRequest("/conversations")).rejects.toThrow("Session expired. Please log in again.");
    expect(localStorage.getItem("aira_token")).toBeNull();
    expect(localStorage.getItem("aira_user")).toBeNull();
  });

  it("4. Public auth paths (e.g. login 401 for bad password) do NOT trigger refresh and preserve error message", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/login")) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: false, message: "Invalid email or password" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.reject(new Error("Should not be called"));
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      authRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "user@aira.io", password: "wrong" }),
      })
    ).rejects.toThrow("Invalid email or password");

    // Fetch was called only once (no attempt to call /auth/refresh)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5. When a retried request with new token fails with 401 again, it clears auth and halts without infinite loop", async () => {
    let requestsCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      requestsCount++;
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              token: "new_token_that_will_fail",
              user: { _id: "user1", name: "Test User" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      // Both original and retried request return 401 (e.g. user account deactivated)
      return Promise.resolve(
        new Response(JSON.stringify({ success: false, message: "Account disabled" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(authRequest("/workspace/me")).rejects.toThrow("Session expired. Please log in again.");

    // Exactly 3 requests: initial /workspace/me (401), /auth/refresh (200), retry /workspace/me (401)
    expect(requestsCount).toBe(3);
    expect(localStorage.getItem("aira_token")).toBeNull();
  });
});
