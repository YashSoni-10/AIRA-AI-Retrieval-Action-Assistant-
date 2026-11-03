/**
 * Document Model
 * ==============
 * Stores metadata for every uploaded document.
 * Vectors live in Qdrant; this model tracks status, ownership, and stats.
 */
const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    workspace_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    filename: {
      type: String,
      required: true,
      trim: true,
    },
    original_filename: {
      type: String,
      required: true,
      trim: true,
    },
    file_type: {
      type: String,
      enum: [".pdf", ".txt", ".md", ".rst"],
      required: true,
    },
    file_size_bytes: {
      type: Number,
      required: true,
    },
    ingestion_status: {
      type: String,
      enum: ["pending", "processing", "indexed", "failed"],
      default: "pending",
      index: true,
    },
    chunk_count: {
      type: Number,
      default: 0,
    },
    vectors_stored: {
      type: Number,
      default: 0,
    },
    qdrant_collection: {
      type: String,
      default: "",
    },
    error_message: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// Compound indexes for efficient per-user/workspace queries
documentSchema.index({ user_id: 1, workspace_id: 1 });
documentSchema.index({ workspace_id: 1, createdAt: -1 });
documentSchema.index({ user_id: 1, filename: 1 });

module.exports = mongoose.model("Document", documentSchema);
