/**
 * Conversation Controller
 * =======================
 * POST   /api/conversations              — Create a new conversation
 * GET    /api/conversations              — List user's conversations
 * GET    /api/conversations/:id          — Get one conversation
 * DELETE /api/conversations/:id          — Delete a conversation and its messages
 * POST   /api/conversations/:id/messages — Save a message to a conversation
 * GET    /api/conversations/:id/messages — Get messages for a conversation
 */
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Workspace = require("../models/Workspace");
const mongoose = require("mongoose");

const isConnected = () => mongoose.connection.readyState === 1;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUserId(req) {
  return req.user._id || req.user.id;
}

async function assertOwnsConversation(conversationId, userId, res) {
  if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
    res.status(400).json({ success: false, message: "Invalid conversation ID", code: "INVALID_ID" });
    return null;
  }
  const conv = await Conversation.findById(conversationId);
  if (!conv) {
    res.status(404).json({ success: false, message: "Conversation not found", code: "NOT_FOUND" });
    return null;
  }
  if (conv.user_id.toString() !== userId.toString()) {
    res.status(403).json({ success: false, message: "Access denied", code: "FORBIDDEN" });
    return null;
  }
  return conv;
}

// ── Create Conversation ───────────────────────────────────────────────────────

exports.createConversation = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }

    const userId = getUserId(req);
    const { title, workspace_id } = req.body;

    // Resolve workspace: use provided or find default
    let wsId = workspace_id;
    if (!wsId) {
      const ws = await Workspace.findOne({ owner_id: userId, is_default: true });
      wsId = ws ? ws._id : userId; // fallback: use user_id as workspace_id
    } else {
      // Verify workspace belongs to user
      const ws = await Workspace.findById(wsId);
      if (!ws || ws.owner_id.toString() !== userId.toString()) {
        return res.status(403).json({ success: false, message: "Invalid workspace", code: "FORBIDDEN" });
      }
    }

    const conversation = await Conversation.create({
      user_id: userId,
      workspace_id: wsId,
      title: (title || "New Conversation").trim().substring(0, 200),
    });

    res.status(201).json({ success: true, conversation });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not create conversation", code: "CREATE_ERROR" });
  }
};

// ── List Conversations ────────────────────────────────────────────────────────

exports.listConversations = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(200).json({ success: true, conversations: [], count: 0 });
    }

    const userId = getUserId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [conversations, total] = await Promise.all([
      Conversation.find({ user_id: userId })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Conversation.countDocuments({ user_id: userId }),
    ]);

    res.status(200).json({ success: true, conversations, total, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not list conversations", code: "LIST_ERROR" });
  }
};

// ── Get One Conversation ──────────────────────────────────────────────────────

exports.getConversation = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }
    const userId = getUserId(req).toString();
    const conv = await assertOwnsConversation(req.params.id, userId, res);
    if (!conv) return;
    res.status(200).json({ success: true, conversation: conv });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid conversation ID", code: "INVALID_ID" });
    }
    res.status(500).json({ success: false, message: "Could not get conversation", code: "GET_ERROR" });
  }
};

// ── Delete Conversation ───────────────────────────────────────────────────────

exports.deleteConversation = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }
    const userId = getUserId(req).toString();
    const conv = await assertOwnsConversation(req.params.id, userId, res);
    if (!conv) return;

    await Promise.all([
      Message.deleteMany({ conversation_id: conv._id }),
      Conversation.findByIdAndDelete(conv._id),
    ]);

    res.status(200).json({ success: true, message: "Conversation deleted" });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid conversation ID", code: "INVALID_ID" });
    }
    res.status(500).json({ success: false, message: "Could not delete conversation", code: "DELETE_ERROR" });
  }
};

// ── Clear All Conversations ───────────────────────────────────────────────────

exports.clearAllConversations = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }

    const userId = getUserId(req);
    const filter = { user_id: userId };

    if (req.query.workspace_id) {
      if (mongoose.Types.ObjectId.isValid(req.query.workspace_id)) {
        filter.workspace_id = req.query.workspace_id;
      }
    }

    // Find all matching conversations belonging to this user
    const userConvs = await Conversation.find(filter).select("_id").lean();
    if (userConvs.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No conversations to clear",
        deletedCount: 0,
        messagesDeletedCount: 0,
      });
    }

    const convIds = userConvs.map((c) => c._id);

    // Delete associated messages strictly for these conversation IDs and user's conversations
    const [msgResult, convResult] = await Promise.all([
      Message.deleteMany({ conversation_id: { $in: convIds } }),
      Conversation.deleteMany({ _id: { $in: convIds }, user_id: userId }),
    ]);

    res.status(200).json({
      success: true,
      message: "Chat history cleared successfully",
      deletedCount: convResult.deletedCount,
      messagesDeletedCount: msgResult.deletedCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not clear chat history", code: "CLEAR_ERROR" });
  }
};

// ── Save Message ──────────────────────────────────────────────────────────────

exports.saveMessage = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }
    const userId = getUserId(req).toString();
    const conv = await assertOwnsConversation(req.params.id, userId, res);
    if (!conv) return;

    const { role, content, sources, meta } = req.body;

    if (!role || !["user", "assistant", "system"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role", code: "INVALID_ROLE" });
    }
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ success: false, message: "Content is required", code: "INVALID_CONTENT" });
    }

    // Deduplication check: if identical message was saved in the last 5 seconds, return it
    const recentDuplicate = await Message.findOne({
      conversation_id: conv._id,
      role,
      content: content.trim(),
      createdAt: { $gte: new Date(Date.now() - 5000) },
    }).lean();

    if (recentDuplicate) {
      return res.status(200).json({ success: true, message: recentDuplicate, deduplicated: true });
    }

    const message = await Message.create({
      conversation_id: conv._id,
      user_id: userId,
      role,
      content: content.trim(),
      sources: sources || [],
      meta: meta || {},
    });

    // Update conversation stats
    await Conversation.findByIdAndUpdate(conv._id, {
      $inc: { message_count: 1 },
      last_message_at: new Date(),
      // Auto-title from first user message (up to 80 chars)
      ...(conv.message_count === 0 && role === "user"
        ? { title: content.trim().substring(0, 80) }
        : {}),
    });

    res.status(201).json({ success: true, message });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid conversation ID", code: "INVALID_ID" });
    }
    res.status(500).json({ success: false, message: "Could not save message", code: "SAVE_ERROR" });
  }
};

// ── Get Messages ──────────────────────────────────────────────────────────────

exports.getMessages = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(200).json({ success: true, messages: [], count: 0 });
    }
    const userId = getUserId(req).toString();
    const conv = await assertOwnsConversation(req.params.id, userId, res);
    if (!conv) return;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      Message.find({ conversation_id: conv._id })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Message.countDocuments({ conversation_id: conv._id }),
    ]);

    res.status(200).json({ success: true, messages, total, page, limit });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid conversation ID", code: "INVALID_ID" });
    }
    res.status(500).json({ success: false, message: "Could not get messages", code: "GET_ERROR" });
  }
};
