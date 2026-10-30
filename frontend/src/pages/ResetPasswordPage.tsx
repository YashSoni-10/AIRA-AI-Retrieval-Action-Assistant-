import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { resetPassword } from "../services/auth";
import { IconSparkles, IconCheckCircle2 } from "../components/icons";

interface ResetPasswordPageProps {
  /** Called when reset succeeds and the user should be auto-logged-in. */
  onSuccess: () => void;
}

export default function ResetPasswordPage({ onSuccess }: ResetPasswordPageProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();

  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract token from ?token=... query string
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (t) setToken(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (!token) { setError("Missing reset token. Please use the link from your email."); return; }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      // Mark the app as authenticated first, then navigate to the dashboard.
      // Using navigate() is required because this page lives outside AuthGate;
      // calling only onSuccess() sets authed=true but the URL stays on
      // /reset-password, leaving the user stuck on this page.
      onSuccess();
      setTimeout(() => navigate("/dashboard", { replace: true }), 2000);
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

          {done ? (
            <div className="mt-8 text-center">
              <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
                isDark ? "bg-emerald-500/20 text-emerald-300" : "bg-emerald-50 text-emerald-600"
              }`}><IconCheckCircle2 className="h-7 w-7 text-emerald-500" /></div>
              <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Password updated!</h1>
              <p className={`mt-2 text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                Redirecting you to the dashboard…
              </p>
              <p className={`mt-4 text-xs ${isDark ? "text-zinc-500" : "text-slate-600"}`}>
                Not redirected?{" "}
                <a
                  href="/dashboard"
                  className={`underline ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-500"}`}
                >
                  Click here to sign in
                </a>
              </p>
            </div>
          ) : (
            <>
              <h1 className={`mt-6 text-2xl font-extrabold ${isDark ? "text-white" : "text-slate-900"}`}>
                Set new password
              </h1>
              <p className={`mt-1 text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                Choose a strong password for your account.
              </p>

              {!token && (
                <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
                  No reset token found in URL. Please use the link sent to your email.
                </div>
              )}

              {error && (
                <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
                  {error}
                </div>
              )}

              <form id="reset-password-form" onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className={`mb-1.5 block text-xs font-semibold uppercase tracking-widest ${
                    isDark ? "text-zinc-400" : "text-slate-600"
                  }`}>New password</label>
                  <div className="relative">
                    <input
                      id="reset-password-new"
                      type={showPass ? "text" : "password"}
                      required
                      minLength={6}
                      autoFocus
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className={`w-full rounded-xl border px-4 py-3 pr-11 text-sm outline-none transition focus:ring-2 ${
                        isDark
                          ? "border-white/10 bg-white/5 text-white placeholder-zinc-600 focus:border-cyan-400/50 focus:ring-cyan-400/20"
                          : "border-slate-200 bg-slate-50 text-slate-900 placeholder-slate-400 focus:border-blue-400 focus:ring-blue-200"
                      }`}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPass((v) => !v)}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${isDark ? "text-zinc-500" : "text-slate-600"}`}
                    >{showPass ? "Hide" : "Show"}</button>
                  </div>
                </div>

                <div>
                  <label className={`mb-1.5 block text-xs font-semibold uppercase tracking-widest ${
                    isDark ? "text-zinc-400" : "text-slate-600"
                  }`}>Confirm password</label>
                  <input
                    id="reset-password-confirm"
                    type={showPass ? "text" : "password"}
                    required
                    minLength={6}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your new password"
                    className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:ring-2 ${
                      isDark
                        ? "border-white/10 bg-white/5 text-white placeholder-zinc-600 focus:border-cyan-400/50 focus:ring-cyan-400/20"
                        : "border-slate-200 bg-slate-50 text-slate-900 placeholder-slate-400 focus:border-blue-400 focus:ring-blue-200"
                    }`}
                  />
                </div>

                <button
                  id="reset-password-submit"
                  type="submit"
                  disabled={loading || !token}
                  className={`w-full rounded-xl py-3 text-sm font-bold shadow-lg transition-all ${
                    loading || !token ? "cursor-not-allowed opacity-60" : ""
                  } bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-blue-500/25 hover:shadow-blue-500/40`}
                >
                  {loading ? "Saving…" : "Reset password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
