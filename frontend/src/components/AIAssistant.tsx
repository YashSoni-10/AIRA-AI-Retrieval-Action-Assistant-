import { useTheme } from "../context/ThemeContext";

function AIAssistant() {
  const { theme } = useTheme();

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border p-5 sm:p-6 backdrop-blur-2xl transition-all duration-300 ease-out hover:-translate-y-1 ${
        theme === "dark"
          ? "border-white/15 bg-white/[0.04] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] hover:border-cyan-400/50 hover:bg-white/[0.07] hover:shadow-[0_20px_40px_rgba(6,182,212,0.2)]"
          : "border-white/80 bg-white/45 shadow-[0_15px_30px_-8px_rgba(0,0,0,0.05)] hover:border-blue-300 hover:bg-white/70 hover:shadow-[0_20px_35px_-5px_rgba(37,99,235,0.15)]"
      }`}
    >
      {/* Top highlight specular line */}
      <div
        className={`absolute inset-x-0 top-0 h-[1px] ${
          theme === "dark"
            ? "bg-gradient-to-r from-transparent via-cyan-400/50 via-blue-400/50 to-transparent"
            : "bg-gradient-to-r from-transparent via-blue-300/50 to-transparent"
        }`}
      />

      {/* Background Glow */}
      <div
        className={`absolute -right-10 -top-10 h-36 w-36 rounded-full blur-3xl pointer-events-none transition-opacity duration-500 ${
          theme === "dark" ? "bg-cyan-500/15 group-hover:bg-cyan-500/25" : "bg-blue-400/15 group-hover:bg-blue-400/25"
        }`}
      />

      <div className="relative z-10">

        {/* Header */}
        <div className="flex items-center justify-between">

          <div className="flex min-w-0 items-center gap-3">

            {/* AI Icon */}
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-xl transition-transform duration-300 group-hover:scale-105 ${
                theme === "dark"
                  ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                  : "border-blue-200 bg-blue-600 text-white shadow-md shadow-blue-200"
              }`}
            >
              ✦
            </div>

            {/* Title */}
            <div className="min-w-0">
              <h2 className={`truncate text-lg font-bold ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                AIRA Assistant
              </h2>

              <div className="mt-1 flex items-center gap-1.5">

                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />

                <span className="text-xs font-semibold text-emerald-500">
                  Online
                </span>

              </div>
            </div>

          </div>

        </div>


        {/* Description */}
        <p className={`mt-5 text-sm leading-6 sm:mt-6 ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
          Ask questions about your workspace, search company knowledge,
          or let AIRA help you complete complex tasks autonomously.
        </p>


        {/* Conversation Button */}
        <button
          className={`mt-5 w-full rounded-xl p-[1px] text-sm font-bold shadow-lg transition-all hover:brightness-110 active:scale-[0.99] sm:mt-6 ${
            theme === "dark"
              ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white"
              : "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white"
          }`}
        >
          <div
            className={`rounded-[11px] px-4 py-3 text-center transition ${
              theme === "dark"
                ? "bg-[#0b0e1d] text-white hover:bg-transparent"
                : "bg-blue-600 text-white hover:bg-transparent"
            }`}
          >
            Start conversation →
          </div>
        </button>

      </div>
    </div>
  );
}

export default AIAssistant;