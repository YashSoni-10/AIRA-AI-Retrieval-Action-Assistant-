import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import {
  ingestDocument, listDocuments, listDocumentsFromBackend,
  deleteDocument, deleteDocumentById, getDocumentPreview,
  type IngestResponse, type BackendDocument,
  type DocumentPreviewResponse,
} from "../services/api";
import { getUser } from "../services/auth";
import { IconEye, IconRefreshCw, IconFileText, IconCheckCircle2, IconAlertCircle, IconAlertTriangle, IconSearch } from "../components/icons";

type UploadState = "idle" | "uploading" | "success" | "error";

// ── Confirmation dialog component ──────────────────────────────────────────────
interface ConfirmDialogProps {
  isDark: boolean;
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ isDark, filename, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      {/* Dialog */}
      <div
        className={`relative z-10 mx-4 w-full max-w-sm rounded-2xl border p-6 shadow-2xl ${
          isDark
            ? "border-white/15 bg-[#0d1117] text-white"
            : "border-slate-200 bg-white text-slate-900"
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-400/30 bg-red-500/10">
            <IconAlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h3
              id="confirm-title"
              className={`text-sm font-bold ${isDark ? "text-white" : "text-slate-900"}`}
            >
              Remove document?
            </h3>
            <p className={`mt-1.5 text-xs leading-5 ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
              Are you sure you want to remove{" "}
              <span className={`font-semibold ${isDark ? "text-white" : "text-slate-800"}`}>
                &ldquo;{filename}&rdquo;
              </span>
              ? Its indexed knowledge will also be deleted.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
              isDark
                ? "border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
                : "border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900"
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

function DocumentsPage() {
  const { theme } = useTheme();
  const user = getUser();
  const role = user?.role || "member";
  const canUpload = role === "admin" || role === "member";
  const canDelete = role === "admin" || role === "member";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadResult, setUploadResult] = useState<IngestResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [documents, setDocuments] = useState<BackendDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  // Confirmation dialog state
  const [confirmDoc, setConfirmDoc] = useState<BackendDocument | null>(null);

  // Document preview state (Phase 4C)
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, DocumentPreviewResponse>>({});
  const [previewError, setPreviewError] = useState<Record<string, string>>({});

  const togglePreview = async (filename: string) => {
    if (previewDoc === filename) {
      setPreviewDoc(null);
      return;
    }
    setPreviewDoc(filename);
    if (!previewData[filename] && previewLoading !== filename) {
      setPreviewLoading(filename);
      try {
        const data = await getDocumentPreview(filename);
        setPreviewData((prev) => ({ ...prev, [filename]: data }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load document preview";
        setPreviewError((prev) => ({ ...prev, [filename]: msg }));
      } finally {
        setPreviewLoading(null);
      }
    }
  };

  const fetchDocuments = useCallback(async () => {
    try {
      try {
        // Primary: Node backend — returns rich metadata
        const data = await listDocumentsFromBackend();
        if (data.success && data.documents.length > 0) {
          setDocuments(data.documents);
          return;
        }
      } catch { /* fall through to AI-service fallback */ }
      try {
        // Fallback: AI service ingest/list — only returns filenames
        const data = await listDocuments();
        // Normalise into BackendDocument shape with minimal fields
        const fallback: BackendDocument[] = data.documents.map((name) => ({
          _id: name,
          filename: name,
          original_filename: name,
          file_type: "." + (name.split(".").pop() ?? "file"),
          file_size_bytes: 0,
          ingestion_status: "indexed" as const,
          chunk_count: 0,
          vectors_stored: 0,
          createdAt: "",
        }));
        setDocuments(fallback);
      } catch {
        setDocuments([]);
      }
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

  /** Step 1: user clicks Remove → show confirmation dialog */
  const handleRemoveClick = (doc: BackendDocument) => {
    setDeleteError(null);
    setDeleteSuccess(null);
    setConfirmDoc(doc);
  };

  /** Step 2: user confirmed → delete from Qdrant (FastAPI) then MongoDB (Express) */
  const handleDeleteConfirmed = async () => {
    if (!confirmDoc) return;
    const doc = confirmDoc;
    setConfirmDoc(null);
    setDeletingFile(doc.filename);
    setDeleteError(null);
    setDeleteSuccess(null);

    try {
      // Phase A: Remove vectors from Qdrant via FastAPI
      await deleteDocument(doc.filename);
    } catch (err) {
      // Qdrant delete failed — do not proceed to MongoDB deletion;
      // the document is still searchable, keep the card.
      const msg = err instanceof Error ? err.message : "Failed to remove from knowledge base";
      setDeleteError(`Could not remove "${doc.filename}": ${msg}`);
      setDeletingFile(null);
      return;
    }

    // Phase B: Remove metadata record from MongoDB via Express backend.
    // Only attempt this when we have a real MongoDB _id (not the filename fallback).
    const hasMongoId = doc._id && doc._id !== doc.filename;
    if (hasMongoId) {
      try {
        await deleteDocumentById(doc._id);
      } catch (err) {
        // MongoDB cleanup failed — vectors are gone but metadata remains.
        // Log a warning; the list will still be refreshed so stale records
        // from MongoDB will surface but the document is no longer searchable.
        console.warn("MongoDB metadata delete failed for", doc._id, err);
      }
    }

    // Refresh list only after backend confirms deletion
    await fetchDocuments();
    setDeleteSuccess(`"${doc.original_filename || doc.filename}" removed successfully.`);
    setDeletingFile(null);

    // Auto-dismiss success banner after 4 s
    setTimeout(() => setDeleteSuccess(null), 4000);
  };

  const handleDeleteCancelled = () => {
    setConfirmDoc(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const filteredDocs = documents.filter((d) =>
    d.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Helpers for status display
  const statusBadge = (status: BackendDocument["ingestion_status"]) => {
    const map: Record<typeof status, { label: string; cls: string }> = {
      indexed:    { label: "Indexed",    cls: isDark ? "text-emerald-400 bg-emerald-500/10 border-emerald-400/30" : "text-emerald-700 bg-emerald-50 border-emerald-300" },
      processing: { label: "Processing", cls: isDark ? "text-amber-400 bg-amber-500/10 border-amber-400/30"     : "text-amber-700 bg-amber-50 border-amber-300" },
      failed:     { label: "Failed",     cls: isDark ? "text-red-400 bg-red-500/10 border-red-400/30"             : "text-red-700 bg-red-50 border-red-300" },
      pending:    { label: "Pending",    cls: isDark ? "text-zinc-400 bg-zinc-500/10 border-zinc-400/30"         : "text-slate-600 bg-slate-100 border-slate-300" },
    };
    const { label, cls } = map[status] ?? map.pending;
    return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
  };

  const formatBytes = (b: number) => {
    if (!b) return null;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isDark = theme === "dark";

  return (
    <div className="flex min-h-full flex-1 flex-col pt-16 md:pt-0">
      {/* Confirmation dialog */}
      {confirmDoc && (
        <ConfirmDialog
          isDark={isDark}
          filename={confirmDoc.original_filename || confirmDoc.filename}
          onConfirm={handleDeleteConfirmed}
          onCancel={handleDeleteCancelled}
        />
      )}

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
            <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
              Manage documents used by AIRA's knowledge system
            </p>
          </div>
          {canUpload && (
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
          )}
        </div>
      </div>

      {/* Main Content */}
      <main
        className={`relative flex-1 px-8 py-8 transition-colors duration-300 ${
          isDark ? "bg-[#060812]" : "bg-slate-50"
        }`}
      >
        <div className="mx-auto max-w-6xl">

          {/* Delete success banner */}
          {deleteSuccess && (
            <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${
              isDark ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
            }`}>
              <IconCheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <span>{deleteSuccess}</span>
            </div>
          )}

          {/* Delete error banner */}
          {deleteError && (
            <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${
              isDark ? "bg-red-500/10 text-red-300 border border-red-500/20" : "bg-red-50 text-red-700 border border-red-200"
            }`}>
              <IconAlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              <span>{deleteError}</span>
              <button
                type="button"
                onClick={() => setDeleteError(null)}
                className="ml-auto text-xs opacity-70 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          )}

          {/* Upload Area or View-only Notice */}
          {!canUpload ? (
            <div className={`rounded-2xl border p-6 text-center backdrop-blur-2xl ${
              isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white shadow-sm"
            }`}>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-500"><IconEye className="h-6 w-6" /></div>
              <h3 className={`mt-2 text-base font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
                View-Only Workspace
              </h3>
              <p className={`mt-1 text-xs ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                You are signed in as a Viewer. You can explore and search documents, but uploading or deleting documents requires Member or Admin permissions.
              </p>
            </div>
          ) : (
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
                  : "border-slate-300 bg-white hover:border-blue-400 shadow-sm hover:bg-slate-50/50"
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
              {uploadState === "uploading" ? <IconRefreshCw className="h-7 w-7 animate-spin text-cyan-400" /> : <IconFileText className="h-7 w-7" />}
            </div>

            <h3 className={`mt-4 text-lg font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
              {uploadState === "uploading" ? "Uploading & Indexing..." : "Upload your documents"}
            </h3>

            <p className={`mx-auto mt-2 max-w-md text-sm leading-6 ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
              {uploadState === "uploading"
                ? "Processing document and generating vector embeddings..."
                : "Drag & drop or click to upload. PDFs, TXT and Markdown supported."}
            </p>

            {uploadState === "success" && uploadResult && (
              <div className={`mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${
                isDark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-50 text-emerald-700"
              }`}>
                <IconCheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /><span>Indexed {uploadResult.vectors_stored} vectors from &ldquo;{uploadResult.filename}&rdquo;</span>
              </div>
            )}

            {uploadState === "error" && uploadError && (
              <div className={`mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${
                isDark ? "bg-red-500/10 text-red-300" : "bg-red-50 text-red-700"
              }`}>
                <IconAlertCircle className="h-4 w-4 shrink-0 text-red-500" /><span>{uploadError}</span>
              </div>
            )}

            <p className={`mt-3 text-xs ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
              Supported formats: PDF, TXT, MD · Max 10 MB
            </p>
          </div>
          )}

          {/* Search */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <div
              className={`flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 shadow-xl backdrop-blur-2xl ${
                isDark
                  ? "border-white/15 bg-white/[0.04] focus-within:border-cyan-400/50"
                  : "border-white/80 bg-white/50 focus-within:border-blue-500"
              }`}
            >
              <IconSearch className={`h-5 w-5 ${isDark ? "text-cyan-400" : "text-blue-600"}`} />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full bg-transparent text-sm outline-none ${
                  isDark ? "text-white placeholder:text-zinc-500" : "text-slate-900 placeholder:text-slate-500"
                }`}
              />
            </div>
          </div>

          {/* Documents List */}
          <div className="mt-6 space-y-3">
            {loadingDocs ? (
              <p className={`text-center text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                Loading documents...
              </p>
            ) : filteredDocs.length === 0 ? (
              <div className={`rounded-2xl border p-10 text-center backdrop-blur-2xl ${
                isDark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-white/40"
              }`}>
                <p className={`text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                  {searchQuery ? "No documents match your search." : "No documents indexed yet. Upload a file to get started."}
                </p>
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const isExpanded = previewDoc === doc.filename;
                const isLoading = previewLoading === doc.filename;
                const error = previewError[doc.filename];
                const data = previewData[doc.filename];

                return (
                  <div
                    key={doc._id ?? doc.filename}
                    className={`rounded-xl border backdrop-blur-2xl transition overflow-hidden ${
                      isDark
                        ? "border-white/15 bg-white/[0.04]"
                        : "border-white/80 bg-white/45 shadow-sm"
                    }`}
                  >
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border font-bold text-xs ${
                            isDark
                              ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-300"
                              : "border-blue-200 bg-blue-50 text-blue-600"
                          }`}
                        >
                          {doc.file_type.replace(".", "").toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h4 className={`text-sm font-semibold truncate ${isDark ? "text-white" : "text-slate-900"}`}>
                            {doc.original_filename || doc.filename}
                          </h4>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {statusBadge(doc.ingestion_status)}
                            {doc.chunk_count > 0 && (
                              <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                                {doc.chunk_count} chunks · {doc.vectors_stored} vectors
                              </span>
                            )}
                            {formatBytes(doc.file_size_bytes) && (
                              <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                                {formatBytes(doc.file_size_bytes)}
                              </span>
                            )}
                            {!doc.chunk_count && !doc.file_size_bytes && (
                              <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-slate-400"}`}>
                                Indexed in AIRA knowledge base
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Preview button */}
                        <button
                          type="button"
                          onClick={() => togglePreview(doc.filename)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                            isExpanded
                              ? isDark
                                ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-300"
                                : "border-blue-400 bg-blue-50 text-blue-700"
                              : isDark
                              ? "border-white/10 bg-white/5 text-zinc-300 hover:border-cyan-400/30 hover:text-white"
                              : "border-slate-200 bg-slate-100 text-slate-700 hover:border-blue-300 hover:text-slate-900"
                          }`}
                        >
                          {isExpanded ? "Hide Preview" : <span className="inline-flex items-center gap-1"><IconEye className="h-3 w-3" /><span>Preview</span></span>}
                        </button>

                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleRemoveClick(doc)}
                            disabled={deletingFile === doc.filename}
                            aria-label={`Remove ${doc.original_filename || doc.filename}`}
                            className={`text-xs font-semibold px-2 py-1 transition ${
                              isDark ? "text-red-400 hover:text-red-300" : "text-red-500 hover:text-red-700"
                            } disabled:opacity-50`}
                          >
                            {deletingFile === doc.filename ? "Removing…" : "Remove"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expandable Preview Panel */}
                    {isExpanded && (
                      <div
                        className={`border-t px-4 py-3 text-xs transition ${
                          isDark ? "border-white/10 bg-black/30" : "border-slate-200 bg-slate-50/70"
                        }`}
                      >
                        {isLoading ? (
                          <div className="flex items-center gap-2 py-4 justify-center text-zinc-400">
                            <span className="h-4 w-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                            <span>Loading document preview from knowledge base...</span>
                          </div>
                        ) : error ? (
                          <div className={`p-3 rounded-lg border ${
                            isDark ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-red-200 bg-red-50 text-red-700"
                          }`}>
                            <IconAlertTriangle className="h-4 w-4 inline mr-1 text-amber-500" /> {error}
                          </div>
                        ) : data && data.chunks && data.chunks.length > 0 ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between text-[11px] text-zinc-400">
                              <span className="font-semibold text-cyan-400">
                                Document Preview (first {data.chunks.length} chunks indexed):
                              </span>
                              <span>Total preview chunks: {data.total_chunks}</span>
                            </div>

                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                              {data.chunks.map((chunk, idx) => (
                                <div
                                  key={idx}
                                  className={`rounded-lg border p-3 ${
                                    isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200 bg-white"
                                  }`}
                                >
                                  <div className="flex items-center justify-between pb-1 mb-1 border-b border-white/5 text-[10px] text-zinc-400">
                                    <span className="font-mono font-bold text-cyan-300">
                                      Chunk #{chunk.chunk_index + 1}
                                    </span>
                                    {chunk.page_number && (
                                      <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px]">
                                        Page {chunk.page_number}
                                      </span>
                                    )}
                                  </div>
                                  <p className={`whitespace-pre-wrap font-mono leading-relaxed text-xs ${
                                    isDark ? "text-zinc-200" : "text-slate-800"
                                  }`}>
                                    {chunk.text}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="py-4 text-center text-zinc-400">
                            No readable preview text available for this document.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

        </div>
      </main>
    </div>
  );
}

export default DocumentsPage;
