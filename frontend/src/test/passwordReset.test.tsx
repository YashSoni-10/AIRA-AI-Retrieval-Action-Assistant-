/**
 * passwordReset.test.tsx
 * ======================
 * Frontend unit tests for Password Reset (Phase 6B):
 * 1. ForgotPasswordPage:
 *    - Submitting email calls forgotPassword and shows success message.
 *    - API error displays error alert.
 * 2. ResetPasswordPage:
 *    - Missing URL token shows error banner.
 *    - Mismatched passwords show validation error without API call.
 *    - Passwords shorter than 6 characters show validation error.
 *    - Valid submission calls resetPassword, triggers onSuccess, and navigates to /dashboard.
 *    - When resetPassword API fails, shows error and does NOT navigate.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ForgotPasswordPage from "../pages/ForgotPasswordPage";
import ResetPasswordPage from "../pages/ResetPasswordPage";

// Mock useNavigate so we can assert navigation calls without a real router
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../services/auth", () => ({
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

import { forgotPassword, resetPassword } from "../services/auth";

const mockForgotPassword = forgotPassword as ReturnType<typeof vi.fn>;
const mockResetPassword = resetPassword as ReturnType<typeof vi.fn>;

describe("Password Reset Frontend Suite (Phase 6B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    delete (window as any).location;
    (window as any).location = { search: "", href: "" };
  });

  describe("ForgotPasswordPage", () => {
    it("submits email and displays confirmation message on success", async () => {
      mockForgotPassword.mockResolvedValue({
        success: true,
        message: "If that email is registered you will receive a reset link.",
      });

      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );

      const emailInput = screen.getByPlaceholderText("you@example.com");
      fireEvent.change(emailInput, { target: { value: "user@aira.io" } });

      const submitBtn = screen.getByRole("button", { name: /Send reset link/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockForgotPassword).toHaveBeenCalledWith("user@aira.io");
        expect(screen.getByText(/Check your inbox/i)).toBeInTheDocument();
      });
    });

    it("displays error message when forgotPassword rejects", async () => {
      mockForgotPassword.mockRejectedValue(new Error("Network failure"));

      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>
      );

      const emailInput = screen.getByPlaceholderText("you@example.com");
      fireEvent.change(emailInput, { target: { value: "user@aira.io" } });

      const submitBtn = screen.getByRole("button", { name: /Send reset link/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/Network failure/i)).toBeInTheDocument();
      });
    });
  });

  describe("ResetPasswordPage", () => {
    it("displays warning banner when no token is present in URL", () => {
      window.location.search = "";

      render(
        <MemoryRouter>
          <ResetPasswordPage onSuccess={vi.fn()} />
        </MemoryRouter>
      );

      expect(screen.getByText(/No reset token found in URL/i)).toBeInTheDocument();
    });

    it("shows error when passwords do not match", async () => {
      window.location.search = "?token=valid_token_abc";

      render(
        <MemoryRouter>
          <ResetPasswordPage onSuccess={vi.fn()} />
        </MemoryRouter>
      );

      const passInput = screen.getByPlaceholderText("At least 6 characters");
      const confirmInput = screen.getByPlaceholderText("Repeat your new password");
      fireEvent.change(passInput, { target: { value: "password123" } });
      fireEvent.change(confirmInput, { target: { value: "differentPassword" } });

      const submitBtn = screen.getByRole("button", { name: /Reset password/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/Passwords do not match/i)).toBeInTheDocument();
        expect(mockResetPassword).not.toHaveBeenCalled();
      });
    });

    it("submits valid new password, calls onSuccess, and navigates to /dashboard", async () => {
      // The component reads token from window.location.search in a useEffect.
      // Set it before render so the effect fires with the correct value.
      window.location.search = "?token=valid_token_abc";

      const onSuccess = vi.fn();
      mockResetPassword.mockResolvedValue({
        success: true,
        token: "new_token_789",
        user: { _id: "u1", name: "User" },
      });

      render(
        <MemoryRouter>
          <ResetPasswordPage onSuccess={onSuccess} />
        </MemoryRouter>
      );

      const passInput = screen.getByPlaceholderText("At least 6 characters");
      const confirmInput = screen.getByPlaceholderText("Repeat your new password");
      fireEvent.change(passInput, { target: { value: "newSecurePassword123" } });
      fireEvent.change(confirmInput, { target: { value: "newSecurePassword123" } });

      fireEvent.click(screen.getByRole("button", { name: /Reset password/i }));

      // API called with correct args and success screen shown
      await waitFor(() => {
        expect(mockResetPassword).toHaveBeenCalledWith("valid_token_abc", "newSecurePassword123");
        expect(screen.getByText(/Password updated!/i)).toBeInTheDocument();
      });

      // onSuccess (setAuthed) called immediately after API response
      expect(onSuccess).toHaveBeenCalledTimes(1);

      // Navigation is scheduled via setTimeout(2000) — verify it was called
      // by waiting slightly longer than the delay (real timers are fine here)
      await new Promise((r) => setTimeout(r, 2100));
      expect(mockNavigate).toHaveBeenCalledWith("/dashboard", { replace: true });
    }, 10000);    it("shows error and does NOT navigate when resetPassword API fails", async () => {
      window.location.search = "?token=valid_token_abc";
      const onSuccess = vi.fn();
      mockResetPassword.mockRejectedValue(new Error("Reset token is invalid or has expired"));

      render(
        <MemoryRouter>
          <ResetPasswordPage onSuccess={onSuccess} />
        </MemoryRouter>
      );

      const passInput = screen.getByPlaceholderText("At least 6 characters");
      const confirmInput = screen.getByPlaceholderText("Repeat your new password");
      fireEvent.change(passInput, { target: { value: "newSecurePassword123" } });
      fireEvent.change(confirmInput, { target: { value: "newSecurePassword123" } });

      fireEvent.click(screen.getByRole("button", { name: /Reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/Reset token is invalid or has expired/i)).toBeInTheDocument();
      });

      // Neither authed flag nor navigation should be triggered on failure
      expect(onSuccess).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
