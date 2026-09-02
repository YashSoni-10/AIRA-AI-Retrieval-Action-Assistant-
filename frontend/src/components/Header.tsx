import { useTheme } from "../context/ThemeContext";
import { getUser } from "../services/auth";

function Header() {
  const { theme } = useTheme();
  const user = getUser();
  const name = user?.name || "Yash";
  const avatarLetter = name.charAt(0).toUpperCase();
  const role = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "Developer";

  return (
    <header
      className={`flex items-center justify-between border-b px-4 py-3 backdrop-blur-2xl transition-colors duration-300 md:px-8 md:py-4 ${
        theme === "dark"
          ? "border-white/10 bg-[#0a0c16]/90 text-white shadow-xl"
          : "border-blue-900/10 bg-white/85 text-slate-900 shadow-sm"
      }`}
    >

      {/* Search */}
      <div className="w-full max-w-xs md:w-80">
        <input
          type="text"
          placeholder="Search your workspace..."
          className={`w-full rounded-xl px-4 py-2 text-sm outline-none transition-all ${
            theme === "dark"
              ? "border border-white/15 bg-white/5 text-white placeholder:text-zinc-500 focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/30"
              : "border border-slate-200 bg-slate-100/80 text-slate-900 placeholder:text-slate-400 focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/20"
          }`}
        />
      </div>

      {/* Right Section */}
      <div className="ml-3 flex items-center gap-2 md:gap-3">


        {/* Notification */}
        <button
          aria-label="Notifications"
          className={`rounded-xl border p-2 text-sm transition md:text-base ${
            theme === "dark"
              ? "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10"
              : "border-slate-200 bg-slate-100/70 text-slate-600 hover:bg-slate-200/80"
          }`}
        >
          🔔
        </button>

        {/* User */}
        <div className="flex items-center gap-2 md:gap-3">

          {/* Avatar */}
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold shadow-sm ${
              theme === "dark"
                ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.25)]"
                : "border-blue-300 bg-blue-100 text-blue-700"
            }`}
          >
            {avatarLetter}
          </div>

          {/* User Details */}
          <div className="hidden sm:block">
            <p className={`text-sm font-semibold ${theme === "dark" ? "text-white" : "text-slate-800"}`}>
              {name}
            </p>

            <p className={`text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
              {role}
            </p>
          </div>

        </div>
      </div>

    </header>
  );
}

export default Header;