import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { IconSparkles, IconCheckCircle2, IconX } from "../components/icons";
import { verifyEmail, resendVerification, getUser, getToken } from "../services/auth";

interface VerifyEmailPageProps {
  onSuccess?: () => void;
}

export default function VerifyEmailPage({ onSuccess }: VerifyEmailPageProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();

  const [status, setStatus] = useState<"verifying" | "success" | "error" | "no_token">("verifying");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [resendEmail, setResendEmail] = useState<string>(() => getUser()?.email || "");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("no_token");
      return;
    }

    let isMounted = true;
    verifyEmail(token)
      .then((res) => {
        if (!isMounted) return;
        if (res.success) {
          setStatus("success");
          if (onSuccess && getToken()) {
            // If already logged in, update auth state
            setTimeout(() => {
              onSuccess();
            }, 2500);
          }
        } else {
          setStatus("error");
          setErrorMessage(res.message || "Failed to verify email.");
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Verification failed or token expired.");
      });

    return () => {
      isMounted = false;
    };
  }, [onSuccess]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResendError(null);
    setResendSuccess(null);
    if (!resendEmail.trim()) {
      setResendError("Please provide an email address.");
      return;
    }

    setResendLoading(true);
    try {
      const res = await resendVerification(resendEmail.trim());
      setResendSuccess(res.message || "Verification email sent. Please check your inbox.");
    } catch (err) {
      setResendError(err instanceof Error ? err.message : "Failed to resend verification email.");
    } finally {
      setResendLoading(false);
    }
  };

  const handleContinue = () => {
    if (onSuccess && getToken()) {
      onSuccess();
      navigate("/dashboard");
    } else {
      navigate("/");
    }
  };

  return (
    <div
      className={`flex min-h-screen items-center justify-center px-4 transition-colors duration-300 ${
        isDark ? "bg-[#060812]" : "bg-gradient-to-br from-slate-50 to-blue-50"
      }`}
    >
      {/* Background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className={`absolute -left-32 -top-32 h-96 w-96 rounded-full blur-3xl ${
            isDark ? "bg-cyan-500/10" : "bg-blue-200/40"
          }`}
        />
        <div
          className={`absolute -bottom-32 -right-32 h-96 w-96 rounded-full blur-3xl ${
            isDark ? "bg-indigo-500/10" : "bg-indigo-200/40"
          }`}
        />
      </div>

      <div
        className={`relative w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl backdrop-blur-2xl ${
          isDark
            ? "border-white/10 bg-white/[0.04]"
            : "border-white/80 bg-white/80 shadow-blue-100"
        }`}
      >
        <div className="h-1 w-full bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600" />

        <div className="px-8 pb-8 pt-7">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl border text-xl font-bold shadow-lg ${
                isDark
                  ? "border-cyan-400/30 bg-cyan-500/20 text-cyan-300"
                  : "border-blue-200 bg-blue-600 text-white shadow-blue-200"
              }`}
            >
              <IconSparkles className="h-5 w-5" />
            </div>
            <div>
              <p
                className={`text-lg font-extrabold leading-none ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                AIRA
              </p>
              <p
                className={`text-[10px] font-semibold uppercase tracking-widest ${
                  isDark ? "text-cyan-400" : "text-blue-600"
                }`}
              >
                AI Work Assistant
              </p>
            </div>
          </div>

          {/* ── STATE 1: VERIFYING (LOADING) ── */}
          {status === "verifying" && (
            <div className="mt-8 text-center" data-testid="verification-loading">
              <div
                className={`mx-auto mb-4 flex h-14 w-14 animate-spin items-center justify-center rounded-full border-4 border-t-transparent ${
                  isDark
                    ? "border-cyan-400 border-t-transparent"
                    : "border-blue-600 border-t-transparent"
                }`}
              />
              <h1
                className={`text-xl font-bold ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                Verifying your email...
              </h1>
              <p
                className={`mt-2 text-sm ${
                  isDark ? "text-zinc-400" : "text-slate-600"
                }`}
              >
                Please wait while we confirm your verification link.
              </p>
            </div>
          )}

          {/* ── STATE 2: SUCCESS ── */}
          {status === "success" && (
            <div className="mt-8 text-center" data-testid="verification-success">
              <div
                className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
                  isDark
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-emerald-50 text-emerald-600"
                }`}
              >
                <IconCheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <h1
                className={`text-xl font-bold ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                Email verified!
              </h1>
              <p
                className={`mt-2 text-sm ${
                  isDark ? "text-zinc-400" : "text-slate-600"
                }`}
              >
                Your account is confirmed and fully verified.
              </p>
              <button
                type="button"
                onClick={handleContinue}
                className="mt-6 w-full rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
              >
                {getToken() ? "Continue to Workspace" : "Proceed to Sign In"}
              </button>
            </div>
          )}

          {/* ── STATE 3: ERROR / EXPIRED / NO TOKEN ── */}
          {(status === "error" || status === "no_token") && (
            <div className="mt-6" data-testid="verification-error">
              <div
                className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
                  isDark
                    ? "bg-red-500/20 text-red-300"
                    : "bg-red-50 text-red-600"
                }`}
              >
                <IconX className="h-7 w-7 text-red-500" />
              </div>
              <h1
                className={`text-center text-xl font-bold ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                {status === "no_token"
                  ? "Verification token missing"
                  : "Verification failed"}
              </h1>
              <p
                className={`mt-2 text-center text-sm ${
                  isDark ? "text-zinc-400" : "text-slate-600"
                }`}
              >
                {status === "no_token"
                  ? "No verification token was provided in the link. Please request a new verification email."
                  : errorMessage || "The verification link is invalid, expired, or has already been used."}
              </p>

              {/* Resend verification box */}
              <div
                className={`mt-6 rounded-2xl border p-4 ${
                  isDark
                    ? "border-white/10 bg-white/[0.02]"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <h2
                  className={`text-xs font-bold uppercase tracking-wider ${
                    isDark ? "text-cyan-400" : "text-blue-600"
                  }`}
                >
                  Request a new verification link
                </h2>
                <form onSubmit={handleResend} className="mt-3 space-y-3">
                  <div>
                    <label
                      className={`block text-xs font-medium ${
                        isDark ? "text-zinc-400" : "text-slate-600"
                      }`}
                    >
                      Email address
                    </label>
                    <input
                      type="email"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                      className={`mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition ${
                        isDark
                          ? "border-white/10 bg-white/[0.06] text-white placeholder:text-zinc-600 focus:border-cyan-400/60"
                          : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
                      }`}
                    />
                  </div>

                  {resendSuccess && (
                    <div
                      className={`rounded-xl border px-3.5 py-2 text-xs font-medium ${
                        isDark
                          ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {resendSuccess}
                    </div>
                  )}

                  {resendError && (
                    <div
                      className={`rounded-xl border px-3.5 py-2 text-xs font-medium ${
                        isDark
                          ? "border-red-400/20 bg-red-500/10 text-red-300"
                          : "border-red-200 bg-red-50 text-red-600"
                      }`}
                    >
                      {resendError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={resendLoading}
                    className="w-full rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 py-2.5 text-sm font-bold text-white shadow transition hover:brightness-110 disabled:opacity-60"
                  >
                    {resendLoading ? "Sending..." : "Resend Verification Email"}
                  </button>
                </form>
              </div>

              <div className="mt-5 text-center">
                <Link
                  to="/"
                  className={`text-xs font-medium underline-offset-2 hover:underline ${
                    isDark ? "text-cyan-400/80" : "text-blue-600"
                  }`}
                >
                  Back to Sign In
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
