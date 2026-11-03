/**
 * Conversation Model
 * ==================
 * A conversation groups a series of chat messages for a user/workspace.
 */
const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
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
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      default: "New Conversation",
    },
    message_count: {
      type: Number,
      default: 0,
    },
    last_message_at: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

conversationSchema.index({ user_id: 1, workspace_id: 1, updatedAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
