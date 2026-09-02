import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { streamChatMessage, type Citation } from "../services/api";

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

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

function ConfidenceBadge({ label, value }: { label: string; value: number }) {
  const colors: Record<string, string> = {
    High: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    Medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    Low: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${colors[label] ?? colors.Low}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      {label} Confidence · {Math.round(value * 100)}%
    </span>
  );
}

function CitationCard({ citation, index, isDark }: { citation: Citation; index: number; isDark: boolean }) {
  return (
    <div className={`rounded-xl border p-3 text-xs ${isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`font-semibold truncate ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
          [{index + 1}] {citation.filename}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${isDark ? "bg-white/10 text-zinc-400" : "bg-slate-200 text-slate-500"}`}>
          {Math.round(citation.score * 100)}%
        </span>
      </div>
      <p className={`mt-1.5 leading-5 ${isDark ? "text-zinc-500" : "text-slate-500"}`}>{citation.excerpt}</p>
    </div>
  );
}

function ChatPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<number | null>(null);
  const [expandedCitations, setExpandedCitations] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const suggestions = [
    "What is our work-from-home policy?",
    "Who owns the payment service?",
    "Summarize the architecture overview.",
    "What changed in the latest deployment?",
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    // Add user message
    const userId = ++messageIdRef.current;
    setMessages((prev) => [...prev, { id: userId, role: "user", content: trimmed }]);
    setMessage("");
    setIsStreaming(true);

    // Add placeholder assistant message that will be filled via streaming
    const aiId = ++messageIdRef.current;
    setMessages((prev) => [
      ...prev,
      { id: aiId, role: "assistant", content: "", isStreaming: true, reasoning_steps: [] },
    ]);

    // Start SSE stream
    const cleanup = streamChatMessage(
      trimmed,
      (event) => {
        if (event.type === "reasoning_step") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId
                ? { ...m, reasoning_steps: [...(m.reasoning_steps ?? []), event.text] }
                : m
            )
          );
        } else if (event.type === "token") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId ? { ...m, content: m.content + event.text } : m
            )
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
        } else if (event.type === "error") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId
                ? {
                    ...m,
                    isStreaming: false,
                    content: `⚠️ ${event.message}`,
                  }
                : m
            )
          );
          setIsStreaming(false);
        }
      },
      5
    );
    cleanupRef.current = cleanup;
  }, [isStreaming]);

  const handleAsk = () => sendMessage(message);

  const stopStreaming = () => {
    cleanupRef.current?.();
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    );
  };

  const clearConversation = () => {
    cleanupRef.current?.();
    setMessages([]);
    setMessage("");
    setIsStreaming(false);
  };

  const startVoiceInput = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice input requires Chrome or Edge."); return; }
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => setIsListening(true);
    rec.onresult = (e: SpeechRecognitionEvent) => setMessage(e.results[0][0].transcript);
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    rec.start();
  };

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">

      {/* Header */}
      <header className={`border-b px-5 py-4 backdrop-blur-xl transition-colors duration-300 sm:px-8 ${
        isDark ? "border-white/10 bg-[#090a13]/80 text-white" : "border-slate-200/80 bg-white/80 text-slate-900 shadow-sm"
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>AI Chat</h2>
            <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
              Ask questions about your workspace knowledge
            </p>
          </div>
          <div className="flex items-center gap-3">
            {messages.length > 0 && (
              <button
                onClick={clearConversation}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  isDark ? "border-white/10 text-zinc-400 hover:border-white/20 hover:text-white" : "border-slate-200 text-slate-500 hover:text-slate-900"
                }`}
              >
                Clear chat
              </button>
            )}
            <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              isDark ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-emerald-300 bg-emerald-50 text-emerald-700"
            }`}>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Groq · Llama 3.1
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
              {/* Suggestion chips */}
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
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                      {msg.role === "assistant" && msg.isStreaming && msg.content !== "" && (
                        <span className={`ml-0.5 inline-block h-4 w-0.5 animate-pulse ${isDark ? "bg-cyan-400" : "bg-blue-600"}`} />
                      )}
                    </div>

                    {/* Confidence badge */}
                    {msg.confidence_label && !msg.isStreaming && (
                      <ConfidenceBadge label={msg.confidence_label} value={msg.confidence ?? 0} />
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
                              <p key={i} className={isDark ? "text-zinc-500" : "text-slate-400"}>
                                {step}
                              </p>
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
  );
}

export default ChatPage;
