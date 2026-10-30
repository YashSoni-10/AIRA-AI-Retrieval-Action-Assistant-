import { useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { forgotPassword } from "../services/auth";
import { IconSparkles, IconCheckCircle2 } from "../components/icons";

export default function ForgotPasswordPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`flex min-h-screen items-center justify-center px-4 transition-colors duration-300 ${
      isDark ? "bg-[#060812]" : "bg-gradient-to-br from-slate-50 to-blue-50"
    }`}>
      {/* Background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={`absolute -left-32 -top-32 h-96 w-96 rounded-full blur-3xl ${isDark ? "bg-cyan-500/10" : "bg-blue-200/40"}`} />
        <div className={`absolute -bottom-32 -right-32 h-96 w-96 rounded-full blur-3xl ${isDark ? "bg-indigo-500/10" : "bg-indigo-200/40"}`} />
      </div>

      <div className={`relative w-full max-w-md overflow-hidden rounded-3xl border shadow-2xl backdrop-blur-2xl ${
        isDark ? "border-white/10 bg-white/[0.04]" : "border-white/80 bg-white/80 shadow-blue-100"
      }`}>
        <div className="h-1 w-full bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600" />

        <div className="px-8 pb-8 pt-7">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl border text-xl font-bold shadow-lg ${
              isDark ? "border-cyan-400/30 bg-cyan-500/20 text-cyan-300" : "border-blue-200 bg-blue-600 text-white shadow-blue-200"
            }`}><IconSparkles className="h-5 w-5" /></div>
            <div>
              <p className={`text-lg font-extrabold leading-none ${isDark ? "text-white" : "text-slate-900"}`}>AIRA</p>
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                AI Work Assistant
              </p>
            </div>
          </div>

          {sent ? (
            <div className="mt-8 text-center">
              <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
                isDark ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-50 text-emerald-600"
              }`}><IconCheckCircle2 className="h-7 w-7 text-emerald-500" /></div>
              <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Check your inbox</h1>
              <p className={`mt-2 text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                If <span className="font-semibold">{email}</span> is registered, a reset link has been sent.
                The link expires in <span className="font-semibold">10 minutes</span>.
              </p>
              <p className={`mt-3 text-xs ${isDark ? "text-zinc-500" : "text-slate-600"}`}>
                Didn't receive an email? Check your spam folder or ask your admin to check the server console (SMTP may not be configured).
              </p>
              <a
                href="/login"
                className={`mt-6 block text-sm font-semibold underline-offset-2 hover:underline ${
                  isDark ? "text-cyan-400" : "text-blue-600"
                }`}
              >← Back to login</a>
            </div>
          ) : (
            <>
              <h1 className={`mt-6 text-2xl font-extrabold ${isDark ? "text-white" : "text-slate-900"}`}>Forgot password?</h1>
              <p className={`mt-1 text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                Enter your email and we'll send a reset link.
              </p>

              {error && (
                <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
                  {error}
                </div>
              )}

              <form id="forgot-password-form" onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className={`mb-1.5 block text-xs font-semibold uppercase tracking-widest ${
                    isDark ? "text-zinc-400" : "text-slate-600"
                  }`}>Email address</label>
                  <input
                    id="forgot-password-email"
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:ring-2 ${
                      isDark
                        ? "border-white/10 bg-white/5 text-white placeholder-zinc-600 focus:border-cyan-400/50 focus:ring-cyan-400/20"
                        : "border-slate-200 bg-slate-50 text-slate-900 placeholder-slate-400 focus:border-blue-400 focus:ring-blue-200"
                    }`}
                  />
                </div>

                <button
                  id="forgot-password-submit"
                  type="submit"
                  disabled={loading}
                  className={`w-full rounded-xl py-3 text-sm font-bold shadow-lg transition-all ${
                    loading ? "cursor-not-allowed opacity-60" : ""
                  } bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-blue-500/25 hover:shadow-blue-500/40`}
                >
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>

              <p className={`mt-6 text-center text-sm ${isDark ? "text-zinc-500" : "text-slate-600"}`}>
                Remember your password?{" "}
                <a
                  href="/login"
                  className={`font-semibold underline-offset-2 hover:underline ${isDark ? "text-cyan-400" : "text-blue-600"}`}
                >Sign in</a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
