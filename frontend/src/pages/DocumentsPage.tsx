import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { ingestDocument, listDocuments, deleteDocument, type IngestResponse } from "../services/api";

interface UploadedDoc {
  name: string;
  type: string;
}

type UploadState = "idle" | "uploading" | "success" | "error";

function DocumentsPage() {
  const { theme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadResult, setUploadResult] = useState<IngestResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const data = await listDocuments();
      setDocuments(data.documents.map((name) => ({
        name,
        type: name.split(".").pop()?.toUpperCase() ?? "FILE",
      })));
    } catch {
      setDocuments([]);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setUploadState("uploading");
    setUploadError(null);
    setUploadResult(null);
    try {
      const result = await ingestDocument(file);
      setUploadResult(result);
      setUploadState("success");
      await fetchDocuments();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setUploadState("error");
    }
  };

  const handleDelete = async (filename: string) => {
    setDeletingFile(filename);
    try {
      await deleteDocument(filename);
      await fetchDocuments();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingFile(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const filteredDocs = documents.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isDark = theme === "dark";

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">
      {/* Page Header */}
      <div
        className={`border-b px-8 py-5 backdrop-blur-xl transition-colors duration-300 ${
          isDark
            ? "border-white/10 bg-[#090b15]/80 text-white"
            : "border-slate-200/80 bg-white/80 text-slate-900 shadow-sm"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
              Documents
            </h2>
            <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
              Manage documents used by AIRA's knowledge system
            </p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-xl px-4 py-2.5 text-sm font-bold shadow-lg transition hover:brightness-110 ${
              isDark
                ? "bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 text-white"
                : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white"
            }`}
          >
            + Upload Document
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main
        className={`relative flex-1 px-8 py-8 transition-colors duration-300 ${
          isDark ? "bg-[#060812]" : "bg-slate-50"
        }`}
      >
        <div className="mx-auto max-w-6xl">

          {/* Upload Area */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center backdrop-blur-2xl transition ${
              isDragging
                ? isDark
                  ? "border-cyan-400/70 bg-cyan-500/10"
                  : "border-blue-500 bg-blue-50"
                : isDark
                ? "border-white/15 bg-white/[0.03] hover:border-cyan-400/40 hover:bg-white/[0.05]"
                : "border-slate-300 bg-white/45 hover:border-blue-400 shadow-sm hover:bg-white/65"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.rst"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
            />

            <div
              className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl ${
                isDark
                  ? "border-cyan-400/30 bg-cyan-500/20 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.2)]"
                  : "border-blue-200 bg-blue-50 text-blue-600 shadow-md shadow-blue-100"
              }`}
            >
              {uploadState === "uploading" ? "⏳" : "📄"}
            </div>

            <h3 className={`mt-4 text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
              {uploadState === "uploading" ? "Uploading & Indexing..." : "Upload your documents"}
            </h3>

            <p className={`mx-auto mt-2 max-w-md text-sm leading-6 ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
              {uploadState === "uploading"
                ? "Processing document and generating vector embeddings..."
                : "Drag & drop or click to upload. PDFs, TXT and Markdown supported."}
            </p>

            {uploadState === "success" && uploadResult && (
              <div className={`mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${
                isDark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-50 text-emerald-700"
              }`}>
                ✅ Indexed {uploadResult.vectors_stored} vectors from "{uploadResult.filename}"
              </div>
            )}

            {uploadState === "error" && uploadError && (
              <div className={`mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${
                isDark ? "bg-red-500/10 text-red-300" : "bg-red-50 text-red-700"
              }`}>
                ❌ {uploadError}
              </div>
            )}

            <p className={`mt-3 text-xs ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
              Supported formats: PDF, TXT, MD · Max 10 MB
            </p>
          </div>

          {/* Search */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <div
              className={`flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur-2xl ${
                isDark
                  ? "border-white/15 bg-white/[0.04] focus-within:border-cyan-400/50"
                  : "border-white/80 bg-white/50 focus-within:border-blue-500"
              }`}
            >
              <span className={isDark ? "text-cyan-400" : "text-blue-600"}>🔍</span>
              <input
                type="text"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full bg-transparent text-sm outline-none ${
                  isDark ? "text-white placeholder:text-zinc-500" : "text-slate-900 placeholder:text-slate-400"
                }`}
              />
            </div>
          </div>

          {/* Documents List */}
          <div className="mt-6 space-y-3">
            {loadingDocs ? (
              <p className={`text-center text-sm ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                Loading documents...
              </p>
            ) : filteredDocs.length === 0 ? (
              <div className={`rounded-2xl border p-10 text-center backdrop-blur-2xl ${
                isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white/40"
              }`}>
                <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-500"}`}>
                  {searchQuery ? "No documents match your search." : "No documents indexed yet. Upload a file to get started."}
                </p>
              </div>
            ) : (
              filteredDocs.map((doc) => (
                <div
                  key={doc.name}
                  className={`flex items-center justify-between rounded-xl border p-4 backdrop-blur-2xl transition hover:-translate-y-0.5 ${
                    isDark
                      ? "border-white/15 bg-white/[0.04] hover:border-cyan-400/40 hover:bg-white/[0.07]"
                      : "border-white/80 bg-white/45 hover:border-blue-300 hover:bg-white/70 hover:shadow-md"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border font-bold text-xs ${
                        isDark
                          ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-300"
                          : "border-blue-200 bg-blue-50 text-blue-600"
                      }`}
                    >
                      {doc.type}
                    </div>
                    <div>
                      <h4 className={`text-sm font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
                        {doc.name}
                      </h4>
                      <p className={`text-xs ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                        Indexed in AIRA knowledge base
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(doc.name)}
                    disabled={deletingFile === doc.name}
                    className={`text-xs font-semibold transition ${
                      isDark ? "text-red-400 hover:text-red-300" : "text-red-500 hover:text-red-700"
                    } disabled:opacity-50`}
                  >
                    {deletingFile === doc.name ? "Removing..." : "Remove"}
                  </button>
                </div>
              ))
            )}
          </div>

        </div>
      </main>
    </div>
  );
}

export default DocumentsPage;
