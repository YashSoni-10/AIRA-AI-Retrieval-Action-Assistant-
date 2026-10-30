/**
 * Document Controller
 * ===================
 * Handles CRUD for document metadata records stored in MongoDB.
 * Vectors live in Qdrant; this controller only manages metadata.
 *
 * Endpoints:
 *   POST   /api/documents              — Create a document record (called by AI service after ingestion)
 *   GET    /api/documents              — List user's documents with ingestion status
 *   GET    /api/documents/:id          — Get one document record
 *   PATCH  /api/documents/:id/status   — Update ingestion status
 *   DELETE /api/documents/:id          — Delete document record
 *
 * Internal endpoint (AI-service-to-backend call):
 *   POST /api/documents/internal/create — Requires INTERNAL_API_KEY header instead of JWT
 *   (Used by FastAPI ingest endpoint to record document metadata without a user JWT)
 */
const Document = require("../models/Document");
const Workspace = require("../models/Workspace");
const mongoose = require("mongoose");

const isConnected = () => mongoose.connection.readyState === 1;

// ── Create Document Record ────────────────────────────────────────────────────

/**
 * POST /api/documents
 * Creates a document metadata record in MongoDB.
 * Accepts: { filename, original_filename, file_type, file_size_bytes,
 *             chunk_count, vectors_stored, document_id, workspace_id? }
 */
exports.createDocument = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }

    const userId = req.user._id || req.user.id;
    const {
      filename,
      original_filename,
      file_type,
      file_size_bytes,
      chunk_count,
      vectors_stored,
      document_id,
      workspace_id,
    } = req.body;

    if (!filename || !file_type || !file_size_bytes) {
      return res.status(400).json({ success: false, message: "filename, file_type, file_size_bytes are required" });
    }

    // Resolve workspace
    let wsId = workspace_id;
    if (!wsId) {
      const ws = await Workspace.findOne({ owner_id: userId, is_default: true });
      wsId = ws ? ws._id : userId;
    }

    // Remove any previous document record for this filename + user (on re-upload)
    await Document.deleteMany({ user_id: userId, filename });

    const doc = await Document.create({
      user_id: userId,
      workspace_id: wsId,
      filename,
      original_filename: original_filename || filename,
      file_type: file_type.startsWith(".") ? file_type : `.${file_type}`,
      file_size_bytes: Number(file_size_bytes),
      ingestion_status: "indexed",
      chunk_count: Number(chunk_count) || 0,
      vectors_stored: Number(vectors_stored) || 0,
      qdrant_collection: process.env.QDRANT_COLLECTION || "aira_knowledge",
      error_message: "",
    });

    // If a specific document_id was provided by Qdrant, note it in a comment field
    // (we don't have a dedicated field for Qdrant document_id, but we log it)
    if (document_id) {
      doc._qdrant_document_id = document_id; // transient, not persisted
    }

    res.status(201).json({ success: true, document: doc });
  } catch (err) {
    console.error("createDocument error:", err.message);
    res.status(500).json({ success: false, message: "Could not create document record", code: "CREATE_ERROR" });
  }
};

// ── List Documents ────────────────────────────────────────────────────────────

exports.listDocuments = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(200).json({ success: true, documents: [], count: 0 });
    }

    const userId = req.user._id || req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [documents, total] = await Promise.all([
      Document.find({ user_id: userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Document.countDocuments({ user_id: userId }),
    ]);

    res.status(200).json({ success: true, documents, total, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not list documents", code: "LIST_ERROR" });
  }
};

// ── Get One Document ──────────────────────────────────────────────────────────

exports.getDocument = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }

    const userId = (req.user._id || req.user.id).toString();
    const doc = await Document.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found", code: "NOT_FOUND" });
    }
    if (doc.user_id.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Access denied", code: "FORBIDDEN" });
    }

    res.status(200).json({ success: true, document: doc });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid document ID", code: "INVALID_ID" });
    }
    res.status(500).json({ success: false, message: "Could not get document", code: "GET_ERROR" });
  }
};

// ── Update Status ─────────────────────────────────────────────────────────────

exports.updateDocumentStatus = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }

    const userId = (req.user._id || req.user.id).toString();
    const doc = await Document.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found", code: "NOT_FOUND" });
    }
    if (doc.user_id.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Access denied", code: "FORBIDDEN" });
    }

    const { ingestion_status, chunk_count, vectors_stored, error_message } = req.body;
    const allowed = ["pending", "processing", "indexed", "failed"];

    if (ingestion_status && !allowed.includes(ingestion_status)) {
      return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${allowed.join(", ")}` });
    }

    if (ingestion_status) doc.ingestion_status = ingestion_status;
    if (chunk_count !== undefined) doc.chunk_count = Number(chunk_count);
    if (vectors_stored !== undefined) doc.vectors_stored = Number(vectors_stored);
    if (error_message !== undefined) doc.error_message = error_message;

    await doc.save();
    res.status(200).json({ success: true, document: doc });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid document ID", code: "INVALID_ID" });
    }
    res.status(500).json({ success: false, message: "Could not update document", code: "UPDATE_ERROR" });
  }
};

// ── Delete Document Record ────────────────────────────────────────────────────

exports.deleteDocument = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }

    const userId = (req.user._id || req.user.id).toString();
    const doc = await Document.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found", code: "NOT_FOUND" });
    }
    if (doc.user_id.toString() !== userId && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied", code: "FORBIDDEN" });
    }

    await Document.findByIdAndDelete(doc._id);
    res.status(200).json({ success: true, message: "Document record deleted" });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid document ID", code: "INVALID_ID" });
    }
    res.status(500).json({ success: false, message: "Could not delete document", code: "DELETE_ERROR" });
  }
};
