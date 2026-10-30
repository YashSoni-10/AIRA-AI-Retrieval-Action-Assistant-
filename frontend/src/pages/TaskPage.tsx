import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import {
  IconRefreshCw,
  IconSearch,
  IconCheckCircle2,
  IconCheck,
  IconZap,
  IconUser,
  IconX,
} from "../components/icons";
import {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  getWorkspaceMembers,
  type TaskItem,
  type WorkspaceMember,
} from "../services/api";
import { getUser } from "../services/auth";

export default function TaskPage() {
  const { theme } = useTheme();
  const currentUser = getUser();
  const role = currentUser?.role || "member";
  const isViewer = role === "viewer";
  const isDark = theme === "dark";

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<string>("");
  const [filterMine, setFilterMine] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Members for assignee dropdown
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createPriority, setCreatePriority] = useState<"low" | "medium" | "high">("medium");
  const [createDueDate, setCreateDueDate] = useState("");
  const [createAssignee, setCreateAssignee] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit Modal
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editStatus, setEditStatus] = useState<TaskItem["status"]>("todo");
  const [editPriority, setEditPriority] = useState<"low" | "medium" | "high">("medium");
  const [editDueDate, setEditDueDate] = useState("");
  const [editAssignee, setEditAssignee] = useState("");
  const [updating, setUpdating] = useState(false);

  // Action status
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTasks({
        status: filterStatus || undefined,
        priority: filterPriority || undefined,
        mine: filterMine || undefined,
        q: debouncedSearch || undefined,
      });
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterPriority, filterMine, debouncedSearch]);

  // Debounce search input — wait 300 ms after the user stops typing
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Fetch workspace members once on mount for the assignee dropdown
  useEffect(() => {
    getWorkspaceMembers()
      .then((r) => setMembers(r.members ?? []))
      .catch(() => {}); // non-blocking — assignee dropdown just stays empty
  }, []);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createTitle.trim()) return;
    setCreating(true);
    try {
      await createTask({
        title: createTitle.trim(),
        description: createDesc.trim() || undefined,
        priority: createPriority,
        due_date: createDueDate ? new Date(createDueDate).toISOString() : null,
        assigned_to: createAssignee || null,
      });
      setShowCreateModal(false);
      setCreateTitle("");
      setCreateDesc("");
      setCreatePriority("medium");
      setCreateDueDate("");
      setCreateAssignee("");
      await fetchTasks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error creating task");
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (t: TaskItem) => {
    setEditingTask(t);
    setEditTitle(t.title);
    setEditDesc(t.description || "");
    setEditStatus(t.status);
    setEditPriority(t.priority);
    setEditDueDate(t.due_date ? t.due_date.substring(0, 10) : "");
    const assignedId = typeof t.assigned_to === "object" && t.assigned_to !== null
      ? t.assigned_to._id
      : (t.assigned_to as string | null) ?? "";
    setEditAssignee(assignedId || "");
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask || !editTitle.trim()) return;
    setUpdating(true);
    try {
      await updateTask(editingTask._id, {
        title: editTitle.trim(),
        description: editDesc.trim(),
        status: editStatus,
        priority: editPriority,
        due_date: editDueDate ? new Date(editDueDate).toISOString() : null,
        assigned_to: editAssignee || null,
      });
      setEditingTask(null);
      await fetchTasks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error updating task");
    } finally {
      setUpdating(false);
    }
  };

  const handleQuickStatusChange = async (task: TaskItem, newStatus: TaskItem["status"]) => {
    if (isViewer) return;
    setActionLoadingId(task._id);
    try {
      await updateTask(task._id, { status: newStatus });
      await fetchTasks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (isViewer) return;
    if (!window.confirm("Are you sure you want to delete this task?")) return;
    setActionLoadingId(id);
    try {
      await deleteTask(id);
      await fetchTasks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete task");
    } finally {
      setActionLoadingId(null);
    }
  };

  // Stats
  const totalCount = tasks.length;
  const todoCount = tasks.filter((t) => t.status === "todo").length;
  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
  const completedCount = tasks.filter((t) => t.status === "completed").length;

  const priorityColor = (p: string) => {
    switch (p) {
      case "high":
        return isDark
          ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
          : "bg-rose-50 text-rose-800 border-rose-200";
      case "medium":
        return isDark
          ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
          : "bg-amber-50 text-amber-900 border-amber-300";
      default:
        return isDark
          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
          : "bg-emerald-50 text-emerald-800 border-emerald-200";
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "completed":
        return isDark
          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
          : "bg-emerald-50 text-emerald-800 border-emerald-200";
      case "in_progress":
        return isDark
          ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
          : "bg-sky-50 text-sky-800 border-sky-200";
      case "cancelled":
        return isDark
          ? "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
          : "bg-slate-100 text-slate-700 border-slate-300";
      default:
        return isDark
          ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
          : "bg-purple-50 text-purple-800 border-purple-200";
    }
  };

  return (
    <div className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Tasks & Action Items</h1>
            {isViewer && (
              <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${isDark ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "bg-amber-50 text-amber-900 border-amber-300"}`}>
                Viewer (Read Only)
              </span>
            )}
          </div>
          <p className={`mt-1 text-sm ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
            Persistent workspace task tracking with agent integration & role authorization
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchTasks()}
            disabled={loading}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl border transition-all duration-200 ${
              theme === "dark"
                ? "bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 border-zinc-700"
                : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300"
            }`}
            title="Refresh tasks from server"
          >
            <IconRefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span>{loading ? "Refreshing..." : "Refresh"}</span>
          </button>

          {!isViewer && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white shadow-lg shadow-blue-500/20 transition-all duration-200"
            >
              <span className="text-lg leading-none">+</span>
              <span>New Task</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div
          className={`p-4 rounded-2xl border transition-all ${
            theme === "dark" ? "bg-zinc-900/60 border-zinc-800/80" : "bg-white border-slate-200"
          }`}
        >
          <div className={`text-xs uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Total Tasks</div>
          <div className={`mt-2 text-2xl font-bold ${isDark ? "text-white" : "text-slate-900"}`}>{totalCount}</div>
        </div>
        <div
          className={`p-4 rounded-2xl border transition-all ${
            theme === "dark" ? "bg-zinc-900/60 border-zinc-800/80" : "bg-white border-slate-200"
          }`}
        >
          <div className={`text-xs uppercase tracking-wider ${isDark ? "text-purple-400" : "text-purple-700 font-semibold"}`}>To Do</div>
          <div className={`mt-2 text-2xl font-bold ${isDark ? "text-purple-400" : "text-purple-800"}`}>{todoCount}</div>
        </div>
        <div
          className={`p-4 rounded-2xl border transition-all ${
            theme === "dark" ? "bg-zinc-900/60 border-zinc-800/80" : "bg-white border-slate-200"
          }`}
        >
          <div className={`text-xs uppercase tracking-wider ${isDark ? "text-sky-400" : "text-sky-700 font-semibold"}`}>In Progress</div>
          <div className={`mt-2 text-2xl font-bold ${isDark ? "text-sky-400" : "text-sky-800"}`}>{inProgressCount}</div>
        </div>
        <div
          className={`p-4 rounded-2xl border transition-all ${
            theme === "dark" ? "bg-zinc-900/60 border-zinc-800/80" : "bg-white border-slate-200"
          }`}
        >
          <div className={`text-xs uppercase tracking-wider ${isDark ? "text-emerald-400" : "text-emerald-700 font-semibold"}`}>Completed</div>
          <div className={`mt-2 text-2xl font-bold ${isDark ? "text-emerald-400" : "text-emerald-800"}`}>{completedCount}</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        className={`p-4 rounded-2xl border mb-6 flex flex-wrap items-center gap-4 ${
          theme === "dark" ? "bg-zinc-900/40 border-zinc-800/60" : "bg-white border-slate-200"
        }`}
      >
        <div className="flex items-center gap-2">
          <label className={`text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"}`}>Status:</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={`text-xs rounded-lg px-2.5 py-1.5 border outline-none ${
              theme === "dark"
                ? "bg-zinc-800 border-zinc-700 text-zinc-200"
                : "bg-slate-50 border-slate-200 text-slate-800"
            }`}
          >
            <option value="">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className={`text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"}`}>Priority:</label>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className={`text-xs rounded-lg px-2.5 py-1.5 border outline-none ${
              theme === "dark"
                ? "bg-zinc-800 border-zinc-700 text-zinc-200"
                : "bg-slate-50 border-slate-200 text-slate-800"
            }`}
          >
            <option value="">All Priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <label className={`flex items-center gap-2 cursor-pointer text-xs font-medium ${isDark ? "text-zinc-300" : "text-slate-700"}`}>
          <input
            type="checkbox"
            checked={filterMine}
            onChange={(e) => setFilterMine(e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-800 text-blue-500 focus:ring-0"
          />
          Only My Tasks
        </label>

        {/* Search bar */}
        <div className="relative ml-auto flex-1 max-w-xs">
          <IconSearch className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 ${isDark ? "text-zinc-500" : "text-slate-400"}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks…"
            className={`w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border outline-none ${
              theme === "dark"
                ? "bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-500"
                : "bg-white border-slate-300 text-slate-900 placeholder:text-slate-500 focus:border-blue-500"
            }`}
          />
        </div>

        {(filterStatus || filterPriority || filterMine || debouncedSearch) && (
          <button
            onClick={() => {
              setFilterStatus("");
              setFilterPriority("");
              setFilterMine(false);
              setSearchQuery("");
              setDebouncedSearch("");
            }}
            className={`text-xs hover:underline ml-auto ${isDark ? "text-blue-400" : "text-blue-600"}`}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Task List */}
      {loading ? (
        <div className={`py-16 text-center ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent text-blue-500" />
          <p className={`mt-3 text-sm ${isDark ? "text-zinc-400" : "text-slate-500"}`}>Loading workspace tasks...</p>
        </div>
      ) : error ? (
        <div className={`p-4 rounded-xl border text-sm ${isDark ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {error}
        </div>
      ) : tasks.length === 0 ? (
        <div
          className={`py-16 text-center rounded-2xl border ${
            theme === "dark" ? "bg-zinc-900/30 border-zinc-800/60" : "bg-white border-slate-200"
          }`}
        >
          <IconCheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-base font-semibold">No tasks found</h3>
          <p className={`text-xs mt-1 max-w-sm mx-auto ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
            {filterStatus || filterPriority || filterMine
              ? "No tasks match your filter criteria."
              : "No tasks have been created in this workspace yet. Create one manually or ask the AIRA Agent!"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const creatorName =
              typeof task.created_by === "object" && task.created_by?.name
                ? task.created_by.name
                : "User";
            const isAgent = task.source === "agent";

            return (
              <div
                key={task._id}
                className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  theme === "dark"
                    ? "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
                    : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-md border ${statusColor(
                        task.status
                      )}`}
                    >
                      {task.status.replace("_", " ")}
                    </span>
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-md border ${priorityColor(
                        task.priority
                      )}`}
                    >
                      {task.priority}
                    </span>
                    {isAgent && (
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-md border ${isDark ? "bg-purple-500/15 text-purple-300 border-purple-500/30" : "bg-purple-100 text-purple-800 border-purple-300"}`}>
                        <span className="inline-flex items-center gap-1"><IconZap className="h-3 w-3 text-cyan-400" /><span>Agent Created</span></span>
                      </span>
                    )}
                    <h3
                      className={`text-base font-semibold truncate ${
                        task.status === "completed" ? `line-through ${isDark ? "text-zinc-500" : "text-slate-400"}` : ""
                      }`}
                    >
                      {task.title}
                    </h3>
                  </div>

                  {task.description && (
                    <p className={`mt-1 text-sm line-clamp-2 ${isDark ? "text-zinc-400" : "text-slate-500"}`}>{task.description}</p>
                  )}

                  <div className={`mt-2 flex items-center gap-4 text-xs flex-wrap ${isDark ? "text-zinc-500" : "text-slate-500"}`}>
                    <span>Created by: {creatorName}</span>
                    {(() => {
                      const assignee = task.assigned_to;
                      if (!assignee) return null;
                      const assigneeName = typeof assignee === "object" ? assignee.name : null;
                      return assigneeName ? (
                        <span className="inline-flex items-center gap-1">
                          <IconUser className={`h-3.5 w-3.5 ${isDark ? "text-zinc-400" : "text-slate-400"}`} />
                          <span>Assigned: {assigneeName}</span>
                        </span>
                      ) : null;
                    })()}
                    {task.due_date && (
                      <span>Due: {new Date(task.due_date).toLocaleDateString()}</span>
                    )}
                    <span>ID: {task._id.slice(-6)}</span>
                  </div>
                </div>

                {/* Actions */}
                {!isViewer && (
                  <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                    {task.status !== "completed" ? (
                      <button
                        disabled={actionLoadingId === task._id}
                        onClick={() => handleQuickStatusChange(task, "completed")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${isDark ? "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border-emerald-500/30" : "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300"}`}
                        title="Mark as completed"
                      >
                        <span className="inline-flex items-center gap-1"><IconCheck className="h-3 w-3" /><span>Complete</span></span>
                      </button>
                    ) : (
                      <button
                        disabled={actionLoadingId === task._id}
                        onClick={() => handleQuickStatusChange(task, "todo")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${isDark ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700" : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300"}`}
                        title="Reopen task"
                      >
                        ↺ Reopen
                      </button>
                    )}

                    <button
                      disabled={actionLoadingId === task._id}
                      onClick={() => openEditModal(task)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${isDark ? "bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border-blue-500/20" : "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-300"}`}
                    >
                      Edit
                    </button>

                    <button
                      disabled={actionLoadingId === task._id}
                      onClick={() => handleDelete(task._id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${isDark ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/20" : "bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-300"}`}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div
            className={`w-full max-w-lg rounded-2xl p-6 border shadow-2xl ${
              theme === "dark" ? "bg-zinc-900 border-zinc-800" : "bg-white border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Create New Task</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-400 hover:text-zinc-200 text-lg leading-none"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>
                  Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  placeholder="Task title..."
                  className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                    theme === "dark"
                      ? "bg-zinc-800/80 border-zinc-700 text-zinc-100 focus:border-blue-500"
                      : "bg-slate-50 border-slate-200 text-slate-800 focus:border-blue-500"
                  }`}
                />
              </div>

              <div>
                <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>Description</label>
                <textarea
                  rows={3}
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  placeholder="Task description (optional)..."
                  className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                    theme === "dark"
                      ? "bg-zinc-800/80 border-zinc-700 text-zinc-100 focus:border-blue-500"
                      : "bg-slate-50 border-slate-200 text-slate-800 focus:border-blue-500"
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>Priority</label>
                  <select
                    value={createPriority}
                    onChange={(e) =>
                      setCreatePriority(e.target.value as "low" | "medium" | "high")
                    }
                    className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                      theme === "dark"
                        ? "bg-zinc-800/80 border-zinc-700 text-zinc-100"
                        : "bg-slate-50 border-slate-200 text-slate-800"
                    }`}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>

                <div>
                  <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>Due Date</label>
                  <input
                    type="date"
                    value={createDueDate}
                    onChange={(e) => setCreateDueDate(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                      theme === "dark"
                        ? "bg-zinc-800/80 border-zinc-700 text-zinc-100"
                        : "bg-slate-50 border-slate-200 text-slate-800"
                    }`}
                  />
                </div>
              </div>

              {members.length > 0 && (
                <div>
                  <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>Assignee</label>
                  <select
                    value={createAssignee}
                    onChange={(e) => setCreateAssignee(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                      theme === "dark"
                        ? "bg-zinc-800/80 border-zinc-700 text-zinc-100"
                        : "bg-slate-50 border-slate-200 text-slate-800"
                    }`}
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m._id} value={m._id}>{m.name} ({m.role})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium rounded-xl text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  {creating ? "Creating..." : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div
            className={`w-full max-w-lg rounded-2xl p-6 border shadow-2xl ${
              theme === "dark" ? "bg-zinc-900 border-zinc-800" : "bg-white border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Edit Task</h2>
              <button
                onClick={() => setEditingTask(null)}
                className="text-zinc-400 hover:text-zinc-200 text-lg leading-none"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>
                  Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                    theme === "dark"
                      ? "bg-zinc-800/80 border-zinc-700 text-zinc-100"
                      : "bg-slate-50 border-slate-200 text-slate-800"
                  }`}
                />
              </div>

              <div>
                <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>Description</label>
                <textarea
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                    theme === "dark"
                      ? "bg-zinc-800/80 border-zinc-700 text-zinc-100"
                      : "bg-slate-50 border-slate-200 text-slate-800"
                  }`}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as TaskItem["status"])}
                    className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                      theme === "dark"
                        ? "bg-zinc-800/80 border-zinc-700 text-zinc-100"
                        : "bg-slate-50 border-slate-200 text-slate-800"
                    }`}
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>Priority</label>
                  <select
                    value={editPriority}
                    onChange={(e) =>
                      setEditPriority(e.target.value as "low" | "medium" | "high")
                    }
                    className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                      theme === "dark"
                        ? "bg-zinc-800/80 border-zinc-700 text-zinc-100"
                        : "bg-slate-50 border-slate-200 text-slate-800"
                    }`}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>

                <div>
                  <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>Due Date</label>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                      theme === "dark"
                        ? "bg-zinc-800/80 border-zinc-700 text-zinc-100"
                        : "bg-slate-50 border-slate-200 text-slate-800"
                    }`}
                  />
                </div>
              </div>

              {members.length > 0 && (
                <div>
                  <label className={`block text-xs font-medium ${isDark ? "text-zinc-400" : "text-slate-700"} mb-1`}>Assignee</label>
                  <select
                    value={editAssignee}
                    onChange={(e) => setEditAssignee(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2 text-sm border outline-none ${
                      theme === "dark"
                        ? "bg-zinc-800/80 border-zinc-700 text-zinc-100"
                        : "bg-slate-50 border-slate-200 text-slate-800"
                    }`}
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m._id} value={m._id}>{m.name} ({m.role})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="px-4 py-2 text-sm font-medium rounded-xl text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="px-4 py-2 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  {updating ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
