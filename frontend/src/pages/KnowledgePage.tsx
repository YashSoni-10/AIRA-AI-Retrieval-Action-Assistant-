import { useCallback, useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { searchKnowledge, listDocuments, type SearchResult } from "../services/api";
import { IconSearch, IconFileText } from "../components/icons";

function KnowledgePage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(8);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [documents, setDocuments] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [docCount, setDocCount] = useState(0);

  const fetchDocs = useCallback(async () => {
    try {
      const data = await listDocuments();
      setDocuments(data.documents);
      setDocCount(data.count);
    } catch {
      setDocuments([]);
    }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const runSearch = async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    setHasSearched(true);
    try {
      const data = await searchKnowledge(query.trim(), topK);
      setResults(data.results);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const scoreColor = (score: number) => {
    const s = score > 1.0 ? score / 10.0 : score;
    if (s >= 0.75) return isDark ? "text-emerald-400 bg-emerald-500/10 border-emerald-400/20" : "text-emerald-700 bg-emerald-50 border-emerald-200";
    if (s >= 0.45) return isDark ? "text-amber-400 bg-amber-500/10 border-amber-400/20" : "text-amber-700 bg-amber-50 border-amber-200";
    return isDark ? "text-red-400 bg-red-500/10 border-red-400/20" : "text-red-700 bg-red-50 border-red-200";
  };

  const formatScore = (r: { score: number; score_label?: string; score_type?: string }, idx: number) => {
    if (r.score_label && r.score_label.trim()) return r.score_label;
    if (r.score_type === "rrf" || r.score_type === "rank") return `Rank #${idx + 1}`;
    if (typeof r.score === "number" && !isNaN(r.score)) {
      if (r.score > 1.0 || r.score < 0.0) return `Score: ${r.score.toFixed(2)}`;
      return `${Math.round(r.score * 100)}% Match`;
    }
    return `Rank #${idx + 1}`;
  };

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">

      {/* Header */}
      <div className={`border-b px-5 py-5 backdrop-blur-xl transition-colors duration-300 sm:px-8 ${
        isDark ? "border-white/10 bg-[#090a13]/80 text-white" : "border-slate-200/80 bg-white/80 text-slate-900 shadow-sm"
      }`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>Knowledge Base</h2>
            <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
              Semantic search across {docCount} indexed document{docCount !== 1 ? "s" : ""}
            </p>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            docCount > 0
              ? isDark ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-emerald-300 bg-emerald-50 text-emerald-700"
              : isDark ? "border-white/10 text-zinc-400" : "border-slate-200 text-slate-400"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${docCount > 0 ? "bg-emerald-400 animate-pulse" : "bg-zinc-400"}`} />
            {docCount > 0 ? `${docCount} docs indexed` : "No docs yet"}
          </div>
        </div>
      </div>

      <main className={`relative flex-1 px-5 py-6 transition-colors duration-300 sm:px-8 sm:py-8 ${isDark ? "bg-[#060812]" : "bg-slate-50"}`}>
        <div className="mx-auto max-w-4xl space-y-6">

          {/* Search Bar */}
          <div className={`flex gap-3 rounded-2xl border p-3 shadow-xl backdrop-blur-2xl ${
            isDark ? "border-white/15 bg-white/[0.04] focus-within:border-cyan-400/50" : "border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 shadow-sm"
          }`}>
            <IconSearch className={`mt-1 h-5 w-5 shrink-0 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              placeholder="Search your knowledge base semantically..."
              className={`flex-1 bg-transparent py-2 text-sm outline-none ${
                isDark ? "text-white placeholder:text-zinc-500" : "text-slate-900 placeholder:text-slate-500"
              }`}
            />
            <button
              onClick={runSearch}
              disabled={!query.trim() || searching}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition hover:brightness-110 disabled:opacity-40 ${
                isDark
                  ? "bg-gradient-to-r from-cyan-400 to-blue-500 text-white"
                  : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm"
              }`}
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </div>

          {/* Top-K slider */}
          <div className={`flex items-center gap-3 rounded-2xl border px-5 py-3 ${
            isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white shadow-sm"
          }`}>
            <span className={`shrink-0 text-xs font-semibold ${ isDark ? "text-zinc-400" : "text-slate-600"}`}>
              Results: <span className={`font-bold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>{topK}</span>
            </span>
            <input
              type="range" min={1} max={20} step={1}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="flex-1 accent-cyan-400"
              title={`Return top ${topK} results`}
            />
            <span className={`shrink-0 text-[10px] ${isDark ? "text-zinc-600" : "text-slate-400"}`}>1 – 20</span>
          </div>

          {/* Indexed Documents sidebar chips */}
          {documents.length > 0 && (
            <div>
              <p className={`mb-2 text-xs font-semibold ${isDark ? "text-zinc-500" : "text-slate-600"}`}>
                Indexed documents
              </p>
              <div className="flex flex-wrap gap-2">
                {documents.map((doc) => (
                  <button
                    key={doc}
                    onClick={() => { setQuery(doc); }}
                    className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                      isDark ? "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-cyan-400/40 hover:text-cyan-400" : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600 shadow-sm"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5"><IconFileText className="h-3.5 w-3.5" /><span>{doc}</span></span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          {searching && (
            <div className="flex items-center gap-3 py-8 justify-center">
              <div className={`h-6 w-6 animate-spin rounded-full border-2 border-t-transparent ${isDark ? "border-cyan-400" : "border-blue-600"}`} />
              <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>Searching knowledge base...</p>
            </div>
          )}

          {!searching && hasSearched && results.length === 0 && (
            <div className={`rounded-2xl border p-10 text-center ${isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white shadow-sm"}`}>
              <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                No results found for "{query}". Try different keywords or upload more documents.
              </p>
            </div>
          )}

          {!searching && results.length > 0 && (
            <div>
              <p className={`mb-3 text-xs font-semibold ${isDark ? "text-zinc-500" : "text-slate-600"}`}>
                {results.length} results for "{query}"
              </p>
              <div className="space-y-3">
                {results.map((r, i) => (
                  <div key={i} className={`rounded-2xl border p-5 backdrop-blur-2xl transition hover:-translate-y-0.5 ${
                    isDark ? "border-white/10 bg-white/[0.04] hover:border-cyan-400/30 hover:bg-white/[0.07]" : "border-slate-200 bg-white hover:border-blue-300 shadow-sm hover:shadow-md"
                  }`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <IconFileText className="h-4 w-4 shrink-0" />
                        <span className={`truncate text-xs font-semibold ${isDark ? "text-cyan-400" : "text-blue-600"}`}>
                          {r.filename}
                        </span>
                        <span className={`shrink-0 text-xs ${isDark ? "text-zinc-600" : "text-slate-400"}`}>
                          chunk {r.chunk_index}
                        </span>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${scoreColor(r.score)}`}>
                        {formatScore(r, i)}
                      </span>
                    </div>
                    <p className={`mt-3 text-sm leading-6 ${isDark ? "text-zinc-300" : "text-slate-700"}`}>
                      {r.text.length > 400 ? r.text.slice(0, 400) + "..." : r.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state — no search yet */}
          {!hasSearched && (
            <div className={`rounded-2xl border p-12 text-center backdrop-blur-2xl ${
              isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white shadow-sm"
            }`}>
              <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border text-3xl ${
                isDark ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-300" : "border-blue-200 bg-blue-50 text-blue-600"
              }`}>
                <IconSearch className="h-8 w-8" />
              </div>
              <h3 className={`mt-4 text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                Semantic Knowledge Search
              </h3>
              <p className={`mx-auto mt-2 max-w-sm text-sm leading-6 ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                Search across all your indexed documents using natural language. Results are ranked by semantic similarity.
              </p>
              {documents.length === 0 && (
                <p className={`mt-3 text-xs ${isDark ? "text-zinc-600" : "text-slate-400"}`}>
                  No documents indexed yet. Upload files in the Documents page first.
                </p>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default KnowledgePage;
