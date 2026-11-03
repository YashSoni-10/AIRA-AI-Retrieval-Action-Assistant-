import { useTheme } from "../context/ThemeContext";
import type { RecentActivityItem } from "../services/api";
import { IconFileText, IconClipboardList, IconSparkles } from "./icons";

interface ActivityPanelProps {
  activities?: RecentActivityItem[];
  onViewAll?: () => void;
}

function formatTimeAgo(dateStr: string): string {
  try {
    const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "recently";
  }
}

function ActivityPanel({ activities, onViewAll }: ActivityPanelProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border p-4 sm:p-6 backdrop-blur-2xl transition-all duration-300 ease-out hover:-translate-y-1 ${
        isDark
          ? "border-white/15 bg-white/[0.04] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] hover:border-cyan-400/40 hover:bg-white/[0.07] hover:shadow-[0_20px_40px_rgba(6,182,212,0.2)]"
          : "border-slate-200 bg-white shadow-sm hover:border-blue-300 hover:shadow-md"
      }`}
    >
      {/* Top highlight line */}
      <div
        className={`absolute inset-x-0 top-0 h-[1px] ${
          isDark
            ? "bg-gradient-to-r from-transparent via-white/30 to-transparent"
            : "bg-gradient-to-r from-transparent via-blue-300/50 to-transparent"
        }`}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
            Recent Activity
          </h2>
          <p className={`mt-1 text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
            Live workspace updates & event audit
          </p>
        </div>

        {onViewAll && (
          <button
            onClick={onViewAll}
            className={`shrink-0 text-xs font-semibold sm:text-sm transition-colors ${
              isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"
            }`}
          >
            View all →
          </button>
        )}
      </div>

      {/* Activity List */}
      <div className="mt-6 space-y-3.5">
        {!activities || activities.length === 0 ? (
          <div className={`rounded-xl border p-4 text-center text-xs ${
            isDark ? "border-white/10 text-zinc-500" : "border-slate-200 text-slate-500 bg-slate-50"
          }`}>
            No activity recorded yet in this workspace. Upload a document or create a task to begin!
          </div>
        ) : (
          activities.map((item) => (
            <div
              key={item.id}
              className={`flex items-start gap-3 rounded-xl border p-3.5 backdrop-blur-md transition-all duration-200 hover:scale-[1.01] sm:gap-4 ${
                isDark
                  ? "border-white/10 bg-white/[0.03] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:border-cyan-400/30 hover:bg-white/[0.06]"
                  : "border-slate-200 bg-slate-50/70 shadow-sm hover:border-blue-200 hover:bg-slate-100/80"
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                  item.type === "document"
                    ? isDark
                      ? "border-cyan-400/30 bg-cyan-500/15 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                      : "border-blue-200 bg-blue-50 text-blue-700"
                    : item.type === "task"
                    ? isDark
                      ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : isDark
                    ? "border-violet-400/30 bg-violet-500/15 text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.15)]"
                    : "border-purple-200 bg-purple-50 text-purple-700"
                }`}
              >
                {item.type === "document" ? (
                  <IconFileText className="h-5 w-5" />
                ) : item.type === "task" ? (
                  <IconClipboardList className="h-5 w-5" />
                ) : (
                  <IconSparkles className="h-5 w-5" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-semibold ${isDark ? "text-zinc-200" : "text-slate-900"}`}>
                  {item.title}
                </p>
                <p className={`mt-1 truncate text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                  {item.detail}
                </p>
              </div>

              <span className={`shrink-0 text-[10px] font-medium sm:text-xs ${isDark ? "text-zinc-500" : "text-slate-500"}`}>
                {formatTimeAgo(item.timestamp)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ActivityPanel;
