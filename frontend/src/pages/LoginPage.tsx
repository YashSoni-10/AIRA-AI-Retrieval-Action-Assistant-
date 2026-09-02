import { useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { login, register, getToken } from "../services/auth";

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        if (!name.trim()) { setError("Name is required"); setLoading(false); return; }
        await register(name, email, password);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  // If already logged in, skip
  if (getToken()) {
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
              ✦
            </div>
            <div>
              <p className={`text-lg font-extrabold leading-none ${isDark ? "text-white" : "text-slate-900"}`}>AIRA</p>
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                AI Work Assistant
              </p>
            </div>
          </div>

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
                      : "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
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
                    : "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
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
                      : "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 text-sm ${isDark ? "text-zinc-400" : "text-slate-400"}`}
                >
                  {showPass ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            {error && (
              <div className={`rounded-xl border px-4 py-3 text-xs font-medium ${
                isDark ? "border-red-400/20 bg-red-500/10 text-red-300" : "border-red-200 bg-red-50 text-red-600"
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
          </form>

          <p className={`mt-5 text-center text-xs ${isDark ? "text-zinc-600" : "text-slate-400"}`}>
            Protected by JWT · Passwords encrypted with bcrypt
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
