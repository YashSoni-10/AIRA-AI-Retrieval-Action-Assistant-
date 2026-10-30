/**
 * Task Model
 * ==========
 * Persistent task/action-item storage for AIRA workspaces.
 *
 * Phase B implementation:
 *   - Full CRUD via /api/tasks
 *   - Workspace isolation via workspace_id (owner_id of the user's default workspace)
 *   - Role-based access:
 *       admin  → full management (create, read, update, delete any task in workspace)
 *       member → create, read, update own tasks; cannot delete others' tasks
 *       viewer → read-only
 *   - Agent-created tasks use source="agent" with conversation_id linkage
 *
 * Indexes:
 *   workspace_id + status    → dashboard queries
 *   workspace_id + created_by → "my tasks" queries
 *   workspace_id + updated_at → activity feed queries
 */

const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema(
  {
    workspace_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    assigned_to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ["todo", "in_progress", "completed", "cancelled"],
      default: "todo",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    due_date: {
      type: Date,
      default: null,
    },
    // How this task was created
    source: {
      type: String,
      enum: ["manual", "agent"],
      default: "manual",
    },
    // If created by the AI agent, link back to the conversation
    conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
  },
  { timestamps: true }
);

// ── Indexes ──────────────────────────────────────────────────────────────────
taskSchema.index({ workspace_id: 1, status: 1 });
taskSchema.index({ workspace_id: 1, created_by: 1 });
taskSchema.index({ workspace_id: 1, updatedAt: -1 });

module.exports = mongoose.model("Task", taskSchema);
