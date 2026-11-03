import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { searchKnowledge, type SearchResult } from "../services/api";
import { IconSearch, IconX, IconAlertTriangle, IconFileText } from "./icons";

// Debounce delay in ms — avoids sending a request on every keystroke
const DEBOUNCE_MS = 400;

function SearchBox() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Run a search — called after debounce delay
  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await searchKnowledge(q.trim(), 5);
      setResults(data.results);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce: fire search after user stops typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Navigate to Knowledge page with the query pre-filled when Enter is pressed
  function handleEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim()) {
      setOpen(false);
      navigate(`/knowledge?q=${encodeURIComponent(query.trim())}`);
    }
  }

  // Clicking a quick-action chip navigates to the relevant page
  function handleChip(destination: string) {
    navigate(destination);
  }

  return (
    <div className="mt-8" ref={boxRef}>
      {/* Search Box */}
      <div
        className={`group relative overflow-hidden rounded-2xl border p-3.5 backdrop-blur-2xl transition-all duration-300 ${
          isDark
            ? "border-white/15 bg-white/[0.04] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] focus-within:border-cyan-400/60 focus-within:shadow-[0_20px_45px_rgba(6,182,212,0.25)] hover:border-white/25 hover:bg-white/[0.06]"
            : "border-slate-300 bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 hover:border-slate-400"
        }`}
      >
        {/* Top edge specular reflection line */}
        <div
          className={`absolute inset-x-0 top-0 h-[1px] transition-opacity ${
            isDark
              ? "bg-gradient-to-r from-transparent via-cyan-400/50 via-blue-400/50 to-transparent"
              : "bg-gradient-to-r from-transparent via-blue-300/60 to-transparent"
          }`}
        />

        {/* Input + Button */}
        <div className="flex items-center gap-2">

          {/* AI Icon / Loading spinner */}
          <span className={`shrink-0 pl-2 text-xl transition-transform duration-300 group-hover:scale-110 ${
            isDark ? "text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]" : "text-blue-600"
          }`}>
            {loading ? (
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <IconSearch className="h-5 w-5" />
            )}
          </span>

          {/* Input */}
          <input
            id="dashboard-search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleEnter}
            onFocus={() => { if (results.length > 0 || error) setOpen(true); }}
            placeholder="Ask anything about your workspace..."
            className={`min-w-0 flex-1 bg-transparent px-2 py-3 text-sm outline-none ${
              isDark
                ? "text-white placeholder:text-zinc-500"
                : "text-slate-900 placeholder:text-slate-500"
            }`}
          />

          {/* Clear button */}
          {query && (
            <button
              onClick={() => { setQuery(""); setResults([]); setOpen(false); }}
              className={`shrink-0 rounded-lg p-1.5 transition ${
                isDark ? "text-zinc-500 hover:text-zinc-300" : "text-slate-500 hover:text-slate-800"
              }`}
              aria-label="Clear search"
            >
              <IconX className="h-4 w-4" />
            </button>
          )}

          {/* Ask Button */}
          <button
            id="dashboard-search-btn"
            onClick={() => runSearch(query)}
            disabled={!query.trim() || loading}
            className={`shrink-0 rounded-xl px-5 py-3 text-xs font-bold shadow-lg transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed sm:px-6 sm:text-sm ${
              isDark
                ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white shadow-cyan-500/20"
                : "bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white shadow-blue-500/20"
            }`}
          >
            <span className="sm:hidden">Ask</span>
            <span className="hidden sm:inline">Ask AIRA</span>
          </button>

        </div>
      </div>

      {/* Results dropdown */}
      {open && (
        <div
          className={`relative z-50 mt-2 rounded-2xl border shadow-2xl overflow-hidden ${
            isDark
              ? "border-white/15 bg-[#0c0e1f]"
              : "border-slate-200 bg-white"
          }`}
        >
          {error ? (
            <div className={`flex items-center gap-2 px-4 py-3 text-xs ${isDark ? "text-red-400" : "text-red-700 bg-red-50"}`}>
              <IconAlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          ) : results.length === 0 ? (
            <div className={`px-4 py-3 text-xs ${isDark ? "text-zinc-500" : "text-slate-500"}`}>
              No results found for "{query}"
            </div>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      setOpen(false);
                      navigate(`/knowledge?q=${encodeURIComponent(query.trim())}`);
                    }}
                    className={`w-full px-4 py-3 text-left text-xs transition border-b last:border-0 hover:scale-[1.005] ${
                      isDark
                        ? "border-white/5 hover:bg-white/5 text-zinc-200"
                        : "border-slate-100 hover:bg-slate-50 text-slate-800"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`flex items-center gap-1.5 font-semibold truncate ${isDark ? "text-cyan-400" : "text-blue-700"}`}>
                        <IconFileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{r.filename}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isDark ? "bg-white/10 text-zinc-300" : "bg-slate-100 text-slate-700 border border-slate-200"
                      }`}>
                        {r.score_label || (r.score > 1.0 || r.score < 0.0 ? `Score: ${r.score.toFixed(2)}` : `${Math.round(r.score * 100)}%`)}
                      </span>
                    </div>
                    <p className={`mt-1 leading-5 line-clamp-2 ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                      {r.text.slice(0, 160)}…
                    </p>
                  </button>
                </li>
              ))}
              <li>
                <button
                  onClick={() => { setOpen(false); navigate(`/knowledge?q=${encodeURIComponent(query.trim())}`); }}
                  className={`w-full px-4 py-2.5 text-center text-xs font-semibold transition ${
                    isDark
                      ? "text-cyan-400 hover:bg-white/5"
                      : "text-blue-700 hover:bg-blue-50"
                  }`}
                >
                  View all results in Knowledge page →
                </button>
              </li>
            </ul>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="mt-4 flex gap-2.5 overflow-x-auto pb-1">

        <button
          onClick={() => handleChip("/knowledge")}
          className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 ${
            isDark
              ? "border-white/10 bg-white/5 text-zinc-300 shadow-sm hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-300"
              : "border-slate-300 bg-white text-slate-700 shadow-sm hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800"
          }`}
        >
          Search documents
        </button>

        <button
          onClick={() => handleChip("/projects")}
          className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 ${
            isDark
              ? "border-white/10 bg-white/5 text-zinc-300 shadow-sm hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-300"
              : "border-slate-300 bg-white text-slate-700 shadow-sm hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800"
          }`}
        >
          Search GitHub
        </button>

        <button
          onClick={() => handleChip("/chat")}
          className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 ${
            isDark
              ? "border-white/10 bg-white/5 text-zinc-300 shadow-sm hover:border-indigo-400/50 hover:bg-indigo-500/10 hover:text-indigo-300"
              : "border-slate-300 bg-white text-slate-700 shadow-sm hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800"
          }`}
        >
          Ask AI
        </button>

      </div>
    </div>
  );
}

export default SearchBox;
