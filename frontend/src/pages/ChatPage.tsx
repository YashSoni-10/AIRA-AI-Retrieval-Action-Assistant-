import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { streamChatMessage, type Citation } from "../services/api";
import {
  createConversation,
  saveMessage,
  listConversations,
  getMessages,
  deleteConversation,
  clearAllConversations,
  getUser,
  type Conversation,
  type ChatMessage,
} from "../services/auth";
import MarkdownRenderer from "../components/MarkdownRenderer";

// ─── Speech API shims ────────────────────────────────────────────────────────
interface SpeechRecognitionAlternative { transcript: string; confidence?: number; }
interface SpeechRecognitionResult { [i: number]: SpeechRecognitionAlternative; length: number; isFinal?: boolean; }
interface SpeechRecognitionResultList { [i: number]: SpeechRecognitionResult; length: number; }
interface SpeechRecognitionEvent { results: SpeechRecognitionResultList; resultIndex?: number; }
interface SpeechRecognitionInstance {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null; onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null; start: () => void;
}
interface SpeechRecognitionConstructor { new(): SpeechRecognitionInstance; }
declare global { interface Window { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor; } }

// ─── Types ───────────────────────────────────────────────────────────────────
type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  confidence?: number;
  confidence_label?: string;
  reasoning_steps?: string[];
  citations?: Citation[];
  chunks_found?: number;
};

type ToastMsg = { type: "success" | "error"; text: string };

// ─── Confidence Badge ────────────────────────────────────────────────────────
function ConfidenceBadge({ label, value, isDark }: { label: string; value: number; isDark: boolean }) {
  const darkColors: Record<string, string> = {
    High: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    Low: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const lightColors: Record<string, string> = {
    High: "bg-emerald-50 text-emerald-800 border-emerald-300",
    Medium: "bg-amber-50 text-amber-900 border-amber-300",
    Low: "bg-rose-50 text-rose-800 border-rose-300",
  };
  const colorClass = isDark ? (darkColors[label] ?? darkColors.Low) : (lightColors[label] ?? lightColors.Low);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${colorClass}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      {label} Confidence · {Math.round(value * 100)}%
    </span>
  );
}

