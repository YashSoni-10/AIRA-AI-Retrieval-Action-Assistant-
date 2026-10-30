/**
 * SettingsPage.test.tsx
 * =====================
 * Unit tests for SettingsPage:
 * - Shows profile details
 * - Displays service health lights for Node backend and AI service
 * - Shows workspace settings section for admin users
 * - Hides workspace settings section for non-admin users
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SettingsPage from "../pages/SettingsPage";

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../services/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/auth")>();
  return {
    ...actual,
    getMe: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    logout: vi.fn(),
    getDefaultWorkspace: vi.fn(),
    updateWorkspaceSettings: vi.fn(),
  };
});

import { getMe, getDefaultWorkspace } from "../services/auth";
const mockGetMe = getMe as ReturnType<typeof vi.fn>;
const mockGetDefaultWorkspace = getDefaultWorkspace as ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "ok" }),
      })
    );
  });

  it("renders user profile info and displays Online status when services are up", async () => {
    mockGetMe.mockResolvedValue({
      success: true,
      user: {
        _id: "u1",
        name: "Test User",
        email: "test@example.com",
        role: "member",
        avatar: "",
      },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Test User")).toBeInTheDocument();
      expect(screen.getByText("test@example.com")).toBeInTheDocument();
      expect(screen.getAllByText("Online").length).toBeGreaterThan(0);
    });
  });

  it("shows Workspace Settings section for admin role", async () => {
    mockGetMe.mockResolvedValue({
      success: true,
      user: {
        _id: "admin-1",
        name: "Admin User",
        email: "admin@example.com",
        role: "admin",
      },
    });
    mockGetDefaultWorkspace.mockResolvedValue({
      success: true,
      workspace: {
        _id: "ws-1",
        name: "Acme Corp Workspace",
        description: "Official workspace",
        settings: {
          max_file_size_mb: 25,
          allowed_file_types: [".pdf", ".txt"],
        },
      },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Workspace Settings")).toBeInTheDocument();
      expect(screen.getByText("Admin only")).toBeInTheDocument();
    });
  });

  it("does not show Workspace Settings section for member role", async () => {
    mockGetMe.mockResolvedValue({
      success: true,
      user: {
        _id: "member-1",
        name: "Member User",
        email: "member@example.com",
        role: "member",
      },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Member User")).toBeInTheDocument();
      expect(screen.queryByText("Workspace Settings")).toBeNull();
    });
  });

  it("displays avatar updated message without any literal \\n text", async () => {
    mockGetMe.mockResolvedValue({
      success: true,
      user: {
        _id: "u1",
        name: "Test User",
        email: "test@example.com",
        role: "member",
        avatar: "",
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/auth/avatar")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ avatar: "http://example.com/avatar.png", user: { avatar: "http://example.com/avatar.png" } }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: "ok" }),
        });
      })
    );

    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getByText("Test User")).toBeInTheDocument();
    });

    // Check that container does not contain literal "\\n" as text
    expect(container.textContent).not.toContain("\\n");

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File(["dummy content"], "avatar.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Avatar updated ✓")).toBeInTheDocument();
    });

    // Verify again that container does not contain literal "\\n" string
    expect(container.textContent).not.toContain("\\n");
  });
});
