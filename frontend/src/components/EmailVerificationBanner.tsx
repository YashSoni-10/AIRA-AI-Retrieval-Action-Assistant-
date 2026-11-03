import { useState, useEffect } from "react";
import { useTheme } from "../context/ThemeContext";
import { IconMail, IconX } from "./icons";
import { getUser, resendVerification, getMe } from "../services/auth";

export default function EmailVerificationBanner() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [user, setUser] = useState(() => getUser());
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync user state on mount with fresh backend data
  useEffect(() => {
    let isMounted = true;
    getMe()
      .then((res) => {
        if (isMounted && res.success && res.user) {
          setUser((prev) => (prev ? { ...prev, ...res.user } : res.user));
        }
      })
      .catch(() => {
        // Fall back to existing cached user
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // If no user, or user is already verified (or legacy undefined is treated as verified), do not show
  if (!user || user.isEmailVerified !== false || dismissed) {
    return null;
  }

  const handleResend = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await resendVerification(user.email);
      setMessage(res.message || "Verification link sent! Check your inbox.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend verification email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-testid="email-verification-banner"
      className={`relative z-20 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 text-xs transition-colors duration-200 ${
        isDark
          ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-400">
          <IconMail className="h-3.5 w-3.5 text-amber-500" />
        </span>
        <p className="font-medium">
          <strong className="font-semibold">Verify your email:</strong> A verification link was sent to{" "}
          <span className="underline">{user.email}</span>. Please verify your address to secure your account.
        </p>
      </div>

      <div className="flex items-center gap-3">
        {message ? (
          <span className="font-semibold text-emerald-400">{message}</span>
        ) : error ? (
          <span className="font-semibold text-red-400">{error}</span>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            disabled={loading}
            className={`rounded-lg px-2.5 py-1 font-semibold transition hover:brightness-110 disabled:opacity-50 ${
              isDark
                ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                : "bg-amber-200/60 text-amber-950 hover:bg-amber-200"
            }`}
          >
            {loading ? "Sending..." : "Resend Email"}
          </button>
        )}

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className={`rounded p-1 text-sm transition hover:opacity-75 ${
            isDark ? "text-amber-400/70" : "text-amber-700/70"
          }`}
          title="Dismiss notification"
          aria-label="Dismiss banner"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
