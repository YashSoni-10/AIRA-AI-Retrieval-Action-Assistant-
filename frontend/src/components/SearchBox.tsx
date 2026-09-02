import { useTheme } from "../context/ThemeContext";

function SearchBox() {
  const { theme } = useTheme();

  return (
    <div className="mt-8">
      {/* Search Box */}
      <div
        className={`group relative overflow-hidden rounded-2xl border p-3.5 backdrop-blur-2xl transition-all duration-300 ${
          theme === "dark"
            ? "border-white/15 bg-white/[0.04] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] focus-within:border-cyan-400/60 focus-within:shadow-[0_20px_45px_rgba(6,182,212,0.25)] hover:border-white/25 hover:bg-white/[0.06]"
            : "border-white/80 bg-white/50 shadow-[0_15px_30px_-8px_rgba(0,0,0,0.06)] focus-within:border-blue-500 focus-within:shadow-[0_20px_40px_rgba(37,99,235,0.15)] hover:border-slate-300 hover:bg-white/70"
        }`}
      >
        {/* Top edge specular reflection line */}
        <div
          className={`absolute inset-x-0 top-0 h-[1px] transition-opacity ${
            theme === "dark"
              ? "bg-gradient-to-r from-transparent via-cyan-400/50 via-blue-400/50 to-transparent"
              : "bg-gradient-to-r from-transparent via-blue-300/60 to-transparent"
          }`}
        />

        {/* Input + Button */}
        <div className="flex items-center gap-2">

          {/* AI Icon */}
          <span className={`shrink-0 pl-2 text-xl transition-transform duration-300 group-hover:scale-110 ${
            theme === "dark" ? "text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]" : "text-blue-600"
          }`}>
            ✦
          </span>

          {/* Input */}
          <input
            type="text"
            placeholder="Ask anything about your workspace..."
            className={`min-w-0 flex-1 bg-transparent px-2 py-3 text-sm outline-none ${
              theme === "dark"
                ? "text-white placeholder:text-zinc-500"
                : "text-slate-900 placeholder:text-slate-400"
            }`}
          />

          {/* Ask Button */}
          <button
            className={`shrink-0 rounded-xl px-5 py-3 text-xs font-bold shadow-lg transition-all hover:brightness-110 active:scale-95 sm:px-6 sm:text-sm ${
              theme === "dark"
                ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white shadow-cyan-500/20"
                : "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white shadow-blue-500/20"
            }`}
          >
            <span className="sm:hidden">
              Ask
            </span>

            <span className="hidden sm:inline">
              Ask AIRA
            </span>
          </button>

        </div>
      </div>


      {/* Quick Actions */}
      <div className="mt-4 flex gap-2.5 overflow-x-auto pb-1">

        <button
          className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 ${
            theme === "dark"
              ? "border-white/10 bg-white/5 text-zinc-300 shadow-sm hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-300"
              : "border-slate-200/80 bg-white/70 text-slate-600 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          }`}
        >
          Search documents
        </button>

        <button
          className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 ${
            theme === "dark"
              ? "border-white/10 bg-white/5 text-zinc-300 shadow-sm hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-300"
              : "border-slate-200/80 bg-white/70 text-slate-600 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          }`}
        >
          Search GitHub
        </button>

        <button
          className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 ${
            theme === "dark"
              ? "border-white/10 bg-white/5 text-zinc-300 shadow-sm hover:border-indigo-400/50 hover:bg-indigo-500/10 hover:text-indigo-300"
              : "border-slate-200/80 bg-white/70 text-slate-600 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          }`}
        >
          Ask AI
        </button>

      </div>
    </div>
  );
}

export default SearchBox;