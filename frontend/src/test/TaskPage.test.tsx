/**
 * TaskPage.test.tsx
 * ==================
 * Tests viewer role restriction UI:
 * - Viewers see a "Viewer (Read Only)" badge in the header
 * - The "New Task" / Create Task button is hidden for viewers
 * - Members and admins see the create task button
 *
 * Uses a minimal mock of the fetch API to avoid real network calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TaskPage from "../pages/TaskPage";

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../services/auth", () => ({
  getUser: vi.fn(),
  logout: vi.fn(),
}));

import { getUser } from "../services/auth";
const mockGetUser = getUser as ReturnType<typeof vi.fn>;

// Mock fetch so network calls return empty lists immediately
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, tasks: [], members: [] }),
    })
  );
});

function renderTaskPage() {
  return render(
    <MemoryRouter>
      <TaskPage />
    </MemoryRouter>
  );
}

describe("TaskPage — viewer role restrictions", () => {
  it("shows Viewer (Read Only) badge for viewer role", async () => {
    mockGetUser.mockReturnValue({ name: "Eve", role: "viewer", avatar: "", isActive: true, _id: "u1" });
    renderTaskPage();
    await waitFor(() => {
      expect(screen.getByText(/Viewer.*Read Only/i)).toBeInTheDocument();
    });
  });

  it("hides the New Task / create form for viewers", async () => {
    mockGetUser.mockReturnValue({ name: "Eve", role: "viewer", avatar: "", isActive: true, _id: "u1" });
    renderTaskPage();
    await waitFor(() => {
      expect(screen.queryByText(/New Task/i)).toBeNull();
      expect(screen.queryByText(/Create Task/i)).toBeNull();
    });
  });

  it("shows the New Task button for member role", async () => {
    mockGetUser.mockReturnValue({ name: "Bob", role: "member", avatar: "", isActive: true, _id: "u2" });
    renderTaskPage();
    await waitFor(() => {
      // "New Task" appears either as button text or in the create form
      expect(
        screen.queryByText(/New Task/i) || screen.queryByText(/Create Task/i)
      ).not.toBeNull();
    });
  });

  it("shows the New Task button for admin role", async () => {
    mockGetUser.mockReturnValue({ name: "Admin", role: "admin", avatar: "", isActive: true, _id: "u3" });
    renderTaskPage();
    await waitFor(() => {
      expect(
        screen.queryByText(/New Task/i) || screen.queryByText(/Create Task/i)
      ).not.toBeNull();
    });
  });
});
