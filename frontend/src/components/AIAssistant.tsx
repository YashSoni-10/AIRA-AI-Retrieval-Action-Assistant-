import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { IconBot, IconMessageSquare, IconArrowRight } from "./icons";

/**
 * AIAssistant dashboard widget.
 *
 * Phase 2 Milestone 2:
 * - "Start conversation" navigates to /chat (full chat experience)
 * - Quick-ask input sends query directly to /chat with state so ChatPage
 *   pre-populates and auto-sends the message
 */
function AIAssistant() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const [quickQuery, setQuickQuery] = useState("");

  function handleStartConversation() {
    navigate("/chat");
  }

  function handleQuickAsk() {
    const q = quickQuery.trim();
    if (!q) {
      navigate("/chat");
      return;
    }
    // Navigate to chat and pass the query as location state.
    // ChatPage will pick this up on mount and auto-send it.
    navigate("/chat", { state: { initialQuery: q } });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleQuickAsk();
  }

  return (
    <div
      className={`group relative overflow-hidden rounded-3xl border p-6 backdrop-blur-2xl transition-all duration-300 sm:p-8 ${
        isDark
          ? "border-white/15 bg-white/[0.04] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] hover:border-cyan-400/50 hover:bg-white/[0.07] hover:shadow-[0_20px_40px_rgba(6,182,212,0.2)]"
          : "border-slate-200 bg-white shadow-sm hover:border-blue-300 hover:shadow-md"
      }`}
    >
      {/* Top highlight specular line */}
      <div
        className={`absolute inset-x-0 top-0 h-[1px] ${
          isDark
            ? "bg-gradient-to-r from-transparent via-cyan-400/50 via-blue-400/50 to-transparent"
            : "bg-gradient-to-r from-transparent via-blue-300/50 to-transparent"
        }`}
      />

      {/* Background Glow */}
      <div
        className={`absolute -right-10 -top-10 h-36 w-36 rounded-full blur-3xl pointer-events-none transition-opacity duration-500 ${
          isDark ? "bg-cyan-500/15 group-hover:bg-cyan-500/25" : "bg-blue-400/15 group-hover:bg-blue-400/25"
        }`}
      />

      <div className="relative z-10">

        {/* Header */}
        <div className="flex items-center justify-between">

          <div className="flex min-w-0 items-center gap-3">

            {/* AI Icon */}
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-xl transition-transform duration-300 group-hover:scale-105 ${
                isDark
                  ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                  : "border-blue-200 bg-blue-600 text-white shadow-md shadow-blue-200"
              }`}
            >
              <IconBot className="h-6 w-6" />
            </div>

            {/* Title */}
            <div className="min-w-0">
              <h2 className={`truncate text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                AIRA Assistant
              </h2>

              <div className="mt-1 flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-emerald-600">Online</span>
              </div>
            </div>

          </div>

        </div>

        {/* Description */}
        <p className={`mt-5 text-sm leading-6 sm:mt-6 ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
          Ask questions about your workspace, search company knowledge,
          or let AIRA help you complete complex tasks autonomously.
        </p>

        {/* Quick Ask input */}
        <div className={`mt-5 flex items-center gap-2 rounded-xl border p-2 transition-all sm:mt-6 ${
          isDark
            ? "border-white/10 bg-white/[0.04] focus-within:border-cyan-400/50"
            : "border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20"
        }`}>
          <input
            id="ai-assistant-quick-ask"
            type="text"
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Quick question..."
            className={`min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs outline-none ${
              isDark ? "text-white placeholder:text-zinc-500" : "text-slate-900 placeholder:text-slate-500"
            }`}
          />
          <button
            id="ai-assistant-quick-send"
            onClick={handleQuickAsk}
            disabled={!quickQuery.trim()}
            className={`inline-flex items-center gap-1 shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
              isDark
                ? "bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
                : "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
            }`}
          >
            <span>Ask</span>
            <IconArrowRight className="h-3 w-3" />
          </button>
        </div>

        {/* Conversation Button */}
        <button
          id="ai-assistant-start-chat"
          onClick={handleStartConversation}
          className={`mt-4 w-full rounded-xl p-[1px] text-sm font-bold shadow-lg transition-all hover:brightness-110 active:scale-[0.99] ${
            isDark
              ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white shadow-cyan-500/20"
              : "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white shadow-blue-500/20"
          }`}
        >
          <div
            className={`rounded-[11px] px-4 py-3 text-center transition ${
              isDark
                ? "bg-[#0b0e1d] text-white hover:bg-transparent"
                : "bg-blue-600 text-white hover:bg-transparent"
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <span>Open full chat</span>
              <IconMessageSquare className="h-4 w-4" />
            </span>
          </div>
        </button>

      </div>
    </div>
  );
}

export default AIAssistant;
