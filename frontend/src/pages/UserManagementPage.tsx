import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { IconBan, IconX, IconCheckCircle2, IconAlertTriangle, IconRefreshCw } from "../components/icons";
import { getUser, listUsers, updateUserRole, toggleUserStatus } from "../services/auth";

interface ManagedUser {
  id?: string;
  _id?: string;
  name: string;
  email: string;
  role: "admin" | "member" | "viewer";
  avatar?: string;
  isActive?: boolean;
  createdAt?: string;
  workspace?: { _id?: string; name: string };
}

function UserAvatar({ user, className = "h-9 w-9 rounded-xl" }: { user: ManagedUser; className?: string }) {
  const [imgError, setImgError] = useState(false);
  const letter = user.name ? user.name.charAt(0).toUpperCase() : "U";

  if (user.avatar && !imgError) {
    return (
      <img
        src={user.avatar}
        alt={user.name || "User"}
        onError={() => setImgError(true)}
        className={`${className} shrink-0 object-cover border border-cyan-400/30 shadow-md`}
      />
    );
  }

  return (
    <div className={`flex ${className} shrink-0 items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold text-white shadow-md`}>
      {letter}
    </div>
  );
}

export default function UserManagementPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const currentUser = getUser();
  const isAdmin = currentUser?.role === "admin";

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    targetUser: ManagedUser;
    nextState: boolean;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  async function loadUsers() {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listUsers();
      if (res.success && Array.isArray(res.users)) {
        setUsers(res.users);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, [isAdmin]);

  async function handleRoleChange(targetUserId: string, newRole: "admin" | "member" | "viewer") {
    const isSelf = (currentUser?.id || currentUser?._id) === targetUserId;

    // Prevent accidental self-demotion or removing the last active admin
    if (isSelf && newRole !== "admin") {
      const activeAdminCount = users.filter((u) => u.role === "admin").length;
      if (activeAdminCount <= 1) {
        setError("Cannot remove your admin role: you are the only active administrator in the workspace. Assign another administrator first.");
        return;
      }
      const confirmed = window.confirm(
        "Warning: You are about to remove your own administrator privileges. You will lose access to the User Management panel immediately. Do you wish to proceed?"
      );
      if (!confirmed) {
        return;
      }
    }

    setUpdatingId(targetUserId);
    setError(null);
    setSuccess(null);
    try {
      const res = await updateUserRole(targetUserId, newRole);
      if (res.success) {
        setSuccess(`User role updated to "${newRole}" successfully.`);
        if (isSelf) {
          const updatedUser = { ...currentUser, role: newRole };
          localStorage.setItem("aira_user", JSON.stringify(updatedUser));
        }
        setUsers((prev) =>
          prev.map((u) => {
            const uid = u.id || u._id;
            return uid === targetUserId ? { ...u, role: newRole } : u;
          })
        );
      }
    } catch (err: any) {
      setError(err.message || "Failed to update user role");
      // Reload from server to reset select dropdown to persisted truth
      loadUsers();
    } finally {
      setUpdatingId(null);
    }
  }

  // Escape key closes modal if not loading
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && confirmModal && !confirmLoading) {
        setConfirmModal(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmModal, confirmLoading]);

  function requestStatusToggle(user: ManagedUser) {
    const currentIsActive = user.isActive !== false;
    setConfirmModal({
      targetUser: user,
      nextState: !currentIsActive,
    });
  }

  async function handleConfirmStatusToggle() {
    if (!confirmModal || confirmLoading) return;
    const { targetUser, nextState } = confirmModal;
    const targetUserId = targetUser.id || targetUser._id;
    if (!targetUserId) return;

    const label = nextState ? "activate" : "deactivate";
    setConfirmLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await toggleUserStatus(targetUserId, nextState);
      if (res.success) {
        setSuccess(`Account ${nextState ? "activated" : "deactivated"} successfully.`);
        setUsers((prev) =>
          prev.map((u) => {
            const uid = u.id || u._id;
            return uid === targetUserId ? { ...u, isActive: nextState } : u;
          })
        );
        setConfirmModal(null);
      } else {
        setError((res as any).message || `Failed to ${label} account.`);
        setConfirmModal(null);
      }
    } catch (err: any) {
      setError(err.message || `Failed to ${label} user`);
      setConfirmModal(null);
    } finally {
      setConfirmLoading(false);
    }
  }

  // Non-admin guard
  if (!isAdmin) {
    return (
      <div
        className={`flex min-h-full flex-1 flex-col items-center justify-center p-6 ${
          theme === "dark" ? "bg-[#060812] text-zinc-100" : "bg-slate-50 text-slate-900"
        }`}
      >
        <div
          className={`max-w-md rounded-3xl border p-8 text-center shadow-2xl ${
            theme === "dark" ? "border-red-500/20 bg-red-500/10 text-white" : "border-red-200 bg-red-50 text-slate-900"
          }`}
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-500"><IconBan className="h-8 w-8" /></div>
          <h2 className="mt-4 text-xl font-bold text-red-400">403 Forbidden: Access Denied</h2>
          <p className="mt-2 text-sm text-zinc-400">
            You do not have administrative privileges to access the User Management panel. Only workspace administrators can manage users and configure roles.
          </p>
          <button
            onClick={() => navigate("/dashboard")}
            className="mt-6 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition active:scale-95"
          >
            ← Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-full flex-1 px-5 py-6 transition-colors duration-300 sm:px-8 md:px-10 md:py-8 ${
        theme === "dark" ? "bg-[#060812] text-zinc-100" : "bg-slate-50 text-slate-900"
      }`}
    >
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
              User Management
            </h1>
            <p className={`mt-1 text-sm ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
              Assign roles and permissions across your workspace users.
            </p>
          </div>

          <button
            onClick={loadUsers}
            disabled={loading}
            className={`self-start inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-semibold transition active:scale-95 sm:self-auto ${theme === "dark" ? "border-white/10 text-zinc-300 hover:bg-white/5" : "border-slate-300 text-slate-700 bg-white hover:bg-slate-100 shadow-sm"}`}
          >
            <IconRefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span>{loading ? "Refreshing..." : "Refresh Users"}</span>
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className={`flex items-center justify-between rounded-2xl border p-4 text-sm ${theme === "dark" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-red-200 bg-red-50 text-red-800"}`}>
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Close error" className="text-inherit hover:opacity-75"><IconX className="h-4 w-4" /></button>
          </div>
        )}

        {success && (
          <div className={`flex items-center justify-between rounded-2xl border p-4 text-sm ${theme === "dark" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            <span>{success}</span>
            <button onClick={() => setSuccess(null)} aria-label="Close success" className="text-inherit hover:opacity-75"><IconX className="h-4 w-4" /></button>
          </div>
        )}

        {/* Users Table Card */}
        <div
          className={`overflow-hidden rounded-3xl border shadow-xl backdrop-blur-2xl transition ${
            theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white"
          }`}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent" />
              <p className={`mt-4 text-sm font-semibold ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>Loading workspace users...</p>
            </div>
          ) : users.length === 0 ? (
            <div className={`py-16 text-center text-sm ${theme === "dark" ? "text-zinc-500" : "text-slate-500"}`}>
              No users registered in the workspace yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead
                  className={`border-b text-xs font-bold uppercase tracking-wider ${
                    theme === "dark"
                      ? "border-white/10 bg-white/[0.04] text-zinc-400"
                      : "border-slate-200 bg-slate-100/75 text-slate-600"
                  }`}
                >
                  <tr>
                    <th className="px-6 py-4">User</th>
                    <th className="px-6 py-4">Email</th>
                    <th className="px-6 py-4">Workspace</th>
                    <th className="px-6 py-4">Current Role</th>
                    <th className="px-6 py-4">Change Role</th>
                    <th className="px-6 py-4 text-right">Status</th>
                  </tr>
                </thead>

                <tbody className={`divide-y ${theme === "dark" ? "divide-white/5" : "divide-slate-200"}`}>

                  {users.map((u) => {
                    const uid = u.id || u._id || "";
                    const isSelf = (currentUser?.id || currentUser?._id) === uid;
                    
                    return (
                      <tr
                        key={uid}
                        className={`transition ${theme === "dark" ? "hover:bg-white/[0.02]" : "hover:bg-slate-50"} ${  // ignored
                          theme === "dark" ? "" : ""} ${
                          theme === "dark" ? "text-zinc-200" : "text-slate-800"
                        }`}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <UserAvatar user={u} />
                            <div>
                              <p className="font-semibold">{u.name}</p>
                              {isSelf && (
                                <span className="text-[10px] font-bold text-cyan-400">
                                  (Current You)
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className={`px-6 py-4 font-mono text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
                          {u.email}
                        </td>

                        <td className={`px-6 py-4 text-xs font-medium ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
                          {u.workspace?.name || "Default Workspace"}
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                              u.role === "admin"
                                ? (theme === "dark" ? "border border-purple-500/40 bg-purple-500/15 text-purple-300" : "border border-purple-300 bg-purple-100 text-purple-800")
                                : u.role === "viewer"
                                ? (theme === "dark" ? "border border-amber-500/40 bg-amber-500/15 text-amber-300" : "border border-amber-300 bg-amber-100 text-amber-800")
                                : (theme === "dark" ? "border border-cyan-500/40 bg-cyan-500/15 text-cyan-300" : "border border-cyan-300 bg-cyan-100 text-cyan-800")
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          {(() => {
                            const isLastAdmin = u.role === "admin" && users.filter((x) => x.role === "admin").length <= 1;
                            const isSoleAdminSelf = isSelf && isLastAdmin;
                            return (
                              <select
                                value={u.role}
                                disabled={updatingId === uid || isSoleAdminSelf}
                                title={isSoleAdminSelf ? "Cannot demote the sole active administrator in this workspace" : undefined}
                                onChange={(e) =>
                                  handleRoleChange(uid, e.target.value as "admin" | "member" | "viewer")
                                }
                                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold outline-none transition ${
                                  isSoleAdminSelf ? "cursor-not-allowed opacity-60" : ""
                                } ${
                                  theme === "dark"
                                    ? "border-white/15 bg-white/5 text-white focus:border-cyan-400"
                                    : "border-slate-300 bg-slate-50 text-slate-800 focus:border-blue-500"
                                }`}
                              >
                                <option value="member" className="text-black">Member</option>
                                <option value="admin" className="text-black">Admin</option>
                                <option value="viewer" className="text-black">Viewer</option>
                              </select>
                            );
                          })()}
                        </td>

                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Status badge */}
                            {u.isActive !== false ? (
                              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${theme === "dark" ? "text-emerald-400" : "text-emerald-700 font-semibold"}`} aria-label="Active status">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Active
                              </span>
                            ) : (
                              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${theme === "dark" ? "text-amber-400" : "text-amber-800 font-semibold"}`} aria-label="Inactive status">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                Inactive
                              </span>
                            )}
                            {/* Toggle button — hidden for self */}
                            {!isSelf && (
                              <button
                                disabled={confirmLoading}
                                onClick={() => requestStatusToggle(u)}
                                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                                  u.isActive !== false
                                    ? theme === "dark"
                                      ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                                      : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                                    : theme === "dark"
                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                    : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                } disabled:opacity-50`}
                              >
                                {u.isActive !== false ? "Deactivate" : "Activate"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Role Permissions Reference Card */}
        <div
          className={`rounded-3xl border p-6 transition ${
            theme === "dark" ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-slate-50"
          }`}
        >
          <h2 className={`text-sm font-bold uppercase tracking-wider ${theme === "dark" ? "text-zinc-400" : "text-slate-700"}`}>
            Role Permission Matrix Overview
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className={`rounded-2xl border p-4 ${theme === "dark" ? "border-purple-500/20 bg-purple-500/5" : "border-purple-200 bg-purple-50"}`}>
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase ${theme === "dark" ? "border-purple-500/40 bg-purple-500/20 text-purple-300" : "border-purple-300 bg-purple-100 text-purple-800"}`}>
                Admin
              </span>
              <p className={`mt-2 text-xs font-semibold ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>Full Workspace Authority</p>
              <ul className={`mt-2 space-y-1 text-[11px] ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
                <li>• Manage users & assign roles</li>
                <li>• Configure workspace settings</li>
                <li>• Full task & agent management</li>
                <li>• GitHub & document operations</li>
              </ul>
            </div>

            <div className={`rounded-2xl border p-4 ${theme === "dark" ? "border-cyan-500/20 bg-cyan-500/5" : "border-cyan-200 bg-cyan-50"}`}>
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase ${theme === "dark" ? "border-cyan-500/40 bg-cyan-500/20 text-cyan-300" : "border-cyan-300 bg-cyan-100 text-cyan-800"}`}>
                Member
              </span>
              <p className={`mt-2 text-xs font-semibold ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>Standard Collaborator</p>
              <ul className={`mt-2 space-y-1 text-[11px] ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
                <li>• Create tasks & manage own tasks</li>
                <li>• Execute all AI agents</li>
                <li>• Upload/delete own documents</li>
                <li>• Cannot manage users or roles</li>
              </ul>
            </div>

            <div className={`rounded-2xl border p-4 ${theme === "dark" ? "border-amber-500/20 bg-amber-500/5" : "border-amber-200 bg-amber-50"}`}>
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase ${theme === "dark" ? "border-amber-500/40 bg-amber-500/20 text-amber-300" : "border-amber-300 bg-amber-100 text-amber-800"}`}>
                Viewer
              </span>
              <p className={`mt-2 text-xs font-semibold ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>Read-Only Observer</p>
              <ul className={`mt-2 space-y-1 text-[11px] ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
                <li>• View tasks, docs, and metrics</li>
                <li>• Query AI knowledge search</li>
                <li>• Cannot create/edit/delete tasks</li>
                <li>• Blocked from mutation endpoints</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Activate / Deactivate */}
      {confirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !confirmLoading) {
              setConfirmModal(null);
            }
          }}
        >
          <div
            className={`w-full max-w-md overflow-hidden rounded-3xl border p-6 shadow-2xl transition ${
              theme === "dark"
                ? "border-white/15 bg-[#0f1222] text-white"
                : "border-slate-200 bg-white text-slate-900"
            }`}
          >
            {/* Header Icon & Title */}
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl shadow-lg ${
                  confirmModal.nextState
                    ? "border border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                    : "border border-amber-500/30 bg-amber-500/20 text-amber-400"
                }`}
              >
                {confirmModal.nextState ? <IconCheckCircle2 className="h-6 w-6 text-emerald-400" /> : <IconAlertTriangle className="h-6 w-6 text-amber-400" />}
              </div>
              <div>
                <h3 id="confirm-modal-title" className="text-base font-bold leading-tight">
                  {confirmModal.nextState ? "Activate User Account" : "Deactivate User Account"}
                </h3>
                <p className={`text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
                  Confirmation required for account status change
                </p>
              </div>
            </div>

            {/* Prompt text strictly matching requirements */}
            <p className={`mt-4 text-sm font-medium ${theme === "dark" ? "text-zinc-200" : "text-slate-700"}`}>
              {confirmModal.nextState
                ? "Are you sure you want to activate this user's account?"
                : "Are you sure you want to deactivate this user's account?"}
            </p>

            {/* Target user details card */}
            <div
              className={`mt-3 rounded-2xl border p-3.5 ${
                theme === "dark"
                  ? "border-white/10 bg-white/[0.03]"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="flex items-center gap-3">
                <UserAvatar user={confirmModal.targetUser} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{confirmModal.targetUser.name}</p>
                  <p className={`truncate font-mono text-[11px] ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>{confirmModal.targetUser.email}</p>
                </div>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider ${
                    confirmModal.targetUser.role === "admin"
                      ? (theme === "dark" ? "border border-purple-500/40 bg-purple-500/15 text-purple-300" : "border border-purple-300 bg-purple-100 text-purple-800")
                      : confirmModal.targetUser.role === "viewer"
                      ? (theme === "dark" ? "border border-amber-500/40 bg-amber-500/15 text-amber-300" : "border border-amber-300 bg-amber-100 text-amber-800")
                      : (theme === "dark" ? "border border-cyan-500/40 bg-cyan-500/15 text-cyan-300" : "border border-cyan-300 bg-cyan-100 text-cyan-800")
                  }`}
                >
                  {confirmModal.targetUser.role}
                </span>
              </div>
            </div>

            {/* Operational note */}
            <p className={`mt-3 text-xs leading-relaxed ${theme === "dark" ? "text-zinc-400" : "text-slate-500"}`}>
              {confirmModal.nextState
                ? "The user will be able to log in and access the workspace again."
                : "The user will immediately be blocked from logging in until reactivated."}
            </p>

            {/* Buttons */}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={confirmLoading}
                onClick={() => setConfirmModal(null)}
                className={`rounded-xl border px-4 py-2 text-xs font-semibold transition ${
                  theme === "dark"
                    ? "border-white/10 text-zinc-300 hover:bg-white/5"
                    : "border-slate-300 text-slate-700 hover:bg-slate-100"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmLoading}
                onClick={handleConfirmStatusToggle}
                className={`rounded-xl px-4 py-2 text-xs font-bold text-white shadow-lg transition active:scale-95 disabled:cursor-wait disabled:opacity-60 ${
                  confirmModal.nextState
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 shadow-emerald-500/20 hover:from-emerald-600 hover:to-teal-700"
                    : "bg-gradient-to-r from-amber-500 to-rose-600 shadow-amber-500/20 hover:from-amber-600 hover:to-rose-700"
                }`}
              >
                {confirmLoading
                  ? "Processing..."
                  : confirmModal.nextState
                  ? "Confirm Activation"
                  : "Confirm Deactivation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
