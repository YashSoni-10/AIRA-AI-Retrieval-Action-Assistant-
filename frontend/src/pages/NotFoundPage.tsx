import { Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";

function NotFoundPage() {
  const { theme } = useTheme();

  return (
    <div
      className={`flex min-h-screen flex-1 items-center justify-center px-6 transition-colors duration-300 ${
        theme === "dark" ? "bg-[#060812]" : "bg-slate-50"
      }`}
    >
      <div className="text-center">

        {/* AIRA Icon */}
        <div
          className={`mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border text-3xl transition ${
            theme === "dark"
              ? "border-cyan-400/30 bg-cyan-500/20 text-cyan-300 shadow-[0_0_30px_rgba(6,182,212,0.3)]"
              : "border-blue-200 bg-blue-600 text-white shadow-xl shadow-blue-200"
          }`}
        >
          ✦
        </div>

        {/* Error */}
        <p className={`mt-8 text-7xl font-black tracking-tight ${theme === "dark" ? "text-zinc-800" : "text-slate-200"}`}>
          404
        </p>

        <h1 className={`mt-4 text-2xl font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
          Page not found
        </h1>

        <p className={`mx-auto mt-3 max-w-md text-sm leading-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
          The page you're looking for doesn't exist or may have
          been moved to another location.
        </p>

        {/* Back Button */}
        <Link
          to="/dashboard"
          className={`mt-7 inline-flex rounded-xl px-6 py-3 text-sm font-bold shadow-lg transition hover:brightness-110 ${
            theme === "dark"
              ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white"
              : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
          }`}
        >
          ← Back to Dashboard
        </Link>

      </div>
    </div>
  );
}

export default NotFoundPage;