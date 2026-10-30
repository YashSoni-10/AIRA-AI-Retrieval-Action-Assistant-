/**
 * Workspace Model
 * ===============
 * A workspace groups documents and conversations for a user.
 * Phase 1: each user gets exactly one default workspace (id = user._id).
 * Phase 2 will add team/shared workspaces.
 */
const mongoose = require("mongoose");

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, default: "Default Workspace" },
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    is_default: { type: Boolean, default: true },
    description: { type: String, default: "" },
    settings: {
      max_file_size_mb: { type: Number, default: 10 },
      allowed_file_types: { type: [String], default: [".pdf", ".txt", ".md", ".rst"] },
    },
  },
  { timestamps: true }
);

workspaceSchema.index({ owner_id: 1, is_default: 1 });

module.exports = mongoose.model("Workspace", workspaceSchema);
