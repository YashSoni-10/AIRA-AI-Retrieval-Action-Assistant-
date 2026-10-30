import { useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { IconSparkles, IconMail, IconEye, IconEyeOff } from "../components/icons";
import { login, register, getToken, resendVerification, logout } from "../services/auth";

interface LoginPageProps {
  onSuccess: () => void;
}

function LoginPage({ onSuccess }: LoginPageProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  // Post-registration "Check your inbox" state
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
        onSuccess();
      } else {
        if (!name.trim()) { setError("Name is required"); setLoading(false); return; }
        await register(name, email, password);
        setRegisteredEmail(email);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!registeredEmail) return;
    setResendError(null);
    setResendSuccess(null);
    setResendLoading(true);
    try {
      const res = await resendVerification(registeredEmail);
      setResendSuccess(res.message || "Verification email sent. Please check your inbox.");
    } catch (err) {
      setResendError(err instanceof Error ? err.message : "Failed to resend verification email.");
    } finally {
      setResendLoading(false);
    }
  };

  // If already logged in, skip (unless viewing the post-registration check-inbox screen)
  if (getToken() && !registeredEmail) {
    onSuccess();
    return null;
  }

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
        {/* Top gradient edge */}
        <div className={`h-1 w-full bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600`} />

        <div className="px-8 pb-8 pt-7">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl border text-xl font-bold shadow-lg ${
              isDark ? "border-cyan-400/30 bg-cyan-500/20 text-cyan-300" : "border-blue-200 bg-blue-600 text-white shadow-blue-200"
            }`}>
              <IconSparkles className="h-5 w-5" />
            </div>
            <div>
              <p className={`text-lg font-extrabold leading-none ${isDark ? "text-white" : "text-slate-900"}`}>AIRA</p>
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                AI Work Assistant
              </p>
            </div>
          </div>

          {registeredEmail ? (
            <div className="mt-8 text-center" data-testid="check-inbox-view">
              <div
                className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow-inner ${
                  isDark
                    ? "border border-cyan-400/30 bg-cyan-500/10 text-cyan-300"
                    : "border border-blue-200 bg-blue-50 text-blue-600"
                }`}
              >
                <IconMail className="h-6 w-6" />
              </div>
              <h1 className={`text-2xl font-extrabold ${isDark ? "text-white" : "text-slate-900"}`}>
                Check your inbox
              </h1>
              <p className={`mt-2 text-sm leading-relaxed ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                We've sent a verification link to <strong className={isDark ? "text-white" : "text-slate-900"}>{registeredEmail}</strong>. Please click the link inside to verify your email address.
              </p>

              {resendSuccess && (
                <div className={`mt-4 rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
                  isDark ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}>
                  {resendSuccess}
                </div>
              )}

              {resendError && (
                <div className={`mt-4 rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
                  isDark ? "border-red-400/20 bg-red-500/10 text-red-300" : "border-red-200 bg-red-50 text-red-800"
                }`}>
                  {resendError}
                </div>
              )}

              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  onClick={() => onSuccess()}
                  className="w-full rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
                >
                  Continue to Workspace
                </button>

                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendLoading}
                  className={`w-full rounded-xl border py-2.5 text-xs font-semibold transition ${
                    isDark
                      ? "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  } disabled:opacity-50`}
                >
                  {resendLoading ? "Resending..." : "Resend Verification Email"}
                </button>
              </div>

              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={() => {
                    logout(false);
                    setRegisteredEmail(null);
                    setMode("login");
                  }}
                  className={`text-xs font-medium underline-offset-2 hover:underline ${
                    isDark ? "text-cyan-400/80" : "text-blue-600"
                  }`}
                >
                  Back to Sign In
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className={`mt-6 text-2xl font-extrabold ${isDark ? "text-white" : "text-slate-900"}`}>
                {mode === "login" ? "Welcome back" : "Create account"}
              </h1>
              <p className={`mt-1 text-sm ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                {mode === "login"
                  ? "Sign in to your AIRA workspace"
                  : "Join your team's AI-powered workspace"}
              </p>

              {/* Toggle */}
              <div className={`mt-6 flex overflow-hidden rounded-xl border p-1 ${isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-200 bg-slate-100"}`}>
                {(["login", "register"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setError(null); }}
                    className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all duration-200 ${
                      mode === m
                        ? isDark
                          ? "bg-gradient-to-r from-cyan-400/20 to-blue-500/20 border border-cyan-400/30 text-white shadow-sm"
                          : "bg-white text-slate-900 shadow-sm border border-slate-200"
                        : isDark ? "text-zinc-400 hover:text-zinc-200" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {m === "login" ? "Sign In" : "Register"}
                  </button>
                ))}
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                {mode === "register" && (
                  <div>
                    <label className={`mb-1.5 block text-xs font-semibold ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="John Smith"
                      className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition ${
                        isDark
                          ? "border-white/10 bg-white/[0.06] text-white placeholder:text-zinc-600 focus:border-cyan-400/60"
                          : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      }`}
                    />
                  </div>
                )}

                <div>
                  <label className={`mb-1.5 block text-xs font-semibold ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition ${
                      isDark
                        ? "border-white/10 bg-white/[0.06] text-white placeholder:text-zinc-600 focus:border-cyan-400/60"
                        : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    }`}
                  />
                </div>

                <div>
                  <label className={`mb-1.5 block text-xs font-semibold ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      required
                      className={`w-full rounded-xl border px-4 py-3 pr-10 text-sm outline-none transition ${
                        isDark
                          ? "border-white/10 bg-white/[0.06] text-white placeholder:text-zinc-600 focus:border-cyan-400/60"
                          : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className={`absolute right-3 top-1/2 -translate-y-1/2 text-sm ${isDark ? "text-zinc-400" : "text-slate-400"}`}
                    >
                      {showPass ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className={`rounded-xl border px-4 py-3 text-xs font-medium ${
                    isDark ? "border-red-400/20 bg-red-500/10 text-red-300" : "border-red-200 bg-red-50 text-red-800"
                  }`}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 w-full rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading
                    ? (mode === "login" ? "Signing in..." : "Creating account...")
                    : (mode === "login" ? "Sign In" : "Create Account")}
                </button>

                {mode === "login" && (
                  <p className={`mt-3 text-center text-xs ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                    <a
                      id="forgot-password-link"
                      href="/forgot-password"
                      className={`font-medium underline-offset-2 hover:underline ${isDark ? "text-cyan-400/80" : "text-blue-500"}`}
                    >Forgot your password?</a>
                  </p>
                )}
              </form>
            </>
          )}

          <p className={`mt-5 text-center text-xs ${isDark ? "text-zinc-600" : "text-slate-400"}`}>
            Protected by JWT · Passwords encrypted with bcrypt
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
