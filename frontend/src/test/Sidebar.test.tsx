/**
 * Sidebar.test.tsx
 * ==================
 * Tests role-based nav item visibility:
 * - All roles see base nav items (Dashboard, AI Chat, Documents, GitHub, Tasks, etc.)
 * - Only admins see the "User Management" link
 * - Viewers and members do NOT see "User Management"
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "../components/Sidebar";

// Mock ThemeContext
vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

// Mock auth service
vi.mock("../services/auth", () => ({
  getUser: vi.fn(),
  logout: vi.fn(),
}));

import { getUser } from "../services/auth";
const mockGetUser = getUser as ReturnType<typeof vi.fn>;

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>
  );
}

describe("Sidebar — role-based nav items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows base nav items (Dashboard, AI Chat, Documents) for all roles", () => {
    mockGetUser.mockReturnValue({ name: "Alice", role: "member", avatar: "", isActive: true });
    renderSidebar();
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI Chat").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Documents").length).toBeGreaterThan(0);
  });

  it("shows User Management link for admin users", () => {
    mockGetUser.mockReturnValue({ name: "Admin", role: "admin", avatar: "", isActive: true });
    renderSidebar();
    expect(screen.getAllByText("User Management").length).toBeGreaterThan(0);
  });

  it("does NOT show User Management link for member users", () => {
    mockGetUser.mockReturnValue({ name: "Bob", role: "member", avatar: "", isActive: true });
    renderSidebar();
    expect(screen.queryByText("User Management")).toBeNull();
  });

  it("does NOT show User Management link for viewer users", () => {
    mockGetUser.mockReturnValue({ name: "Carol", role: "viewer", avatar: "", isActive: true });
    renderSidebar();
    expect(screen.queryByText("User Management")).toBeNull();
  });

  it("shows GitHub link for all roles including viewer", () => {
    mockGetUser.mockReturnValue({ name: "Dave", role: "viewer", avatar: "", isActive: true });
    renderSidebar();
    expect(screen.getAllByText("GitHub").length).toBeGreaterThan(0);
  });
});