// ─── Citation Card ────────────────────────────────────────────────────────────
function CitationCard({ citation, index, isDark }: { citation: Citation; index: number; isDark: boolean }) {
  const getBadgeText = () => {
    if (citation.score_label?.trim()) return citation.score_label;
    if (citation.score_type === "rrf" || citation.score_type === "rank") return `Rank #${index + 1}`;
    if (typeof citation.score === "number" && !isNaN(citation.score)) {
      if (citation.score > 1.0 || citation.score < 0.0) return `Score: ${citation.score.toFixed(2)}`;
      return `${Math.round(citation.score * 100)}% Match`;
    }
    return `Source ${index + 1}`;
  };
  return (
    <div className={`rounded-xl border p-3 text-xs ${isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`font-semibold truncate ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
          [{index + 1}] {citation.filename}{citation.page_number ? `, p.${citation.page_number}` : ""}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${isDark ? "bg-white/10 text-zinc-400" : "bg-slate-200 text-slate-500"}`}>
          {getBadgeText()}
        </span>
      </div>
      <p className={`mt-1.5 leading-5 ${isDark ? "text-zinc-500" : "text-slate-500"}`}>{citation.excerpt}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
function ChatPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const location = useLocation();
  const initialQuery: string = (location.state as any)?.initialQuery ?? "";

  // UI state
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<number | null>(null);
  const [expandedCitations, setExpandedCitations] = useState<number | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const initialQuerySentRef = useRef(false);
  const savedAssistantIdsRef = useRef<Set<number>>(new Set());

  // Conversation persistence
  const conversationIdRef = useRef<string | null>(null);

  // Sidebar / history state
  const [convList, setConvList] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Delete / clear state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [convToDelete, setConvToDelete] = useState<Conversation | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [toast, setToast] = useState<ToastMsg | null>(null);

  const suggestions = [
    "What is our work-from-home policy?",
    "Who owns the payment service?",
    "Summarize the architecture overview.",
    "What changed in the latest deployment?",
  ];

  // ── Scroll to bottom ────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // ── Auto-dismiss toast ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Close 3-dot menu on outside click ──────────────────────────────────────
  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".conv-action-menu")) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  // ── Load conversation messages ───────────────────────────────────────────────
  const loadConversation = useCallback(async (conv: Conversation) => {
    if (isStreaming) return;
    setHistoryLoading(true);
    try {
      const res = await getMessages(conv._id, 1, 100);
      if (res.success) {
        const loaded: Message[] = res.messages.map((m: ChatMessage, idx: number) => ({
          id: idx + 1,
          role: m.role as "user" | "assistant",
          content: m.content,
          citations: m.sources?.map((s) => ({
            filename: s.filename,
            chunk_index: s.chunk_index,
            excerpt: s.excerpt,
            score: s.score,
            page_number: s.page_number,
            score_label: s.score_label,
            raw_score: s.raw_score,
            score_type: s.score_type,
          })),
          confidence: m.meta?.confidence ?? undefined,
          confidence_label: m.meta?.confidence_label ?? undefined,
          chunks_found: m.meta?.chunks_found ?? undefined,
        }));
        messageIdRef.current = loaded.length;
        setMessages(loaded);
        setSelectedConvId(conv._id);
        conversationIdRef.current = conv._id;
        setSidebarOpen(false);
      }
    } catch {
      // silently ignore — DB may be down
    } finally {
      setHistoryLoading(false);
    }
  }, [isStreaming]);

  // ── On mount: load conversations ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const res = await listConversations(1, 20);
        if (cancelled) return;
        if (res.success && res.conversations.length > 0) {
          const chatOnly = res.conversations.filter((c) => !c.title?.startsWith("Agent Session"));
          if (chatOnly.length > 0) {
            setConvList(chatOnly);
            await loadConversation(chatOnly[0]);
          } else {
            const created = await createConversation("New Chat");
            if (!cancelled && created.success) {
              conversationIdRef.current = created.conversation._id;
              setSelectedConvId(created.conversation._id);
              setConvList([created.conversation]);
            }
          }
        } else {
          const created = await createConversation("New Chat");
          if (!cancelled && created.success) {
            conversationIdRef.current = created.conversation._id;
            setSelectedConvId(created.conversation._id);
            setConvList([created.conversation]);
          }
        }
      } catch {
        try {
          const created = await createConversation("New Chat");
          if (!cancelled && created.success) {
            conversationIdRef.current = created.conversation._id;
            setSelectedConvId(created.conversation._id);
          }
        } catch { /* fully offline */ }
      }
    }
    init().then(() => {
      if (initialQuery && !cancelled && !initialQuerySentRef.current) {
        initialQuerySentRef.current = true;
        try { window.history.replaceState({}, document.title); } catch { /* ignore */ }
        sendMessage(initialQuery);
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const userId = ++messageIdRef.current;
    setMessages((prev) => [...prev, { id: userId, role: "user", content: trimmed }]);
    setMessage("");
    setIsStreaming(true);

    // Persist user message
    if (conversationIdRef.current) {
      saveMessage(conversationIdRef.current, "user", trimmed).catch(() => {});
    }

    const aiId = ++messageIdRef.current;
    let accumulatedContent = "";

    setMessages((prev) => [
      ...prev,
      { id: aiId, role: "assistant", content: "", isStreaming: true, reasoning_steps: [] },
    ]);

    const cleanup = streamChatMessage(
      trimmed,
      (event) => {
        if (event.type === "reasoning_step") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId ? { ...m, reasoning_steps: [...(m.reasoning_steps ?? []), event.text] } : m
            )
          );
        } else if (event.type === "token") {
          accumulatedContent += event.text;
          setMessages((prev) =>
            prev.map((m) => (m.id === aiId ? { ...m, content: m.content + event.text } : m))
          );
        } else if (event.type === "done") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId
                ? {
                    ...m,
                    isStreaming: false,
                    confidence: event.confidence,
                    confidence_label: event.confidence_label,
                    citations: event.citations,
                    chunks_found: event.chunks_found,
                  }
                : m
            )
          );
          setIsStreaming(false);

          if (conversationIdRef.current && accumulatedContent.trim() && !savedAssistantIdsRef.current.has(aiId)) {
            savedAssistantIdsRef.current.add(aiId);
            saveMessage(
              conversationIdRef.current,
              "assistant",
              accumulatedContent.trim(),
              (event.citations ?? []).map((c) => ({
                filename: c.filename,
                chunk_index: c.chunk_index,
                excerpt: c.excerpt,
                score: c.score,
                page_number: c.page_number,
                score_label: c.score_label,
                raw_score: c.raw_score,
                score_type: c.score_type,
              })),
              {
                confidence: event.confidence ?? null,
                confidence_label: event.confidence_label ?? null,
                chunks_found: event.chunks_found ?? null,
              }
            ).catch(() => {});
          }

          // Refresh title if this was the first message
          listConversations(1, 20)
            .then((r) => {
              if (r.success) {
                const chatOnly = r.conversations.filter((c) => !c.title?.startsWith("Agent Session"));
                setConvList(chatOnly);
              }
            })
            .catch(() => {});
        } else if (event.type === "error") {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiId ? { ...m, isStreaming: false, content: `⚠️ ${event.message}` } : m))
          );
          setIsStreaming(false);
        }
      },
      5,
      conversationIdRef.current
    );
    cleanupRef.current = cleanup;
  }, [isStreaming]);

  const handleAsk = () => sendMessage(message);

  // ── Stop streaming ────────────────────────────────────────────────────────────
  const stopStreaming = () => {
    cleanupRef.current?.();
    setIsStreaming(false);
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  };

  // ── New Chat ──────────────────────────────────────────────────────────────────
  const startNewChat = () => {
    cleanupRef.current?.();
    setMessages([]);
    setMessage("");
    setIsStreaming(false);
    savedAssistantIdsRef.current = new Set();
    createConversation("New Chat")
      .then((res) => {
        if (res.success) {
          conversationIdRef.current = res.conversation._id;
          setSelectedConvId(res.conversation._id);
          setConvList((prev) => {
            const filtered = prev.filter((c) => c._id !== res.conversation._id);
            return [res.conversation, ...filtered].slice(0, 20);
          });
        }
      })
      .catch(() => {});
    setSidebarOpen(false);
  };

  // ── Clear current chat display only ──────────────────────────────────────────
  const clearCurrentChat = () => {
    cleanupRef.current?.();
    setMessages([]);
    setMessage("");
    setIsStreaming(false);
  };

  // ── Voice input ───────────────────────────────────────────────────────────────
  const startVoiceInput = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice input requires Chrome or Edge."); return; }
    const rec = new SR();
    rec.lang = "en-US"; rec.continuous = false; rec.interimResults = false;
    rec.onstart = () => setIsListening(true);
    rec.onresult = (e: SpeechRecognitionEvent) => setMessage(e.results[0][0].transcript);
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    rec.start();
  };

  // ── Delete single conversation ────────────────────────────────────────────────
  const confirmDeleteConversation = async () => {
    if (!convToDelete || isDeleting) return;
    setIsDeleting(true);
    const target = convToDelete;
    try {
      const res = await deleteConversation(target._id);
      if (res.success) {
        setConvList((prev) => prev.filter((c) => c._id !== target._id));
        setToast({ type: "success", text: "Conversation deleted." });
        if (selectedConvId === target._id || conversationIdRef.current === target._id) {
          cleanupRef.current?.();
          setMessages([]);
          setMessage("");
          setIsStreaming(false);
          setSelectedConvId(null);
          conversationIdRef.current = null;
          try {
            const created = await createConversation("New Chat");
            if (created.success) {
              conversationIdRef.current = created.conversation._id;
              setSelectedConvId(created.conversation._id);
              setConvList((prev) => [created.conversation, ...prev.filter((c) => c._id !== created.conversation._id)]);
            }
          } catch { /* offline */ }
        }
      } else {
        setToast({ type: "error", text: res.message || "Failed to delete." });
      }
    } catch (err: any) {
      setToast({ type: "error", text: err?.message || "Failed to delete." });
    } finally {
      setIsDeleting(false);
      setConvToDelete(null);
    }
  };

  // ── Clear all chat history ────────────────────────────────────────────────────
  const confirmClearAll = async () => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      const currentUser = getUser();
      const workspaceId = currentUser?.workspace?._id;
      const res = await clearAllConversations(workspaceId);
      if (res.success) {
        setConvList([]);
        cleanupRef.current?.();
        setMessages([]);
        setMessage("");
        setIsStreaming(false);
        setSelectedConvId(null);
        conversationIdRef.current = null;
        setToast({ type: "success", text: `History cleared (${res.deletedCount ?? 0} conversations).` });
        try {
          const created = await createConversation("New Chat");
          if (created.success) {
            conversationIdRef.current = created.conversation._id;
            setSelectedConvId(created.conversation._id);
            setConvList([created.conversation]);
          }
        } catch { /* offline */ }
      } else {
        setToast({ type: "error", text: res.message || "Failed to clear history." });
      }
    } catch (err: any) {
      setToast({ type: "error", text: err?.message || "Failed to clear history." });
    } finally {
      setIsClearing(false);
      setShowClearConfirm(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* History Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setSidebarOpen(false)}>
          <div
            className={`z-50 flex h-full w-72 flex-col overflow-hidden shadow-2xl ${
              isDark ? "bg-[#0c0d1f] border-r border-white/10" : "bg-white border-r border-slate-200"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sidebar header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? "border-white/10" : "border-slate-200"}`}>
              <span className={`text-sm font-bold ${isDark ? "text-white" : "text-slate-800"}`}>Chat History</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={startNewChat}
                  className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                    isDark ? "text-cyan-400 hover:bg-white/5" : "text-blue-600 hover:bg-slate-100"
                  }`}
                >
                  + New
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className={`text-xs rounded-lg px-2 py-1 ${isDark ? "text-zinc-400 hover:text-white" : "text-slate-500 hover:text-slate-800"}`}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto">
              {historyLoading ? (
                <p className={`p-4 text-xs ${isDark ? "text-zinc-500" : "text-slate-400"}`}>Loading…</p>
              ) : convList.length === 0 ? (
                <p className={`p-4 text-xs ${isDark ? "text-zinc-500" : "text-slate-400"}`}>No conversations yet.</p>
              ) : (
                convList.map((conv) => (
                  <div
                    key={conv._id}
                    className={`group relative flex items-center border-b last:border-0 transition ${
                      selectedConvId === conv._id
                        ? isDark ? "bg-cyan-500/10 border-cyan-500/20" : "bg-blue-50 border-blue-100"
                        : isDark ? "border-white/5 hover:bg-white/5" : "border-slate-100 hover:bg-slate-50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => loadConversation(conv)}
                      className="flex-1 min-w-0 px-4 py-3 text-left text-xs"
                    >
                      <div className={`font-semibold truncate ${
                        selectedConvId === conv._id
                          ? isDark ? "text-cyan-300" : "text-blue-700"
                          : isDark ? "text-zinc-300" : "text-slate-700"
                      }`}>
                        {conv.title}
                      </div>
                      <div className={`mt-0.5 ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                        {new Date(conv.updatedAt || conv.createdAt).toLocaleDateString()}
                        {conv.message_count > 0 && ` · ${conv.message_count} msgs`}
                      </div>
                    </button>
                    {/* 3-dot menu */}
                    <div className="relative pr-2 conv-action-menu">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === conv._id ? null : conv._id);
                        }}
                        aria-label={`Options for ${conv.title}`}
                        className={`rounded-lg p-1.5 text-xs transition ${
                          openMenuId === conv._id
                            ? isDark ? "bg-white/10 text-white" : "bg-slate-200 text-slate-800"
                            : isDark ? "text-zinc-500 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        ···
                      </button>
                      {openMenuId === conv._id && (
                        <div
                          className={`absolute right-2 top-8 z-50 w-32 rounded-xl border py-1 shadow-xl text-xs ${
                            isDark ? "bg-[#18192c] border-white/15 text-white" : "bg-white border-slate-200 text-slate-800"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConvToDelete(conv);
                              setOpenMenuId(null);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-500 hover:bg-red-500/10 transition font-medium"
                          >
                            <span>🗑</span>
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Clear all footer */}
            <div className={`border-t p-3 ${isDark ? "border-white/10 bg-[#090a16]" : "border-slate-200 bg-slate-50"}`}>
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                disabled={convList.length === 0}
                className={`flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  convList.length === 0
                    ? "opacity-40 cursor-not-allowed text-zinc-500"
                    : isDark
                      ? "text-red-400 border border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40"
                      : "text-red-600 border border-red-200 hover:bg-red-50 hover:border-red-300"
                }`}
              >
                <span>🗑</span>
                <span>Clear All History</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main page */}
      <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">

        {/* Header */}
        <header className={`relative z-20 border-b px-5 py-4 backdrop-blur-xl transition-colors duration-300 sm:px-8 ${
          isDark ? "border-white/10 bg-[#090a13]/80 text-white" : "border-slate-200/80 bg-white/80 text-slate-900 shadow-sm"
        }`}>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>AI Chat</h2>
              <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                Ask questions about your workspace knowledge
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* History button */}
              <button
                id="chat-history-btn"
                onClick={() => setSidebarOpen((o) => !o)}
                title="Chat history"
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  isDark ? "border-white/10 text-zinc-400 hover:border-white/20 hover:text-white" : "border-slate-200 text-slate-500 hover:text-slate-900"
                }`}
              >
                ⏱ History {convList.length > 0 && `(${convList.length})`}
              </button>

              {/* New Chat button */}
              <button
                onClick={startNewChat}
                title="New Chat"
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  isDark ? "border-cyan-500/30 text-cyan-400 hover:border-cyan-400/60 hover:bg-cyan-500/10" : "border-blue-200 text-blue-600 hover:border-blue-400 hover:bg-blue-50"
                }`}
              >
                + New Chat
              </button>

              {/* Clear current view */}
              {messages.length > 0 && (
                <button
                  onClick={clearCurrentChat}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    isDark ? "border-white/10 text-zinc-400 hover:border-white/20 hover:text-white" : "border-slate-200 text-slate-500 hover:text-slate-900"
                  }`}
                >
                  Clear view
                </button>
              )}

              {/* Model indicator */}
              <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                isDark ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-emerald-300 bg-emerald-50 text-emerald-700"
              }`}>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Groq · Streaming
              </div>
            </div>
          </div>
        </header>

        {/* Chat Body */}
        <main className={`relative flex flex-1 flex-col overflow-hidden ${isDark ? "bg-[#060812]" : "bg-slate-50"}`}>
          <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-8">

            {messages.length === 0 ? (
              /* Empty State */
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className={`flex h-20 w-20 items-center justify-center rounded-3xl border text-4xl shadow-2xl ${
                  isDark ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300 shadow-[0_0_40px_rgba(6,182,212,0.2)]" : "border-blue-200 bg-blue-600 text-white shadow-blue-200"
                }`}>
                  ✦
                </div>
                <h3 className={`mt-5 text-2xl font-extrabold ${isDark ? "text-white" : "text-slate-900"}`}>
                  Ask AIRA anything
                </h3>
                <p className={`mt-2 max-w-sm text-sm leading-6 ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                  Upload documents in the Documents page, then ask questions here. Answers are grounded in your knowledge base with citations.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className={`rounded-xl border px-4 py-2 text-sm font-medium transition hover:-translate-y-0.5 ${
                        isDark ? "border-white/15 bg-white/[0.04] text-zinc-300 hover:border-cyan-400/40 hover:bg-white/[0.08] hover:text-white" : "border-slate-200 bg-white/70 text-slate-700 hover:border-blue-300 hover:bg-white hover:text-blue-700 shadow-sm"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Message list */
              <div className="mx-auto w-full max-w-3xl space-y-6">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} items-start gap-3`}>

                    {/* AI avatar */}
                    {msg.role === "assistant" && (
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm shadow-md ${
                        isDark ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-300" : "border-blue-200 bg-blue-600 text-white"
                      }`}>
                        ✦
                      </div>
                    )}

                    <div className={`max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-2`}>

                      {/* Message bubble */}
                      <div className={`relative overflow-hidden rounded-2xl px-4 py-3 text-sm leading-6 ${
                        msg.role === "user"
                          ? isDark
                            ? "rounded-tr-sm bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400/20 text-white"
                            : "rounded-tr-sm bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
                          : isDark
                          ? "rounded-tl-sm border border-white/10 bg-white/[0.04] text-zinc-200"
                          : "rounded-tl-sm border border-white/80 bg-white/60 text-slate-800 shadow-sm"
                      }`}>
                        {msg.role === "assistant" && msg.isStreaming && msg.content === "" ? (
                          /* Typing indicator */
                          <div className="flex items-center gap-1.5 py-1">
                            <span className={`h-2 w-2 animate-bounce rounded-full ${isDark ? "bg-cyan-400" : "bg-blue-600"}`} />
                            <span className={`h-2 w-2 animate-bounce rounded-full [animation-delay:150ms] ${isDark ? "bg-cyan-400" : "bg-blue-600"}`} />
                            <span className={`h-2 w-2 animate-bounce rounded-full [animation-delay:300ms] ${isDark ? "bg-cyan-400" : "bg-blue-600"}`} />
                          </div>
                        ) : msg.role === "assistant" ? (
                          /* Markdown for assistant */
                          <div className="relative">
                            <MarkdownRenderer content={msg.content} isDark={isDark} />
                            {msg.isStreaming && msg.content !== "" && (
                              <span className={`ml-0.5 inline-block h-4 w-0.5 animate-pulse ${isDark ? "bg-cyan-400" : "bg-blue-600"}`} />
                            )}
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        )}
                      </div>

                      {/* Confidence badge */}
                      {msg.confidence_label && !msg.isStreaming && (
                        <ConfidenceBadge label={msg.confidence_label} value={msg.confidence ?? 0} isDark={isDark} />
                      )}

                      {/* Reasoning steps accordion */}
                      {msg.reasoning_steps && msg.reasoning_steps.length > 0 && !msg.isStreaming && (
                        <div className={`w-full rounded-xl border text-xs ${isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-slate-50"}`}>
                          <button
                            onClick={() => setExpandedReasoning(expandedReasoning === msg.id ? null : msg.id)}
                            className={`flex w-full items-center justify-between px-3 py-2 font-semibold ${isDark ? "text-zinc-400 hover:text-zinc-200" : "text-slate-500 hover:text-slate-700"}`}
                          >
                            <span>⚡ Reasoning steps ({msg.reasoning_steps.length})</span>
                            <span>{expandedReasoning === msg.id ? "▲" : "▼"}</span>
                          </button>
                          {expandedReasoning === msg.id && (
                            <div className="border-t px-3 pb-3 pt-2 space-y-1.5">
                              {msg.reasoning_steps.map((step, i) => (
                                <p key={i} className={isDark ? "text-zinc-500" : "text-slate-400"}>{step}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Citations accordion */}
                      {msg.citations && msg.citations.length > 0 && !msg.isStreaming && (
                        <div className={`w-full rounded-xl border text-xs ${isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-slate-50"}`}>
                          <button
                            onClick={() => setExpandedCitations(expandedCitations === msg.id ? null : msg.id)}
                            className={`flex w-full items-center justify-between px-3 py-2 font-semibold ${isDark ? "text-cyan-400 hover:text-cyan-300" : "text-blue-600 hover:text-blue-700"}`}
                          >
                            <span>📎 {msg.citations.length} source{msg.citations.length > 1 ? "s" : ""}</span>
                            <span>{expandedCitations === msg.id ? "▲" : "▼"}</span>
                          </button>
                          {expandedCitations === msg.id && (
                            <div className={`space-y-2 border-t px-3 pb-3 pt-2 ${isDark ? "border-white/10" : "border-slate-200"}`}>
                              {msg.citations.map((c, i) => (
                                <CitationCard key={i} citation={c} index={i} isDark={isDark} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Bar */}
          <div className={`border-t px-4 py-4 sm:px-8 ${isDark ? "border-white/10 bg-[#090a13]/80 backdrop-blur-xl" : "border-slate-200/80 bg-white/80 backdrop-blur-xl shadow-lg"}`}>
            <div className="mx-auto max-w-3xl">
              <div className={`relative overflow-hidden rounded-2xl border p-2.5 transition-all duration-300 ${
                isDark
                  ? "border-white/15 bg-white/[0.04] focus-within:border-cyan-400/60 focus-within:shadow-[0_0_30px_rgba(6,182,212,0.15)] hover:border-white/25"
                  : "border-slate-300 bg-white focus-within:border-blue-500 focus-within:shadow-[0_0_0_3px_rgba(59,130,246,0.1)]"
              }`}>
                <div className="flex items-center gap-2">
                  {/* Voice */}
                  <button
                    onClick={startVoiceInput}
                    aria-label="Voice input"
                    className={`rounded-xl p-2 transition ${
                      isListening
                        ? isDark ? "bg-cyan-500/20 text-cyan-300" : "bg-blue-100 text-blue-700"
                        : isDark ? "text-zinc-400 hover:bg-white/10 hover:text-cyan-400" : "text-slate-400 hover:bg-slate-100 hover:text-blue-600"
                    }`}
                  >
                    🎙️
                  </button>

                  {/* Input */}
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleAsk(); }}
                    placeholder="Ask about your documents..."
                    disabled={isStreaming}
                    className={`min-w-0 flex-1 bg-transparent px-2 py-3 text-sm outline-none ${
                      isDark ? "text-white placeholder:text-zinc-500" : "text-slate-900 placeholder:text-slate-400"
                    }`}
                  />

                  {/* Stop or Send */}
                  {isStreaming ? (
                    <button
                      onClick={stopStreaming}
                      aria-label="Stop generating"
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                        isDark ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-50 text-red-600 hover:bg-red-100"
                      }`}
                    >
                      ⏹
                    </button>
                  ) : (
                    <button
                      onClick={handleAsk}
                      disabled={!message.trim()}
                      aria-label="Send message"
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${
                        isDark
                          ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white"
                          : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md"
                      }`}
                    >
                      ↑
                    </button>
                  )}
                </div>
              </div>
              <p className={`mt-2 text-center text-[11px] ${isDark ? "text-zinc-600" : "text-slate-400"}`}>
                AIRA answers are grounded in your knowledge base · Upload documents to get started
              </p>
            </div>
          </div>
        </main>
      </div>

      {/* ── Delete Confirmation Modal ── */}
      {convToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${
            isDark ? "bg-[#121324] border-white/15 text-white" : "bg-white border-slate-200 text-slate-900"
          }`}>
            <h3 className="text-base font-bold">Delete Conversation?</h3>
            <p className={`mt-2 text-xs leading-relaxed ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
              Delete <span className="font-semibold">"{convToDelete.title}"</span>? This permanently removes all messages in this conversation.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConvToDelete(null)}
                disabled={isDeleting}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                  isDark ? "bg-white/10 text-zinc-300 hover:bg-white/15" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteConversation}
                disabled={isDeleting}
                className="rounded-xl bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-50 transition"
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Clear All Confirmation Modal ── */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${
            isDark ? "bg-[#121324] border-white/15 text-white" : "bg-white border-slate-200 text-slate-900"
          }`}>
            <h3 className="text-base font-bold">Clear All Chat History?</h3>
            <p className={`mt-2 text-xs leading-relaxed ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
              This permanently deletes all your conversations and messages in this workspace. This cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                disabled={isClearing}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                  isDark ? "bg-white/10 text-zinc-300 hover:bg-white/15" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmClearAll}
                disabled={isClearing}
                className="rounded-xl bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-50 transition"
              >
                {isClearing ? "Clearing…" : "Clear All"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium shadow-xl transition-all duration-300 ${
            toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          <span>{toast.type === "success" ? "✓" : "⚠"}</span>
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} className="ml-2 text-white/80 hover:text-white">✕</button>
        </div>
      )}
    </>
  );
}

export default ChatPage;
