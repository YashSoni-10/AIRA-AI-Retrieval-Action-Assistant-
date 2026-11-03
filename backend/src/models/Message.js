/**
 * Message Model
 * =============
 * Stores individual messages within a conversation.
 */
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    // For assistant messages: RAG citations/sources
    sources: {
      type: [
        {
          filename: String,
          chunk_index: Number,
          excerpt: String,
          score: Number,
          page_number: Number,
          score_label: String,
          raw_score: Number,
          score_type: String,
        },
      ],
      default: [],
    },
    // Metadata (confidence, etc.)
    meta: {
      confidence: { type: Number, default: null },
      confidence_label: { type: String, default: null },
      chunks_found: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

messageSchema.index({ conversation_id: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);
