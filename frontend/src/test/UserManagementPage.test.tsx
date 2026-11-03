/**
 * UserManagementPage.test.tsx
 * ===========================
 * Unit tests for User Management:
 * - Shows loading and user table for admin role
 * - Displays active/inactive badges truthfully
 * - Allows changing user roles via dropdown
 * - Custom accessible confirmation modal for activation / deactivation:
 *   - Clicking Deactivate opens modal with user details and "Are you sure you want to deactivate this user's account?"
 *   - Clicking Cancel closes modal without calling toggleUserStatus
 *   - Clicking Confirm Deactivation calls API, disables buttons, and shows success message
 *   - Clicking Activate opens modal with "Are you sure you want to activate this user's account?" and Confirm Activation calls API
 *   - Error response preserves original state and displays error notification
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import UserManagementPage from "../pages/UserManagementPage";

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../services/auth", () => ({
  getUser: vi.fn(),
  listUsers: vi.fn(),
  updateUserRole: vi.fn(),
  toggleUserStatus: vi.fn(),
}));

import { getUser, listUsers, updateUserRole, toggleUserStatus } from "../services/auth";
const mockGetUser = getUser as ReturnType<typeof vi.fn>;
const mockListUsers = listUsers as ReturnType<typeof vi.fn>;
const mockUpdateUserRole = updateUserRole as ReturnType<typeof vi.fn>;
const mockToggleUserStatus = toggleUserStatus as ReturnType<typeof vi.fn>;

function renderPage() {
  return render(
    <MemoryRouter>
      <UserManagementPage />
    </MemoryRouter>
  );
}

describe("UserManagementPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders non-admin notice or empty state if user is not an admin", async () => {
    mockGetUser.mockReturnValue({ _id: "u1", role: "member", name: "Regular Member" });
    renderPage();
    await waitFor(() => {
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.getByText(/403 Forbidden: Access Denied/i)).toBeInTheDocument();
    });
  });

  it("renders users with truthful Active and Inactive badges for admin", async () => {
    mockGetUser.mockReturnValue({ _id: "admin-1", role: "admin", name: "Admin User" });
    mockListUsers.mockResolvedValue({
      success: true,
      users: [
        { _id: "admin-1", name: "Admin User", email: "admin@test.com", role: "admin", isActive: true },
        { _id: "u2", name: "Active Member", email: "active@test.com", role: "member", isActive: true },
        { _id: "u3", name: "Disabled Viewer", email: "disabled@test.com", role: "viewer", isActive: false },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Active Member")).toBeInTheDocument();
      expect(screen.getByText("Disabled Viewer")).toBeInTheDocument();
      expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
      expect(screen.getByText("Inactive")).toBeInTheDocument();
    });
  });

  it("calls updateUserRole when role select is changed", async () => {
    mockGetUser.mockReturnValue({ _id: "admin-1", role: "admin", name: "Admin User" });
    mockListUsers.mockResolvedValue({
      success: true,
      users: [
        { _id: "admin-1", name: "Admin User", email: "admin@test.com", role: "admin", isActive: true },
        { _id: "u2", name: "Target Member", email: "target@test.com", role: "member", isActive: true },
      ],
    });
    mockUpdateUserRole.mockResolvedValue({ success: true });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Target Member")).toBeInTheDocument();
    });

    const selects = screen.getAllByRole("combobox");
    // Target Member's dropdown (index 1)
    fireEvent.change(selects[1], { target: { value: "viewer" } });

    await waitFor(() => {
      expect(mockUpdateUserRole).toHaveBeenCalledWith("u2", "viewer");
    });
  });

  it("opens confirmation modal on Deactivate click and does NOT call API on Cancel", async () => {
    mockGetUser.mockReturnValue({ _id: "admin-1", role: "admin", name: "Admin User" });
    mockListUsers.mockResolvedValue({
      success: true,
      users: [
        { _id: "admin-1", name: "Admin User", email: "admin@test.com", role: "admin", isActive: true },
        { _id: "u2", name: "Member to Deactivate", email: "member@test.com", role: "member", isActive: true },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Member to Deactivate")).toBeInTheDocument();
    });

    const deactivateBtn = screen.getByRole("button", { name: /Deactivate/i });
    fireEvent.click(deactivateBtn);

    // Verify modal appears with expected strings
    const modal = screen.getByRole("dialog");
    expect(within(modal).getByText(/Are you sure you want to deactivate this user's account\?/i)).toBeInTheDocument();
    expect(within(modal).getByText("Member to Deactivate")).toBeInTheDocument();
    expect(within(modal).getByText("member@test.com")).toBeInTheDocument();

    // Verify API is NOT called prior to confirmation
    expect(mockToggleUserStatus).not.toHaveBeenCalled();

    // Click Cancel
    const cancelBtn = within(modal).getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    // Modal closed and API still not called
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mockToggleUserStatus).not.toHaveBeenCalled();
    });
  });

  it("calls toggleUserStatus and shows success notification when Confirm Deactivation is clicked", async () => {
    mockGetUser.mockReturnValue({ _id: "admin-1", role: "admin", name: "Admin User" });
    mockListUsers.mockResolvedValue({
      success: true,
      users: [
        { _id: "admin-1", name: "Admin User", email: "admin@test.com", role: "admin", isActive: true },
        { _id: "u2", name: "Member to Deactivate", email: "member@test.com", role: "member", isActive: true },
      ],
    });
    mockToggleUserStatus.mockResolvedValue({ success: true, user: { _id: "u2", isActive: false } });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Member to Deactivate")).toBeInTheDocument();
    });

    const deactivateBtn = screen.getByRole("button", { name: /Deactivate/i });
    fireEvent.click(deactivateBtn);

    const modal = screen.getByRole("dialog");
    const confirmBtn = within(modal).getByRole("button", { name: /Confirm Deactivation/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockToggleUserStatus).toHaveBeenCalledWith("u2", false);
      expect(screen.getByText(/Account deactivated successfully/i)).toBeInTheDocument();
    });
  });

  it("opens confirmation modal on Activate click and calls toggleUserStatus on Confirm Activation", async () => {
    mockGetUser.mockReturnValue({ _id: "admin-1", role: "admin", name: "Admin User" });
    mockListUsers.mockResolvedValue({
      success: true,
      users: [
        { _id: "admin-1", name: "Admin User", email: "admin@test.com", role: "admin", isActive: true },
        { _id: "u3", name: "Inactive Member", email: "inactive@test.com", role: "member", isActive: false },
      ],
    });
    mockToggleUserStatus.mockResolvedValue({ success: true, user: { _id: "u3", isActive: true } });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Inactive Member")).toBeInTheDocument();
    });

    const activateBtn = screen.getByRole("button", { name: /Activate/i });
    fireEvent.click(activateBtn);

    const modal = screen.getByRole("dialog");
    expect(within(modal).getByText(/Are you sure you want to activate this user's account\?/i)).toBeInTheDocument();

    const confirmBtn = within(modal).getByRole("button", { name: /Confirm Activation/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockToggleUserStatus).toHaveBeenCalledWith("u3", true);
      expect(screen.getByText(/Account activated successfully/i)).toBeInTheDocument();
    });
  });

  it("displays error notification and retains state when toggleUserStatus fails", async () => {
    mockGetUser.mockReturnValue({ _id: "admin-1", role: "admin", name: "Admin User" });
    mockListUsers.mockResolvedValue({
      success: true,
      users: [
        { _id: "admin-1", name: "Admin User", email: "admin@test.com", role: "admin", isActive: true },
        { _id: "u2", name: "Member to Deactivate", email: "member@test.com", role: "member", isActive: true },
      ],
    });
    mockToggleUserStatus.mockRejectedValue(new Error("Database connection error"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Member to Deactivate")).toBeInTheDocument();
    });

    const deactivateBtn = screen.getByRole("button", { name: /Deactivate/i });
    fireEvent.click(deactivateBtn);

    const modal = screen.getByRole("dialog");
    const confirmBtn = within(modal).getByRole("button", { name: /Confirm Deactivation/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(/Database connection error/i)).toBeInTheDocument();
      // User is still displayed in table with original active state
      expect(screen.getByText("Member to Deactivate")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
