/**
 * emailVerification.test.tsx
 * ==========================
 * Tests for Phase 6C Email Verification Frontend:
 * 1. VerifyEmailPage:
 *    - Loading state while verifying token
 *    - Success state on valid token
 *    - Error state on invalid / expired token
 *    - Resend verification action from error state
 *    - Missing token state
 * 2. EmailVerificationBanner:
 *    - Hidden for verified users
 *    - Visible for unverified users
 *    - Resend button triggers resendVerification
 * 3. LoginPage:
 *    - Post-registration displays "Check your inbox" screen
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import VerifyEmailPage from "../pages/VerifyEmailPage";
import EmailVerificationBanner from "../components/EmailVerificationBanner";
import LoginPage from "../pages/LoginPage";

vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../services/auth", () => ({
  verifyEmail: vi.fn(),
  resendVerification: vi.fn(),
  getUser: vi.fn(),
  getToken: vi.fn(),
  getMe: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));

import {
  verifyEmail,
  resendVerification,
  getUser,
  getToken,
  getMe,
  register,
} from "../services/auth";

const mockVerifyEmail = verifyEmail as ReturnType<typeof vi.fn>;
const mockResendVerification = resendVerification as ReturnType<typeof vi.fn>;
const mockGetUser = getUser as ReturnType<typeof vi.fn>;
const mockGetToken = getToken as ReturnType<typeof vi.fn>;
const mockGetMe = getMe as ReturnType<typeof vi.fn>;
const mockRegister = register as ReturnType<typeof vi.fn>;

describe("Phase 6C — Email Verification Frontend Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete (window as any).location;
    (window as any).location = { search: "", href: "" };
  });

  describe("VerifyEmailPage", () => {
    it("shows loading state and calls verifyEmail with URL token", async () => {
      window.location.search = "?token=sample_token_123";
      mockVerifyEmail.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
      );

      render(
        <MemoryRouter>
          <VerifyEmailPage />
        </MemoryRouter>
      );

      expect(screen.getByTestId("verification-loading")).toBeInTheDocument();
      expect(screen.getByText(/Verifying your email.../i)).toBeInTheDocument();
      expect(mockVerifyEmail).toHaveBeenCalledWith("sample_token_123");
    });

    it("displays success state when verification succeeds", async () => {
      window.location.search = "?token=valid_token";
      mockVerifyEmail.mockResolvedValue({
        success: true,
        message: "Email verified successfully.",
        user: { _id: "u1", email: "test@aira.io", isEmailVerified: true },
      });

      render(
        <MemoryRouter>
          <VerifyEmailPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("verification-success")).toBeInTheDocument();
        expect(screen.getByText(/Email verified!/i)).toBeInTheDocument();
        expect(screen.getByText(/Your account is confirmed and fully verified./i)).toBeInTheDocument();
      });
    });

    it("displays error state when token is invalid or expired, and allows resending", async () => {
      window.location.search = "?token=expired_token";
      mockVerifyEmail.mockRejectedValue(
        new Error("Verification token is invalid, expired, or has already been used.")
      );
      mockResendVerification.mockResolvedValue({
        success: true,
        message: "If an account with that email exists, a verification link has been sent.",
      });

      render(
        <MemoryRouter>
          <VerifyEmailPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("verification-error")).toBeInTheDocument();
        expect(screen.getByText(/Verification failed/i)).toBeInTheDocument();
        expect(screen.getByText(/Verification token is invalid, expired, or has already been used/i)).toBeInTheDocument();
      });

      // Fill in resend email and click resend button
      const emailInput = screen.getByPlaceholderText("you@company.com");
      fireEvent.change(emailInput, { target: { value: "resend@aira.io" } });

      const resendBtn = screen.getByRole("button", { name: /Resend Verification Email/i });
      fireEvent.click(resendBtn);

      await waitFor(() => {
        expect(mockResendVerification).toHaveBeenCalledWith("resend@aira.io");
        expect(screen.getByText(/If an account with that email exists, a verification link has been sent./i)).toBeInTheDocument();
      });
    });

    it("displays missing token message if no token is in URL params", async () => {
      window.location.search = "";

      render(
        <MemoryRouter>
          <VerifyEmailPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("verification-error")).toBeInTheDocument();
        expect(screen.getByText(/Verification token missing/i)).toBeInTheDocument();
      });
    });
  });

  describe("EmailVerificationBanner", () => {
    it("does not render when user is verified (isEmailVerified: true)", async () => {
      mockGetUser.mockReturnValue({ _id: "u1", email: "verified@aira.io", isEmailVerified: true });
      mockGetMe.mockResolvedValue({ success: true, user: { _id: "u1", isEmailVerified: true } });

      render(<EmailVerificationBanner />);

      expect(screen.queryByTestId("email-verification-banner")).toBeNull();
    });

    it("renders banner for unverified user and triggers resend verification", async () => {
      mockGetUser.mockReturnValue({ _id: "u2", email: "unverified@aira.io", isEmailVerified: false });
      mockGetMe.mockResolvedValue({ success: true, user: { _id: "u2", email: "unverified@aira.io", isEmailVerified: false } });
      mockResendVerification.mockResolvedValue({ success: true, message: "Verification link sent! Check your inbox." });

      render(<EmailVerificationBanner />);

      await waitFor(() => {
        expect(screen.getByTestId("email-verification-banner")).toBeInTheDocument();
        expect(screen.getByText(/unverified@aira.io/i)).toBeInTheDocument();
      });

      const resendButton = screen.getByRole("button", { name: /Resend Email/i });
      fireEvent.click(resendButton);

      await waitFor(() => {
        expect(mockResendVerification).toHaveBeenCalledWith("unverified@aira.io");
        expect(screen.getByText(/Verification link sent! Check your inbox./i)).toBeInTheDocument();
      });
    });
  });

  describe("LoginPage — Post Registration", () => {
    it("displays 'Check your inbox' view after registration", async () => {
      mockGetToken.mockReturnValue(null);
      mockRegister.mockResolvedValue({
        success: true,
        token: "reg_token_123",
        user: { _id: "new_1", email: "newreg@aira.io", isEmailVerified: false },
      });

      render(<LoginPage onSuccess={vi.fn()} />);

      // Switch to Register tab
      const registerTab = screen.getByRole("button", { name: "Register" });
      fireEvent.click(registerTab);

      // Fill in details
      fireEvent.change(screen.getByPlaceholderText("John Smith"), { target: { value: "New User" } });
      fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "newreg@aira.io" } });
      fireEvent.change(screen.getByPlaceholderText("Min. 6 characters"), { target: { value: "password123" } });

      // Submit
      const submitBtn = screen.getByRole("button", { name: "Create Account" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockRegister).toHaveBeenCalledWith("New User", "newreg@aira.io", "password123");
        expect(screen.getByTestId("check-inbox-view")).toBeInTheDocument();
        expect(screen.getByText(/Check your inbox/i)).toBeInTheDocument();
        expect(screen.getByText(/newreg@aira.io/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Continue to Workspace/i })).toBeInTheDocument();
      });
    });
  });
});
