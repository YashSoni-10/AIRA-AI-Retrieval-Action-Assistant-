import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { getMe, updateProfile, changePassword, logout, type AuthUser } from "../services/auth";

function SettingsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("member");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [changingPass, setChangingPass] = useState(false);
  const [passMsg, setPassMsg] = useState<string | null>(null);

  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getMe();
        setUser(res.user);
        setName(res.user.name);
        setRole(res.user.role);
        setBackendConnected(true);
      } catch {
        setBackendConnected(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await updateProfile(name, role);
      setUser(res.user);
      setSaveMsg("Profile updated successfully.");
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setChangingPass(true);
    setPassMsg(null);
    try {
      await changePassword(currentPass, newPass);
      setPassMsg("Password changed successfully.");
      setCurrentPass("");
      setNewPass("");
    } catch (err) {
      setPassMsg(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setChangingPass(false);
    }
  };

  const handleLogout = () => {
    logout();
    window.location.reload();
  };

  const inputClass = `w-full rounded-xl border px-4 py-3 text-sm outline-none transition ${
    isDark
      ? "border-white/10 bg-white/[0.06] text-white placeholder:text-zinc-600 focus:border-cyan-400/60"
      : "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:border-blue-500"
  }`;

  const labelClass = `block mb-1.5 text-xs font-semibold ${isDark ? "text-zinc-400" : "text-slate-600"}`;
  const sectionClass = `rounded-2xl border p-6 backdrop-blur-2xl ${isDark ? "border-white/10 bg-white/[0.03]" : "border-white/80 bg-white/50 shadow-sm"}`;

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">
      <div className={`border-b px-8 py-5 backdrop-blur-xl ${isDark ? "border-white/10 bg-[#090b15]/80" : "border-slate-200/80 bg-white/80 shadow-sm"}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Settings</h2>
            <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>Manage your account and workspace</p>
          </div>
          <button
            onClick={handleLogout}
            className={`rounded-xl border px-4 py-2 text-xs font-semibold transition ${
              isDark ? "border-red-400/20 text-red-400 hover:bg-red-500/10" : "border-red-200 text-red-600 hover:bg-red-50"
            }`}
          >
            Sign Out
          </button>
        </div>
      </div>

      <main className={`flex-1 px-8 py-8 ${isDark ? "bg-[#060812]" : "bg-slate-50"}`}>
        <div className="mx-auto max-w-2xl space-y-6">

          {/* Backend status banner */}
          {backendConnected === false && (
            <div className={`rounded-2xl border px-5 py-4 text-sm ${isDark ? "border-amber-400/20 bg-amber-500/10 text-amber-300" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
              ⚠️ Auth backend not connected. Start the Node.js server (<code className="font-mono">cd backend && npm run dev</code>) and make sure MongoDB is running. Profile changes will not persist.
            </div>
          )}

          {/* Profile */}
          <div className={sectionClass}>
            <h3 className={`mb-4 text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Profile</h3>
            <div className="space-y-4">
              {user && (
                <div className={`flex items-center gap-3 rounded-xl border p-3 ${isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-100 bg-slate-50"}`}>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold ${isDark ? "bg-cyan-500/20 text-cyan-300" : "bg-blue-600 text-white"}`}>
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>{user.name}</p>
                    <p className={`text-xs ${isDark ? "text-zinc-500" : "text-slate-400"}`}>{user.email}</p>
                  </div>
                  <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${isDark ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300" : "border-blue-200 bg-blue-50 text-blue-600"}`}>
                    {user.role}
                  </span>
                </div>
              )}
              <div>
                <label className={labelClass}>Full Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              {saveMsg && (
                <p className={`text-xs font-medium ${saveMsg.includes("success") ? isDark ? "text-emerald-400" : "text-emerald-600" : isDark ? "text-red-400" : "text-red-600"}`}>
                  {saveMsg}
                </p>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !backendConnected}
                className="rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>

          {/* Change Password */}
          <div className={sectionClass}>
            <h3 className={`mb-4 text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Change Password</h3>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Current Password</label>
                <input type="password" value={currentPass} onChange={(e) => setCurrentPass(e.target.value)} placeholder="••••••••" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>New Password</label>
                <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Min. 6 characters" className={inputClass} />
              </div>
              {passMsg && (
                <p className={`text-xs font-medium ${passMsg.includes("success") ? isDark ? "text-emerald-400" : "text-emerald-600" : isDark ? "text-red-400" : "text-red-600"}`}>
                  {passMsg}
                </p>
              )}
              <button
                onClick={handleChangePassword}
                disabled={changingPass || !currentPass || !newPass || !backendConnected}
                className="rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {changingPass ? "Changing..." : "Change Password"}
              </button>
            </div>
          </div>

          {/* Workspace Info */}
          <div className={sectionClass}>
            <h3 className={`mb-4 text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Service Status</h3>
            <div className="space-y-2">
              {[
                { label: "AI Service (FastAPI)", url: "http://localhost:8000", color: "emerald" },
                { label: "Auth Service (Node.js)", url: "http://localhost:5000", color: backendConnected ? "emerald" : "red" },
                { label: "Frontend (React + Vite)", url: "http://localhost:5173", color: "emerald" },
              ].map(({ label, url, color }) => (
                <div key={label} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-100 bg-slate-50"}`}>
                  <p className={`text-sm ${isDark ? "text-zinc-300" : "text-slate-700"}`}>{label}</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono ${isDark ? "text-zinc-500" : "text-slate-400"}`}>{url}</span>
                    <span className={`h-2 w-2 rounded-full ${color === "emerald" ? "bg-emerald-400" : "bg-red-400"} animate-pulse`} />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

export default SettingsPage;
