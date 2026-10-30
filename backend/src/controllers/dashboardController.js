/**
 * Dashboard Controller
 * ====================
 * Aggregates real statistics from MongoDB for the role-based dashboard.
 * Metrics are filtered and shaped strictly by caller's role (admin, member, viewer).
 * Never fabricates numbers.
 */
const User = require("../models/User");
const Document = require("../models/Document");
const Conversation = require("../models/Conversation");
const Workspace = require("../models/Workspace");
const GitHubConnection = require("../models/GitHubConnection");
const Task = require("../models/Task");
const mongoose = require("mongoose");

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

// GET /api/dashboard/stats
exports.getStats = async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        message: "Database not connected",
        code: "DB_UNAVAILABLE",
      });
    }

    const userId = req.user._id || req.user.id;
    const role = req.user.role || "member";

    // Resolve active workspace
    let ws = await Workspace.findOne({ owner_id: userId, is_default: true });
    if (!ws) {
      ws = await Workspace.findOne({ owner_id: userId });
    }
    const wsId = ws ? ws._id : null;

    // Workspace GitHub Connection
    let githubConn = null;
    if (wsId) {
      githubConn = await GitHubConnection.findOne({ workspace_id: wsId, status: "connected" });
    }

    const baseGitHubStats = {
      githubConnected: !!githubConn,
      githubUsername: githubConn ? githubConn.github_username : null,
      avatarUrl: githubConn ? githubConn.avatar_url : null,
      status: githubConn ? githubConn.status : "disconnected",
    };

    const docFilter = wsId ? { workspace_id: wsId } : { user_id: userId };
    const taskFilter = wsId ? { workspace_id: wsId } : { created_by: userId };

    // Fetch real recent activity items (documents, tasks, conversations)
    const [recentDocs, recentTasks, recentConvs] = await Promise.all([
      Document.find(docFilter).sort({ createdAt: -1 }).limit(3).select("filename originalName createdAt").lean(),
      Task.find(taskFilter).sort({ createdAt: -1 }).limit(3).select("title status priority createdAt").lean(),
      Conversation.find({ user_id: userId }).sort({ updatedAt: -1 }).limit(3).select("title updatedAt").lean(),
    ]);

    const activityList = [];
    (recentDocs || []).forEach((d) => {
      activityList.push({
        id: String(d._id),
        type: "document",
        icon: "📄",
        title: "Document indexed",
        detail: d.originalName || d.filename || "Uploaded file",
        timestamp: d.createdAt,
      });
    });
    (recentTasks || []).forEach((t) => {
      activityList.push({
        id: String(t._id),
        type: "task",
        icon: "📋",
        title: `Task: ${t.title}`,
        detail: `Status: ${t.status} · Priority: ${t.priority}`,
        timestamp: t.createdAt,
      });
    });
    (recentConvs || []).forEach((c) => {
      activityList.push({
        id: String(c._id),
        type: "conversation",
        icon: "✦",
        title: "AI Conversation",
        detail: c.title || "Chat session",
        timestamp: c.updatedAt,
      });
    });
    activityList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const recentActivity = activityList.slice(0, 5);

    if (role === "admin") {
      // Admin sees system-wide statistics + user breakdowns
      const [totalUsers, roleCounts, totalDocs, totalConvs, totalTasks] = await Promise.all([
        User.countDocuments(),
        User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
        Document.countDocuments(),
        Conversation.countDocuments(),
        Task.countDocuments(),
      ]);

      const usersByRole = { admin: 0, member: 0, viewer: 0 };
      roleCounts.forEach((r) => {
        if (r._id && usersByRole[r._id] !== undefined) {
          usersByRole[r._id] = r.count;
        }
      });

      return res.status(200).json({
        success: true,
        role: "admin",
        stats: {
          totalUsers,
          usersByRole,
          totalDocuments: totalDocs,
          totalConversations: totalConvs,
          totalTasks,
          recentActivity,
          ...baseGitHubStats,
        },
      });
    }

    if (role === "member") {
      // Member sees their workspace metrics (no user management)
      const [workspaceDocs, userConvs, workspaceTasks] = await Promise.all([
        Document.countDocuments(docFilter),
        Conversation.countDocuments({ user_id: userId }),
        Task.countDocuments(taskFilter),
      ]);

      return res.status(200).json({
        success: true,
        role: "member",
        stats: {
          totalDocuments: workspaceDocs,
          totalConversations: userConvs,
          totalTasks: workspaceTasks,
          recentActivity,
          ...baseGitHubStats,
        },
      });
    }

    if (role === "viewer") {
      // Viewer sees workspace overview in read-only mode
      const [workspaceDocs, workspaceConvs, workspaceTasks] = await Promise.all([
        Document.countDocuments(docFilter),
        Conversation.countDocuments(wsId ? { workspace_id: wsId } : {}),
        Task.countDocuments(taskFilter),
      ]);

      return res.status(200).json({
        success: true,
        role: "viewer",
        stats: {
          totalDocuments: workspaceDocs,
          totalConversations: workspaceConvs,
          totalTasks: workspaceTasks,
          isReadOnly: true,
          recentActivity,
          ...baseGitHubStats,
        },
      });
    }

    // Default fallback
    return res.status(200).json({
      success: true,
      role,
      stats: {
        totalDocuments: 0,
        totalConversations: 0,
        totalTasks: 0,
        recentActivity: [],
        ...baseGitHubStats,
      },
    });
  } catch (err) {
    console.error("getStats error:", err);
    res.status(500).json({
      success: false,
      message: "Could not retrieve dashboard statistics",
    });
  }
};
