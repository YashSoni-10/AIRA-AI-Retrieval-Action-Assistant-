import { useTheme } from "../context/ThemeContext";

function ActivityPanel() {
  const { theme } = useTheme();

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border p-4 sm:p-6 backdrop-blur-2xl transition-all duration-300 ease-out hover:-translate-y-1 ${
        theme === "dark"
          ? "border-white/15 bg-white/[0.04] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] hover:border-cyan-400/40 hover:bg-white/[0.07] hover:shadow-[0_20px_40px_rgba(6,182,212,0.2)]"
          : "border-white/80 bg-white/45 shadow-[0_15px_30px_-8px_rgba(0,0,0,0.05)] hover:border-blue-300 hover:bg-white/70 hover:shadow-[0_20px_35px_-5px_rgba(37,99,235,0.15)]"
      }`}
    >
      {/* Top highlight line */}
      <div
        className={`absolute inset-x-0 top-0 h-[1px] ${
          theme === "dark"
            ? "bg-gradient-to-r from-transparent via-white/30 to-transparent"
            : "bg-gradient-to-r from-transparent via-violet-300/50 to-transparent"
        }`}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3">

        <div className="min-w-0">
          <h2 className={`text-lg font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
            Recent Activity
          </h2>

          <p className={`mt-1 text-sm ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
            Latest workspace updates
          </p>
        </div>

        <button
          className={`shrink-0 text-xs font-semibold sm:text-sm transition-colors ${
            theme === "dark" ? "text-cyan-400 hover:text-cyan-300" : "text-violet-600 hover:text-violet-700"
          }`}
        >
          View all →
        </button>

      </div>


      {/* Activity List */}
      <div className="mt-6 space-y-3.5">

        {/* Activity 1 */}
        <div
          className={`flex items-start gap-3 rounded-xl border p-3.5 backdrop-blur-md transition-all duration-200 hover:scale-[1.01] sm:gap-4 ${
            theme === "dark"
              ? "border-white/10 bg-white/[0.03] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:border-cyan-400/30 hover:bg-white/[0.06]"
              : "border-slate-200/60 bg-white/40 shadow-sm hover:border-blue-200 hover:bg-white/70"
          }`}
        >

          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
              theme === "dark"
                ? "border-cyan-400/30 bg-cyan-500/15 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                : "border-blue-200 bg-blue-50 text-blue-600"
            }`}
          >
            📄
          </div>

          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-semibold ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>
              New document indexed
            </p>

            <p className={`mt-1 truncate text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
              API Documentation.pdf
            </p>
          </div>

          <span className={`shrink-0 text-[10px] font-medium sm:text-xs ${theme === "dark" ? "text-zinc-500" : "text-slate-400"}`}>
            10 min ago
          </span>

        </div>


        {/* Activity 2 */}
        <div
          className={`flex items-start gap-3 rounded-xl border p-3.5 backdrop-blur-md transition-all duration-200 hover:scale-[1.01] sm:gap-4 ${
            theme === "dark"
              ? "border-white/10 bg-white/[0.03] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:border-cyan-400/30 hover:bg-white/[0.06]"
              : "border-slate-200/60 bg-white/40 shadow-sm hover:border-blue-200 hover:bg-white/70"
          }`}
        >

          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
              theme === "dark"
                ? "border-cyan-400/30 bg-cyan-500/15 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                : "border-indigo-200 bg-indigo-50 text-indigo-600"
            }`}
          >
            🔗
          </div>

          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-semibold ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>
              GitHub connected
            </p>

            <p className={`mt-1 truncate text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
              Repository successfully synced
            </p>
          </div>

          <span className={`shrink-0 text-[10px] font-medium sm:text-xs ${theme === "dark" ? "text-zinc-500" : "text-slate-400"}`}>
            1 hour ago
          </span>

        </div>


        {/* Activity 3 */}
        <div
          className={`flex items-start gap-3 rounded-xl border p-3.5 backdrop-blur-md transition-all duration-200 hover:scale-[1.01] sm:gap-4 ${
            theme === "dark"
              ? "border-white/10 bg-white/[0.03] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:border-cyan-400/30 hover:bg-white/[0.06]"
              : "border-slate-200/60 bg-white/40 shadow-sm hover:border-blue-200 hover:bg-white/70"
          }`}
        >

          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
              theme === "dark"
                ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                : "border-emerald-200 bg-emerald-50 text-emerald-600"
            }`}
          >
            ✓
          </div>

          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-semibold ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>
              AI task completed
            </p>

            <p className={`mt-1 truncate text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
              Knowledge base updated
            </p>
          </div>

          <span className={`shrink-0 text-[10px] font-medium sm:text-xs ${theme === "dark" ? "text-zinc-500" : "text-slate-400"}`}>
            2 hours ago
          </span>

        </div>

      </div>
    </div>
  );
}

export default ActivityPanel;