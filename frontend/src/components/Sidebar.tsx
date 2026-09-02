import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";

function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const navItems = [
    {
      name: "Dashboard",
      path: "/dashboard",
      icon: "⌂",
    },
    {
      name: "AI Chat",
      path: "/chat",
      icon: "✦",
    },
    {
      name: "Knowledge",
      path: "/knowledge",
      icon: "◇",
    },
    {
      name: "Documents",
      path: "/documents",
      icon: "▣",
    },
    {
      name: "Projects",
      path: "/projects",
      icon: "◆",
    },
    {
      name: "Agents",
      path: "/agents",
      icon: "⚡",
    },
  ];

  return (
    <>
      {/* =========================
          Mobile Top Bar
      ========================= */}
      <div
        className={`fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b px-4 backdrop-blur-xl transition-colors duration-300 md:hidden ${
          theme === "dark"
            ? "border-white/10 bg-[#090b15]/90 text-white"
            : "border-blue-900/10 bg-white/90 text-slate-900 shadow-sm"
        }`}
      >
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Open menu"
          className={`rounded-xl p-2 text-xl transition ${
            theme === "dark" ? "text-zinc-300 hover:bg-white/10" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          ☰
        </button>

        <h1
          className={`bg-clip-text text-xl font-black tracking-wider text-transparent ${
            theme === "dark"
              ? "bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400"
              : "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600"
          }`}
        >
          ✦ AIRA
        </h1>

        <button
          onClick={toggleTheme}
          aria-label="Toggle theme mode"
          className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-bold shadow-sm transition ${
            theme === "dark"
              ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-300"
              : "border-blue-300 bg-blue-50 text-blue-600"
          }`}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>

      {/* =========================
          Mobile Overlay
      ========================= */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className={`fixed inset-0 z-40 backdrop-blur-sm md:hidden ${
            theme === "dark" ? "bg-black/70" : "bg-slate-900/40"
          }`}
        />
      )}

      {/* =========================
          Sidebar
      ========================= */}
      <aside
        className={`
          fixed left-0 top-0 z-50
          flex h-screen w-64 shrink-0 flex-col
          overflow-y-auto border-r p-5 backdrop-blur-2xl
          transition-all duration-300

          md:static md:z-auto md:translate-x-0

          ${isOpen ? "translate-x-0" : "-translate-x-full"}
          ${
            theme === "dark"
              ? "border-white/10 bg-[#0a0c16]/90 text-white shadow-2xl"
              : "border-slate-200/80 bg-white/85 text-slate-900 shadow-md"
          }
        `}
      >
        {/* Logo */}
        <div className="mb-8 flex shrink-0 items-start justify-between">
          <div>
            <h1
              className={`bg-clip-text text-2xl font-black tracking-wider text-transparent ${
                theme === "dark"
                  ? "bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400"
                  : "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600"
              }`}
            >
              ✦ AIRA
            </h1>

            <p
              className={`mt-1 text-xs font-medium tracking-wide ${
                theme === "dark" ? "text-zinc-500" : "text-slate-400"
              }`}
            >
              INTELLIGENT WORKSPACE
            </p>
          </div>

          {/* Mobile Close */}
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
            className={`rounded-lg p-1 text-lg transition md:hidden ${
              theme === "dark" ? "text-zinc-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            ✕
          </button>
        </div>

        {/* Navigation */}
        <nav className="space-y-1.5">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => setIsOpen(false)}
              className={({ isActive }) =>
                `flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                  isActive
                    ? theme === "dark"
                      ? "border border-cyan-400/40 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 text-white font-bold shadow-[0_0_20px_rgba(6,182,212,0.35)]"
                      : "border border-blue-400/40 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white font-bold shadow-md shadow-blue-500/20"
                    : theme === "dark"
                    ? "text-zinc-400 hover:bg-white/5 hover:text-cyan-300"
                    : "text-slate-600 hover:bg-blue-50/80 hover:text-blue-700"
                }`
              }
            >
              <span className="flex w-5 justify-center text-base">
                {item.icon}
              </span>

              <span>{item.name}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom Section */}
        <div className="mt-auto space-y-1.5 pt-6">
          {/* Settings */}
          <NavLink
            to="/settings"
            onClick={() => setIsOpen(false)}
            className={({ isActive }) =>
              `flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? theme === "dark"
                    ? "border border-cyan-400/40 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 text-white font-bold shadow-[0_0_20px_rgba(6,182,212,0.35)]"
                    : "border border-blue-400/40 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white font-bold shadow-md shadow-blue-500/20"
                  : theme === "dark"
                  ? "text-zinc-400 hover:bg-white/5 hover:text-cyan-300"
                  : "text-slate-600 hover:bg-blue-50/80 hover:text-blue-700"
              }`
            }
          >
            <span className="flex w-5 justify-center">⚙</span>
            <span>Settings</span>
          </NavLink>

          {/* Help & Support */}
          <NavLink
            to="/help"
            onClick={() => setIsOpen(false)}
            className={({ isActive }) =>
              `flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? theme === "dark"
                    ? "border border-cyan-400/40 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 text-white font-bold shadow-[0_0_20px_rgba(6,182,212,0.35)]"
                    : "border border-blue-400/40 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white font-bold shadow-md shadow-blue-500/20"
                  : theme === "dark"
                  ? "text-zinc-400 hover:bg-white/5 hover:text-cyan-300"
                  : "text-slate-600 hover:bg-blue-50/80 hover:text-blue-700"
              }`
            }
          >
            <span className="flex w-5 justify-center">?</span>
            <span>Help & Support</span>
          </NavLink>

          {/* Theme Mode Toggle Button */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme mode"
            title={`Switch to ${theme === "dark" ? "Light" : "Dark"} mode`}
            className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-all duration-200 active:scale-95 ${
              theme === "dark"
                ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:border-cyan-500/50 hover:bg-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                : "border-blue-300/80 bg-blue-50/90 text-blue-700 hover:bg-blue-100/90 hover:border-blue-400 shadow-sm"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="flex w-5 justify-center text-base">
                {theme === "dark" ? "☀️" : "🌙"}
              </span>
              <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                theme === "dark"
                  ? "bg-cyan-400/20 text-cyan-300"
                  : "bg-blue-200 text-blue-800"
              }`}
            >
              {theme === "dark" ? "Dark" : "Light"}
            </span>
          </button>

          {/* AI Assistant Card */}
          <div
            className={`relative mt-4 overflow-hidden rounded-2xl border p-4 shadow-xl backdrop-blur-2xl transition-colors duration-300 ${
              theme === "dark"
                ? "border-white/15 bg-white/[0.04] shadow-[0_15px_30px_-10px_rgba(0,0,0,0.5)]"
                : "border-white/80 bg-white/45 shadow-md"
            }`}
          >
            <div
              className={`absolute inset-x-0 top-0 h-[1px] ${
                theme === "dark"
                  ? "bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent"
                  : "bg-gradient-to-r from-transparent via-blue-400/30 to-transparent"
              }`}
            />

            <div className="relative z-10">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${
                    theme === "dark"
                      ? "border border-cyan-400/40 bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                      : "border border-blue-200 bg-blue-600 text-white shadow-md shadow-blue-200"
                  }`}
                >
                  ✦
                </div>

                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-semibold ${
                      theme === "dark" ? "text-white" : "text-slate-800"
                    }`}
                  >
                    AIRA Assistant
                  </p>

                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-semibold text-emerald-500">
                      Online
                    </span>
                  </div>
                </div>
              </div>

              <p
                className={`mt-3 text-xs leading-5 ${
                  theme === "dark" ? "text-zinc-400" : "text-slate-500"
                }`}
              >
                Ready to search your workspace and execute tasks.
              </p>

              <NavLink
                to="/chat"
                onClick={() => setIsOpen(false)}
                className={`mt-4 block rounded-xl p-[1px] text-center text-xs font-bold transition-transform active:scale-95 ${
                  theme === "dark"
                    ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white"
                    : "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white"
                }`}
              >
                <div
                  className={`rounded-[11px] px-3 py-2 transition ${
                    theme === "dark"
                      ? "bg-[#0b0e1d] text-white hover:bg-transparent"
                      : "bg-white text-blue-700 hover:bg-transparent hover:text-white"
                  }`}
                >
                  Start conversation →
                </div>
              </NavLink>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;