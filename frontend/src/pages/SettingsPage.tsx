import { useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { IconLogOut, IconEdit, IconAlertTriangle, IconLock } from "../components/icons";
import {
  getMe, updateProfile, changePassword, logout, type AuthUser, uploadAvatar,
  getDefaultWorkspace, updateWorkspaceSettings, type Workspace,
} from "../services/auth";




function SettingsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [user, setUser] = useState<AuthUser | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // 6D — avatar
  const [uploading, setUploading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAvatarLoadError(false);
  }, [user?.avatar]);

  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [changingPass, setChangingPass] = useState(false);
  const [passMsg, setPassMsg] = useState<string | null>(null);

  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  const [aiConnected, setAiConnected] = useState<boolean | null>(null);

  // Workspace settings state (admin only)
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [wsName, setWsName] = useState("");
  const [wsDesc, setWsDesc] = useState("");
  const [wsMaxMb, setWsMaxMb] = useState(10);
  const [wsFileTypes, setWsFileTypes] = useState<string[]>([".pdf", ".txt", ".md", ".rst"]);
  const [savingWs, setSavingWs] = useState(false);
  const [wsMsg, setWsMsg] = useState<string | null>(null);
  const ALL_FILE_TYPES = [".pdf", ".txt", ".md", ".rst"];

  useEffect(() => {
    // Check Node backend + load user
    (async () => {
      try {
        const res = await getMe();
        setUser(res.user);
        setName(res.user.name);
        setBackendConnected(true);
        // Load workspace settings for admin users
        if (res.user.role === "admin") {
          try {
            const wsRes = await getDefaultWorkspace();
            if (wsRes.success && wsRes.workspace) {
              const ws = wsRes.workspace;
              setWorkspace(ws);
              setWsName(ws.name);
              setWsDesc(ws.description || "");
              setWsMaxMb(ws.settings?.max_file_size_mb ?? 10);
              setWsFileTypes(ws.settings?.allowed_file_types ?? [".pdf", ".txt", ".md", ".rst"]);
            }
          } catch {
            // non-blocking — workspace settings gracefully absent
          }
        }
      } catch {
        setBackendConnected(false);
      }
    })();

    // Check AI service — 2 s timeout so the UI isn't held up
    (async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2000);
        const res = await fetch("http://127.0.0.1:8000/api/v1/health", { signal: ctrl.signal });
        clearTimeout(timer);
        setAiConnected(res.ok);
      } catch {
        setAiConnected(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!name.trim()) {
      setSaveMsg("Name cannot be empty.");
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await updateProfile(name.trim());
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

  const handleSaveWorkspace = async () => {
    if (!workspace) return;
    setSavingWs(true);
    setWsMsg(null);
    try {
      const res = await updateWorkspaceSettings(workspace._id, {
        name: wsName.trim() || undefined,
        description: wsDesc,
        settings: { max_file_size_mb: wsMaxMb, allowed_file_types: wsFileTypes },
      });
      if (res.success) {
        setWorkspace(res.workspace);
        setWsMsg("Workspace settings saved.");
      }
    } catch (err) {
      setWsMsg(err instanceof Error ? err.message : "Failed to save workspace settings.");
    } finally {
      setSavingWs(false);
    }
  };


  const inputClass = `w-full rounded-xl border px-4 py-3 text-sm outline-none transition ${
    isDark
      ? "border-white/10 bg-white/[0.06] text-white placeholder:text-zinc-600 focus:border-cyan-400/60"
      : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
  }`;

  const labelClass = `block mb-1.5 text-xs font-semibold ${isDark ? "text-zinc-400" : "text-slate-700"}`;
  const sectionClass = `rounded-2xl border p-6 backdrop-blur-2xl ${isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white shadow-sm"}`;

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
            <IconLogOut className="inline mr-1.5 h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      <main className={`flex-1 px-8 py-8 ${isDark ? "bg-[#060812]" : "bg-slate-50"}`}>
        <div className="mx-auto max-w-2xl space-y-6">

          {/* Backend status banner */}
          {backendConnected === false && (
            <div className={`rounded-2xl border px-5 py-4 text-sm ${isDark ? "border-amber-400/20 bg-amber-500/10 text-amber-300" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
              <IconAlertTriangle className="inline mr-2 h-4 w-4 text-amber-500" /> Auth backend not connected. Start the Node.js server (<code className="font-mono">cd backend && npm run dev</code>) and make sure MongoDB is running. Profile changes will not persist.
            </div>
          )}

          {/* Profile */}
          <div className={sectionClass}>
            <h3 className={`mb-4 text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Profile</h3>
            <div className="space-y-4">
              {user && (
                <div className={`flex items-center gap-4 rounded-xl border p-4 ${isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-100 bg-slate-50"}`}>
                  {/* Clickable avatar — opens file picker */}
                  <div className="relative flex-shrink-0">
                    <button
                      id="settings-avatar-btn"
                      type="button"
                      title="Click to change avatar"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                      className={`group relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl text-xl font-bold transition ${
                        isDark ? "bg-cyan-500/20 text-cyan-300" : "bg-blue-600 text-white"
                      } ${uploading ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:opacity-80"}`}
                    >
                      {user.avatar && !avatarLoadError ? (
                        <img src={user.avatar} alt="avatar" onError={() => setAvatarLoadError(true)} className="h-full w-full object-cover" />
                      ) : (
                        user.name.charAt(0).toUpperCase()
                      )}
                      {/* Hover overlay */}
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white opacity-0 group-hover:opacity-100 transition">
                        {uploading ? "…" : <IconEdit className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploading(true);
                        setAvatarMsg(null);
                        try {
                          const result = await uploadAvatar(file);
                          const updated = result.user ?? (user ? { ...user, avatar: result.avatar } : null);
                          if (updated) setUser(updated);
                          setAvatarMsg("Avatar updated ✓");
                        } catch (err) {
                          setAvatarMsg(err instanceof Error ? err.message : "Upload failed");
                        } finally {
                          setUploading(false);
                          e.target.value = "";
                        }
                      }}
                    />
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>{user.name}</p>
                    <p className={`text-xs ${isDark ? "text-zinc-500" : "text-slate-600"}`}>{user.email}</p>
                  </div>
                  <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${isDark ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300" : "border-blue-200 bg-blue-50 text-blue-600"}`}>
                    {user.role}
                  </span>
                </div>
              )}

              {/* Avatar feedback */}
              {avatarMsg && (
                <p className={`-mt-1 text-xs font-medium ${
                  avatarMsg.includes("✓") ? (isDark ? "text-emerald-400" : "text-emerald-600") : (isDark ? "text-rose-400" : "text-rose-600")
                }`}>{avatarMsg}</p>
              )}
              {!avatarMsg && user && (
                <p className={`-mt-1 text-xs ${isDark ? "text-zinc-600" : "text-slate-500"}`}>Click your avatar to upload a new photo (JPEG · PNG · WebP, max 2 MB)</p>
              )}
              <div>
                <label className={labelClass}>Full Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Role</label>
                <div
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition ${
                    isDark ? "border-white/10 bg-white/[0.04]" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-extrabold uppercase tracking-wider ${
                        user?.role === "admin"
                          ? isDark
                            ? "border border-purple-500/40 bg-purple-500/20 text-purple-300"
                            : "border border-purple-300 bg-purple-50 text-purple-700"
                          : user?.role === "viewer"
                          ? isDark
                            ? "border border-amber-500/40 bg-amber-500/20 text-amber-300"
                            : "border border-amber-300 bg-amber-50 text-amber-700"
                          : isDark
                          ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                          : "border border-cyan-300 bg-cyan-50 text-cyan-700"
                      }`}
                    >
                      {user?.role || "member"}
                    </span>
                    <span className={`text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                      {user?.role === "admin"
                        ? "Workspace Administrator"
                        : user?.role === "viewer"
                        ? "Read-Only Observer"
                        : "Standard Workspace Member"}
                    </span>
                  </div>
                  <span className={`text-[11px] font-medium ${isDark ? "text-zinc-500" : "text-slate-600"}`}>
                    <span className="inline-flex items-center gap-1"><IconLock className="h-3 w-3" /><span>Managed by Administrator</span></span>
                  </span>
                </div>
                <p className={`mt-1.5 text-[11px] ${isDark ? "text-zinc-500" : "text-slate-600"}`}>
                  Roles cannot be changed here. Only workspace administrators can manage user roles via User Management.
                </p>
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

          {/* Workspace Settings (Admin only) */}
          {user?.role === "admin" && workspace && (
            <div className={sectionClass}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className={`text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                  Workspace Settings
                </h3>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${isDark ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300" : "border-blue-200 bg-blue-50 text-blue-600"}`}>
                  Admin only
                </span>
              </div>
              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className={labelClass}>Workspace Name</label>
                  <input
                    type="text"
                    value={wsName}
                    maxLength={100}
                    onChange={(e) => setWsName(e.target.value)}
                    className={inputClass}
                    placeholder="My Workspace"
                  />
                </div>
                {/* Description */}
                <div>
                  <label className={labelClass}>Description</label>
                  <textarea
                    value={wsDesc}
                    maxLength={500}
                    rows={2}
                    onChange={(e) => setWsDesc(e.target.value)}
                    className={`${inputClass} resize-none`}
                    placeholder="Optional workspace description"
                  />
                </div>
                {/* Max file size */}
                <div>
                  <label className={labelClass}>
                    Max upload size — <span className="font-bold text-cyan-400">{wsMaxMb} MB</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={wsMaxMb}
                    onChange={(e) => setWsMaxMb(Number(e.target.value))}
                    className="w-full accent-cyan-400"
                  />
                  <div className={`mt-1 flex justify-between text-[10px] ${isDark ? "text-zinc-600" : "text-slate-500"}`}>
                    <span>1 MB</span><span>100 MB</span>
                  </div>
                </div>
                {/* Allowed file types */}
                <div>
                  <label className={labelClass}>Allowed File Types</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_FILE_TYPES.map((ext) => (
                      <label key={ext} className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={wsFileTypes.includes(ext)}
                          onChange={(e) =>
                            setWsFileTypes((prev) =>
                              e.target.checked ? [...prev, ext] : prev.filter((t) => t !== ext)
                            )
                          }
                          className="accent-cyan-400"
                        />
                        <span className={`text-xs font-mono font-semibold ${isDark ? "text-zinc-300" : "text-slate-700"}`}>
                          {ext}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                {wsMsg && (
                  <p className={`text-xs font-medium ${wsMsg.includes("saved") ? "text-emerald-400" : "text-red-400"}`}>
                    {wsMsg}
                  </p>
                )}
                <button
                  onClick={handleSaveWorkspace}
                  disabled={savingWs || !wsName.trim()}
                  className="rounded-xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {savingWs ? "Saving…" : "Save Workspace"}
                </button>
              </div>
            </div>
          )}

          {/* Service Status */}
          <div className={sectionClass}>

            <h3 className={`mb-4 text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Service Status</h3>
            <div className="space-y-2">
              {([
                {
                  label: "AI Service (FastAPI)",
                  url: "http://127.0.0.1:8000",
                  // null = still checking, true = up, false = down
                  up: aiConnected,
                },
                {
                  label: "Auth Service (Node.js)",
                  url: "http://localhost:5000",
                  up: backendConnected,
                },
                {
                  label: "Frontend (React + Vite)",
                  url: "http://localhost:5173",
                  // The page is loaded, so the frontend is always reachable
                  up: true as boolean | null,
                },
              ] as { label: string; url: string; up: boolean | null }[]).map(({ label, url, up }) => {
                const dotColor =
                  up === null
                    ? isDark ? "bg-zinc-500" : "bg-slate-300"
                    : up
                    ? "bg-emerald-400"
                    : "bg-red-400";
                const statusText =
                  up === null ? "Checking…" : up ? "Online" : "Offline";
                const statusColor =
                  up === null
                    ? isDark ? "text-zinc-500" : "text-slate-600"
                    : up
                    ? isDark ? "text-emerald-400" : "text-emerald-600"
                    : isDark ? "text-red-400" : "text-red-600";
                return (
                  <div
                    key={label}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                      isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-100 bg-slate-50"
                    }`}
                  >
                    <div>
                      <p className={`text-sm font-medium ${isDark ? "text-zinc-300" : "text-slate-700"}`}>{label}</p>
                      <p className={`text-[11px] font-mono ${isDark ? "text-zinc-600" : "text-slate-500"}`}>{url}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${statusColor}`}>{statusText}</span>
                      <span className={`h-2 w-2 rounded-full ${dotColor} ${up === null ? "" : "animate-pulse"}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

export default SettingsPage;
