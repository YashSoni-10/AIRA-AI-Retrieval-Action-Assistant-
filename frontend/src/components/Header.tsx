import { useState, useEffect } from "react";
import { useTheme } from "../context/ThemeContext";
import { getUser, type AuthUser } from "../services/auth";

function Header() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
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

  const name = user?.name || "User";
  const avatarLetter = name.charAt(0).toUpperCase();

  return (
    <header
      className={`flex items-center justify-end border-b px-4 py-3 backdrop-blur-2xl transition-colors duration-300 md:px-8 md:py-4 ${
        isDark
          ? "border-white/10 bg-[#0a0c16]/90 text-white shadow-xl"
          : "border-slate-200 bg-white text-slate-900 shadow-sm"
      }`}
    >
      {/* Right Section — user profile only; search bar and notifications removed per design update */}
      <div className="flex items-center gap-2 md:gap-3">

        {/* Avatar */}
        {user?.avatar && !imgError ? (
          <img
            src={user.avatar}
            alt={name}
            onError={() => setImgError(true)}
            className={`h-9 w-9 shrink-0 rounded-full object-cover border shadow-sm ${
              isDark
                ? "border-cyan-400/40 shadow-[0_0_12px_rgba(6,182,212,0.25)]"
                : "border-blue-300"
            }`}
          />
        ) : (
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold shadow-sm ${
              isDark
                ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.25)]"
                : "border-blue-300 bg-blue-100 text-blue-700"
            }`}
          >
            {avatarLetter}
          </div>
        )}

        {/* User Details */}
        <div className="hidden sm:block">
          <div className="flex items-center gap-2">
            <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
              {name}
            </p>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                user?.role === "admin"
                  ? isDark
                    ? "border border-purple-500/40 bg-purple-500/15 text-purple-300"
                    : "border border-purple-300 bg-purple-100 text-purple-800"
                  : user?.role === "viewer"
                  ? isDark
                    ? "border border-amber-500/40 bg-amber-500/15 text-amber-300"
                    : "border border-amber-300 bg-amber-100 text-amber-800"
                  : isDark
                  ? "border border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
                  : "border border-cyan-300 bg-cyan-100 text-cyan-800"
              }`}
            >
              {user?.role || "member"}
            </span>
          </div>

          <p className={`text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
            {user?.email || "Authenticated"}
          </p>
        </div>

      </div>
    </header>
  );
}

export default Header;
