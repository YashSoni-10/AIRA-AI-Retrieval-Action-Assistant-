/**
 * Workspace Controller
 * ====================
 * GET  /api/workspace/me       — Get or create the user's default workspace
 * GET  /api/workspace/:id      — Get a specific workspace (must be owner)
 */
const Workspace = require("../models/Workspace");
const mongoose = require("mongoose");

let dbConnectedOverride = null;
const isConnected = () => (dbConnectedOverride !== null ? dbConnectedOverride : mongoose.connection.readyState === 1);
exports._setConnected = (val) => { dbConnectedOverride = val; };

/**
 * Get or create the authenticated user's default workspace.
 * Phase 1: every user has exactly one default workspace.
 */
exports.getOrCreateDefaultWorkspace = async (req, res) => {
  try {
    if (!isConnected()) {
      // In-memory mode: return a synthetic workspace based on user id
      return res.status(200).json({
        success: true,
        workspace: {
          _id: req.user._id || req.user.id,
          name: "Default Workspace",
          owner_id: req.user._id || req.user.id,
          is_default: true,
          description: "(In-Memory Mode)",
          settings: { max_file_size_mb: 10, allowed_file_types: [".pdf", ".txt", ".md", ".rst"] },
        },
      });
    }

    const userId = req.user._id || req.user.id;
    let workspace = await Workspace.findOne({ owner_id: userId, is_default: true });

    if (!workspace) {
      workspace = await Workspace.create({
        name: `${req.user.name || "My"} Workspace`,
        owner_id: userId,
        is_default: true,
        description: "Your default AIRA workspace",
      });
    }

    res.status(200).json({ success: true, workspace });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not retrieve workspace", code: "WORKSPACE_ERROR" });
  }
};

/**
 * Get a workspace by ID — only the owner can access it.
 */
exports.getWorkspaceById = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }

    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace not found", code: "NOT_FOUND" });
    }

    const userId = (req.user._id || req.user.id).toString();
    if (workspace.owner_id.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Access denied", code: "FORBIDDEN" });
    }

    res.status(200).json({ success: true, workspace });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(400).json({ success: false, message: "Invalid workspace ID", code: "INVALID_ID" });
    }
    res.status(500).json({ success: false, message: "Could not retrieve workspace", code: "WORKSPACE_ERROR" });
  }
};

/**
 * Update workspace settings — Admin only.
 * PATCH /api/workspace/:id/settings
 */
exports.updateWorkspaceSettings = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid workspace ID", code: "INVALID_ID" });
    }

    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace not found", code: "NOT_FOUND" });
    }

    const userId = (req.user._id || req.user.id).toString();
    // Validate workspace boundary: Admin must own or be authorized on the workspace
    if (workspace.owner_id.toString() !== userId && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied", code: "FORBIDDEN" });
    }

    const { name, description, settings } = req.body;
    if (name && typeof name === "string") workspace.name = name.trim().slice(0, 100);
    if (description !== undefined && typeof description === "string") workspace.description = description.trim().slice(0, 500);
    if (settings && typeof settings === "object") {
      if (settings.max_file_size_mb !== undefined) {
        const mb = Number(settings.max_file_size_mb);
        if (!isNaN(mb) && mb >= 1 && mb <= 100) workspace.settings.max_file_size_mb = mb;
      }
      if (Array.isArray(settings.allowed_file_types)) {
        workspace.settings.allowed_file_types = settings.allowed_file_types.filter(t => typeof t === "string" && t.startsWith("."));
      }
    }

    await workspace.save();
    res.status(200).json({ success: true, workspace });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not update workspace settings", code: "UPDATE_ERROR" });
  }
};

/**
 * GET /api/workspace/members
 * Returns a list of workspace members for the assignee dropdown.
 * All authenticated roles can call this (needed by member/viewer for assignee display).
 * Returns { _id, name, role } for all roles; adds email for admin callers only.
 */
exports.getWorkspaceMembers = async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }

    const User = require("../models/User");
    const isAdmin = req.user.role === "admin";

    // Select fields: everyone gets _id/name/role; admins also get email
    const selectFields = isAdmin ? "_id name email role isActive" : "_id name role";

    const members = await User.find({ isActive: { $ne: false } })
      .select(selectFields)
      .sort({ name: 1 })
      .lean();

    res.status(200).json({ success: true, members, count: members.length });
  } catch (err) {
    res.status(500).json({ success: false, message: "Could not retrieve workspace members", code: "MEMBERS_ERROR" });
  }
};


