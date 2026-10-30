import React, { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { getUser, logout, type AuthUser } from "../services/auth";
import {
  IconLayoutDashboard,
  IconMessageSquare,
  IconDatabase,
  IconFiles,
  IconFolderKanban,
  IconGithub,
  IconWorkflow,
  IconListChecks,
  IconUsers,
  IconSettings,
  IconCircleHelp,
  IconSun,
  IconMoon,
  IconLogOut,
  IconSparkles,
  IconBot,
  IconMenu,
  IconX,
  IconArrowRight,
} from "./icons";

interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState<AuthUser | null>(() => getUser());
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    const handleUpdate = (e?: Event) => {
      const customEvt = e as CustomEvent<AuthUser | null> | undefined;
      if (customEvt && customEvt.detail !== undefined) {
        setUser(customEvt.detail);
      } else {
        setUser(getUser());
      }
      setImgError(false);
    };

    window.addEventListener("aira_user_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("aira_user_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  useEffect(() => {
    setImgError(false);
  }, [user?.avatar]);

  const role = user?.role || "member";

  const handleLogout = () => {
    logout();
    window.location.reload();
  };

  const baseNavItems: NavItem[] = [
    {
      name: "Dashboard",
      path: "/dashboard",
      icon: IconLayoutDashboard,
    },
    {
      name: "AI Chat",
      path: "/chat",
      icon: IconMessageSquare,
    },
    {
      name: "Knowledge",
      path: "/knowledge",
      icon: IconDatabase,
    },
    {
      name: "Documents",
      path: "/documents",
      icon: IconFiles,
    },
    {
      name: "Projects",
      path: "/projects",
      icon: IconFolderKanban,
    },
    {
      name: "GitHub",
      path: "/github",
      icon: IconGithub,
    },
    {
      name: "Agents",
      path: "/agents",
      icon: IconWorkflow,
    },
    {
      name: "Tasks",
      path: "/tasks",
      icon: IconListChecks,
    },
  ];

  // Role-specific nav items (admin-only)
  const roleNavItems: NavItem[] = [];
  if (role === "admin") {
    roleNavItems.push({
      name: "User Management",
      path: "/admin/users",
      icon: IconUsers,
    });
  }

  const navItems = [...baseNavItems, ...roleNavItems];
  const isDark = theme === "dark";

  return (
    <>
      {/* =========================
          Mobile Top Bar
      ========================= */}
      <div
        className={`fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b px-4 backdrop-blur-xl transition-colors duration-300 md:hidden ${
          isDark
            ? "border-white/10 bg-[#090b15]/90 text-white"
            : "border-slate-200 bg-white/95 text-slate-900 shadow-sm"
        }`}
      >
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Open menu"
          className={`rounded-xl p-2 transition ${
            isDark ? "text-zinc-300 hover:bg-white/10" : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          <IconMenu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2">
          <IconSparkles className="h-5 w-5 text-cyan-400" />
          <h1
            className={`bg-clip-text text-xl font-black tracking-wider text-transparent ${
              isDark
                ? "bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400"
                : "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600"
            }`}
          >
            AIRA
          </h1>
        </div>

        <button
          onClick={toggleTheme}
          aria-label="Toggle theme mode"
          className={`flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition ${
            isDark
              ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-300"
              : "border-blue-300 bg-blue-50 text-blue-700"
          }`}
        >
          {isDark ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
        </button>
      </div>

      {/* =========================
          Mobile Overlay
      ========================= */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className={`fixed inset-0 z-40 backdrop-blur-sm md:hidden ${
            isDark ? "bg-black/70" : "bg-slate-900/40"
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
            isDark
              ? "border-white/10 bg-[#0a0c16]/90 text-white shadow-2xl"
              : "border-slate-200 bg-white text-slate-900 shadow-sm"
          }
        `}
      >
        {/* Logo */}
        <div className="mb-7 flex shrink-0 items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <IconSparkles className="h-6 w-6 text-cyan-400" />
              <h1
                className={`bg-clip-text text-2xl font-black tracking-wider text-transparent ${
                  isDark
                    ? "bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400"
                    : "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600"
                }`}
              >
                AIRA
              </h1>
            </div>

            <p
              className={`mt-1 text-[11px] font-semibold tracking-wider ${
                isDark ? "text-zinc-500" : "text-slate-500"
              }`}
            >
              INTELLIGENT WORKSPACE
            </p>
          </div>

          {/* Mobile Close */}
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
            className={`rounded-lg p-1 transition md:hidden ${
              isDark ? "text-zinc-400 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setIsOpen(false)}
                className={({ isActive }) =>
                  `flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-cyan-400/50 outline-none ${
                    isActive
                      ? isDark
                        ? "border border-cyan-400/40 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 text-white font-bold shadow-[0_0_20px_rgba(6,182,212,0.35)]"
                        : "border border-blue-400/40 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white font-bold shadow-md shadow-blue-500/20"
                      : isDark
                      ? "text-zinc-400 hover:bg-white/5 hover:text-cyan-300"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  }`
                }
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-inherit">
                  <Icon className="h-[18px] w-[18px]" />
                </span>

                <span className="truncate">{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom Section */}
        <div className="mt-auto space-y-1.5 pt-4">
          {/* User Profile & Role Info */}
          {user && (
            <div
              className={`mb-3 rounded-xl border p-3 text-xs transition ${
                isDark
                  ? "border-white/10 bg-white/[0.03] text-white"
                  : "border-slate-200 bg-slate-50 text-slate-900 shadow-sm"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {user.avatar && !imgError ? (
                  <img
                    src={user.avatar}
                    alt={user.name || "User"}
                    onError={() => setImgError(true)}
                    className="h-8 w-8 shrink-0 rounded-full object-cover border border-cyan-400/30"
                  />
                ) : (
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                      isDark
                        ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-300"
                        : "border-blue-300 bg-blue-100 text-blue-700"
                    }`}
                  >
                    {(user.name || "U").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-semibold text-xs">
                      {user.name || "User"}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                        role === "admin"
                          ? isDark
                            ? "border border-purple-500/40 bg-purple-500/20 text-purple-300"
                            : "border border-purple-300 bg-purple-100 text-purple-800"
                          : role === "viewer"
                          ? isDark
                            ? "border border-amber-500/40 bg-amber-500/20 text-amber-300"
                            : "border border-amber-300 bg-amber-100 text-amber-800"
                          : isDark
                          ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                          : "border border-cyan-300 bg-cyan-100 text-cyan-800"
                      }`}
                    >
                      {role}
                    </span>
                  </div>
                  <p className={`truncate text-[10px] ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                    {user.email}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Settings */}
          <NavLink
            to="/settings"
            onClick={() => setIsOpen(false)}
            className={({ isActive }) =>
              `flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-cyan-400/50 outline-none ${
                isActive
                  ? isDark
                    ? "border border-cyan-400/40 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 text-white font-bold shadow-[0_0_20px_rgba(6,182,212,0.35)]"
                    : "border border-blue-400/40 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white font-bold shadow-md shadow-blue-500/20"
                  : isDark
                  ? "text-zinc-400 hover:bg-white/5 hover:text-cyan-300"
                  : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              }`
            }
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-inherit">
              <IconSettings className="h-[18px] w-[18px]" />
            </span>
            <span>Settings</span>
          </NavLink>

          {/* Help & Support */}
          <NavLink
            to="/help"
            onClick={() => setIsOpen(false)}
            className={({ isActive }) =>
              `flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-cyan-400/50 outline-none ${
                isActive
                  ? isDark
                    ? "border border-cyan-400/40 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 text-white font-bold shadow-[0_0_20px_rgba(6,182,212,0.35)]"
                    : "border border-blue-400/40 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white font-bold shadow-md shadow-blue-500/20"
                  : isDark
                  ? "text-zinc-400 hover:bg-white/5 hover:text-cyan-300"
                  : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              }`
            }
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-inherit">
              <IconCircleHelp className="h-[18px] w-[18px]" />
            </span>
            <span>Help & Support</span>
          </NavLink>

          {/* Theme Mode Toggle Button */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme mode"
            title={`Switch to ${isDark ? "Light" : "Dark"} mode`}
            className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold transition-all duration-200 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-cyan-400/50 outline-none ${
              isDark
                ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:border-cyan-500/50 hover:bg-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                : "border-blue-300/80 bg-blue-50 text-blue-800 hover:bg-blue-100 hover:border-blue-400 shadow-sm"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-inherit">
                {isDark ? <IconSun className="h-[18px] w-[18px]" /> : <IconMoon className="h-[18px] w-[18px]" />}
              </span>
              <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                isDark
                  ? "bg-cyan-400/20 text-cyan-300"
                  : "bg-blue-200 text-blue-900"
              }`}
            >
              {isDark ? "Dark" : "Light"}
            </span>
          </button>

          {/* Sign Out */}
          <button
            onClick={handleLogout}
            aria-label="Sign Out"
            className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-red-400/50 outline-none ${
              isDark
                ? "text-zinc-400 hover:bg-red-500/10 hover:text-red-400"
                : "text-slate-700 hover:bg-red-50 hover:text-red-600"
            }`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-inherit">
              <IconLogOut className="h-[18px] w-[18px]" />
            </span>
            <span>Sign Out</span>
          </button>

          {/* AI Assistant Card */}
          <div
            className={`relative mt-3 overflow-hidden rounded-2xl border p-4 shadow-xl backdrop-blur-2xl transition-colors duration-300 ${
              isDark
                ? "border-white/15 bg-white/[0.04] shadow-[0_15px_30px_-10px_rgba(0,0,0,0.5)]"
                : "border-slate-200 bg-white shadow-sm"
            }`}
          >
            <div
              className={`absolute inset-x-0 top-0 h-[1px] ${
                isDark
                  ? "bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent"
                  : "bg-gradient-to-r from-transparent via-blue-400/30 to-transparent"
              }`}
            />

            <div className="relative z-10">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${
                    isDark
                      ? "border border-cyan-400/40 bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                      : "border border-blue-200 bg-blue-600 text-white shadow-md shadow-blue-200"
                  }`}
                >
                  <IconBot className="h-5 w-5" />
                </div>

                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-semibold ${
                      isDark ? "text-white" : "text-slate-900"
                    }`}
                  >
                    AIRA Assistant
                  </p>

                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-semibold text-emerald-600">
                      Online
                    </span>
                  </div>
                </div>
              </div>

              <p
                className={`mt-3 text-xs leading-5 ${
                  isDark ? "text-zinc-400" : "text-slate-600"
                }`}
              >
                Ready to search your workspace and execute tasks.
              </p>

              <NavLink
                to="/chat"
                onClick={() => setIsOpen(false)}
                className={`mt-3 block rounded-xl p-[1px] text-center text-xs font-bold transition-transform active:scale-95 ${
                  isDark
                    ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white"
                    : "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white"
                }`}
              >
                <div
                  className={`flex items-center justify-center gap-1.5 rounded-[11px] px-3 py-2 transition ${
                    isDark
                      ? "bg-[#0b0e1d] text-white hover:bg-transparent"
                      : "bg-white text-blue-700 hover:bg-transparent hover:text-white"
                  }`}
                >
                  <span>Start conversation</span>
                  <IconArrowRight className="h-3 w-3" />
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
