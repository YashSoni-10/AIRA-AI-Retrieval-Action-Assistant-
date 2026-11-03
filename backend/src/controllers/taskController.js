/**
 * Task Controller — AIRA
 * ======================
 * Handles CRUD for workspace-scoped tasks.
 *
 * RBAC:
 *   admin  → full management of all tasks in the workspace
 *   member → create tasks; update/delete only their own tasks
 *   viewer → GET only (read-only)
 *
 * Workspace isolation:
 *   Every query is scoped to the authenticated user's workspace_id.
 *   The workspace_id is resolved server-side from the user's default workspace;
 *   clients never supply it directly.
 *
 * Input sanitization:
 *   All fields are white-listed; unknown fields are ignored.
 *   LLM-supplied values (agent task creation) are validated the same way.
 *   Never trust raw LLM JSON blindly.
 */

"use strict";

const Task = require("../models/Task");
const Workspace = require("../models/Workspace");
const mongoose = require("mongoose");

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_STATUSES = ["todo", "in_progress", "completed", "cancelled"];
const VALID_PRIORITIES = ["low", "medium", "high"];

/**
 * Resolve the authenticated user's default workspace _id,
 * auto-creating it if it doesn't exist yet.
 * Supports x-workspace-id header when available.
 */
async function resolveWorkspaceId(userOrId, req = null) {
  if (!userOrId) return null;
  const userId = (typeof userOrId === "object" && userOrId._id) ? userOrId._id : userOrId;

  // Validate x-workspace-id header against user's authorized workspaces
  if (req && req.headers && req.headers["x-workspace-id"]) {
    const wsHeader = req.headers["x-workspace-id"];
    if (mongoose.Types.ObjectId.isValid(wsHeader)) {
      const authorizedWs = await Workspace.findOne({
        _id: new mongoose.Types.ObjectId(wsHeader),
        $or: [{ owner_id: userId }, { members: userId }],
      }).lean();
      if (authorizedWs) {
        return authorizedWs._id;
      }
      // Untrusted or unauthorized workspace header supplied — reject access
      return null;
    }
    return null;
  }

  let ws = await Workspace.findOne({ owner_id: userId, is_default: true }).lean();
  if (!ws) {
    ws = await Workspace.findOne({ members: userId, is_default: true }).lean();
  }
  if (!ws) {
    const wsName = (typeof userOrId === "object" && userOrId.name) ? `${userOrId.name} Workspace` : "Default Workspace";
    ws = await Workspace.create({
      name: wsName,
      owner_id: userId,
      is_default: true,
      description: "Your default AIRA workspace",
    });
  }
  return ws._id;
}

/**
 * Validate and sanitize incoming task fields.
 * Supports field aliases: new_status, state, task_status, new_title, new_priority.
 * Rejects empty updates when partial=true.
 * Returns { valid: true, data: {...} } or { valid: false, error: "..." }.
 */
function sanitizeTaskFields(body, partial = false, currentUserId = null) {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const data = {};

  const titleVal = body.title !== undefined ? body.title : body.new_title;
  if (!partial || titleVal !== undefined) {
    if (!titleVal || typeof titleVal !== "string" || !titleVal.trim()) {
      return { valid: false, error: "title is required and must be a non-empty string" };
    }
    data.title = titleVal.trim().slice(0, 200);
  }

  const descVal = body.description !== undefined ? body.description : body.new_description;
  if (descVal !== undefined) {
    data.description = typeof descVal === "string"
      ? descVal.trim().slice(0, 2000)
      : "";
  }

  const rawStatus = body.status !== undefined
    ? body.status
    : (body.new_status !== undefined ? body.new_status : (body.state !== undefined ? body.state : body.task_status));

  if (rawStatus !== undefined) {
    let normalizedStatus = typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";
    if (normalizedStatus === "in-progress" || normalizedStatus === "inprogress" || normalizedStatus === "doing") {
      normalizedStatus = "in_progress";
    } else if (normalizedStatus === "done" || normalizedStatus === "complete") {
      normalizedStatus = "completed";
    } else if (normalizedStatus === "to-do" || normalizedStatus === "to_do" || normalizedStatus === "pending") {
      normalizedStatus = "todo";
    } else if (normalizedStatus === "canceled") {
      normalizedStatus = "cancelled";
    }

    if (!VALID_STATUSES.includes(normalizedStatus)) {
      return { valid: false, error: `status must be one of: ${VALID_STATUSES.join(", ")} (or 'in-progress', 'completed')` };
    }
    data.status = normalizedStatus;
  }

  const prioVal = body.priority !== undefined ? body.priority : body.new_priority;
  if (prioVal !== undefined) {
    const pNorm = typeof prioVal === "string" ? prioVal.trim().toLowerCase() : "";
    if (!VALID_PRIORITIES.includes(pNorm)) {
      return { valid: false, error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` };
    }
    data.priority = pNorm;
  }

  const dueDateVal = body.due_date !== undefined ? body.due_date : body.dueDate;
  if (dueDateVal !== undefined) {
    if (dueDateVal === null || dueDateVal === "") {
      data.due_date = null;
    } else {
      const d = new Date(dueDateVal);
      if (isNaN(d.getTime())) {
        return { valid: false, error: "due_date must be a valid date string (e.g. YYYY-MM-DD or ISO 8601) or null" };
      }
      data.due_date = d;
    }
  }

  // assigned_to must be a valid ObjectId if provided, or 'current_user' alias
  const assigneeVal = body.assigned_to !== undefined
    ? body.assigned_to
    : (body.assignee !== undefined ? body.assignee : body.assignedTo);

  if (assigneeVal !== undefined) {
    if (assigneeVal === null || assigneeVal === "") {
      data.assigned_to = null;
    } else if (
      typeof assigneeVal === "string" &&
      ["current_user", "current-user", "current user", "me", "self"].includes(assigneeVal.trim().toLowerCase())
    ) {
      if (currentUserId && mongoose.Types.ObjectId.isValid(currentUserId)) {
        data.assigned_to = new mongoose.Types.ObjectId(currentUserId);
      } else {
        data.assigned_to = "CURRENT_USER";
      }
    } else if (!mongoose.Types.ObjectId.isValid(assigneeVal)) {
      return { valid: false, error: "assigned_to must be a valid user ID, 'current_user', or null" };
    } else {
      data.assigned_to = new mongoose.Types.ObjectId(assigneeVal);
    }
  }

  if (partial && Object.keys(data).length === 0) {
    return { valid: false, error: "No valid update fields provided. Allowed fields: title, description, status, priority, due_date, assigned_to" };
  }

  return { valid: true, data };
}

// ── GET /api/tasks ────────────────────────────────────────────────────────────

exports.listTasks = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const workspaceId = await resolveWorkspaceId(req.user, req);
    if (!workspaceId) {
      return res.status(404).json({ success: false, message: "Workspace not found" });
    }

    // Base visibility scope: tasks belonging to user's workspace OR explicitly assigned to the user
    const conditions = [
      {
        $or: [
          { workspace_id: workspaceId },
          { assigned_to: req.user._id },
        ],
      },
    ];

    // Optional query filters with normalization
    if (req.query.status) {
      let qStatus = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
      if (qStatus === "in-progress" || qStatus === "inprogress") qStatus = "in_progress";
      else if (qStatus === "done" || qStatus === "complete") qStatus = "completed";
      else if (qStatus === "to-do" || qStatus === "to_do") qStatus = "todo";
      if (VALID_STATUSES.includes(qStatus)) {
        conditions.push({ status: qStatus });
      }
    }
    if (req.query.priority && VALID_PRIORITIES.includes(req.query.priority)) {
      conditions.push({ priority: req.query.priority });
    }
    if (req.query.mine === "true") {
      conditions.push({
        $or: [
          { created_by: req.user._id },
          { assigned_to: req.user._id },
        ],
      });
    }
    if (req.query.q && typeof req.query.q === "string") {
      const q = req.query.q.trim().slice(0, 100);
      if (q) {
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        conditions.push({
          $or: [
            { title: { $regex: escaped, $options: "i" } },
            { description: { $regex: escaped, $options: "i" } },
          ],
        });
      }
    }

    const filter = conditions.length === 1 ? conditions[0] : { $and: conditions };

    const tasks = await Task.find(filter)
      .populate("created_by", "name email")
      .populate("assigned_to", "name email")
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ success: true, tasks, count: tasks.length });
  } catch (err) {
    console.error("listTasks error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to retrieve tasks" });
  }
};

// ── GET /api/tasks/:id ────────────────────────────────────────────────────────

exports.getTask = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID" });
    }

    const workspaceId = await resolveWorkspaceId(req.user, req);
    if (!workspaceId) {
      return res.status(404).json({ success: false, message: "Workspace not found" });
    }

    // Scoped to user's workspace OR task assigned to user
    let task = await Task.findOne({
      _id: req.params.id,
      $or: [
        { workspace_id: workspaceId },
        { assigned_to: req.user._id },
      ],
    })
      .populate("created_by", "name email")
      .populate("assigned_to", "name email")
      .lean();

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    return res.json({ success: true, task });
  } catch (err) {
    console.error("getTask error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to retrieve task" });
  }
};

// ── POST /api/tasks ───────────────────────────────────────────────────────────

exports.createTask = async (req, res) => {
  try {
    // Viewers cannot create tasks
    if (req.user.role === "viewer") {
      return res.status(403).json({ success: false, message: "Viewers cannot create tasks" });
    }

    const workspaceId = await resolveWorkspaceId(req.user, req);
    if (!workspaceId) {
      return res.status(404).json({ success: false, message: "Workspace not found" });
    }

    const currentUserId = req.user ? (req.user._id || req.user.id) : null;
    const sanitized = sanitizeTaskFields(req.body, false, currentUserId);
    if (!sanitized.valid) {
      return res.status(400).json({ success: false, message: sanitized.error });
    }
    if (sanitized.data.assigned_to === "CURRENT_USER") {
      sanitized.data.assigned_to = req.user._id;
    }

    // Optionally accept source + conversation_id for agent-created tasks
    const source = req.body.source === "agent" ? "agent" : "manual";
    const conversationId =
      source === "agent" && mongoose.Types.ObjectId.isValid(req.body.conversation_id)
        ? new mongoose.Types.ObjectId(req.body.conversation_id)
        : null;

    // Validate that assigned user exists, is active, and is in this workspace
    if (sanitized.data.assigned_to) {
      const User = require("../models/User");
      const assigneeUser = await User.findOne({
        _id: sanitized.data.assigned_to,
        isActive: { $ne: false },
      }).lean();

      if (!assigneeUser) {
        return res.status(400).json({
          success: false,
          message: "Assignee not found or inactive in this workspace",
        });
      }

      const workspace = await Workspace.findById(workspaceId).lean();
      if (workspace && Array.isArray(workspace.members) && workspace.members.length > 0) {
        const isOwner = workspace.owner_id.toString() === assigneeUser._id.toString();
        const isMember = workspace.members.some(
          (m) => m.toString() === assigneeUser._id.toString()
        );
        if (!isOwner && !isMember) {
          return res.status(400).json({
            success: false,
            message: "Assignee does not belong to this workspace",
          });
        }
      }
    }

    // Deduplication check: if identical task was created in the last 5 seconds, return it
    const duplicateQuery = {
      workspace_id: workspaceId,
      title: sanitized.data.title,
      created_by: req.user._id,
      createdAt: { $gte: new Date(Date.now() - 5000) },
    };
    if (conversationId) {
      duplicateQuery.conversation_id = conversationId;
    }
    const dupFind = Task.findOne(duplicateQuery);
    const recentDuplicate = dupFind && typeof dupFind.lean === "function" ? await dupFind.lean() : await dupFind;

    if (recentDuplicate) {
      const popFind = Task.findById(recentDuplicate._id);
      const populated = popFind && typeof popFind.populate === "function"
        ? await popFind.populate("created_by", "name email").populate("assigned_to", "name email").lean()
        : null;
      return res.status(200).json({ success: true, task: populated || recentDuplicate, deduplicated: true });
    }

    const task = await Task.create({
      ...sanitized.data,
      workspace_id: workspaceId,
      created_by: req.user._id,
      source,
      conversation_id: conversationId,
    });

    const populated = await Task.findById(task._id)
      .populate("created_by", "name email")
      .populate("assigned_to", "name email")
      .lean();

    return res.status(201).json({ success: true, task: populated });
  } catch (err) {
    console.error("createTask error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to create task" });
  }
};

// ── PATCH /api/tasks/:id ──────────────────────────────────────────────────────

exports.updateTask = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID" });
    }

    // Viewers cannot update tasks
    if (req.user.role === "viewer") {
      return res.status(403).json({ success: false, message: "Viewers cannot update tasks" });
    }

    const workspaceId = await resolveWorkspaceId(req.user, req);
    if (!workspaceId) {
      return res.status(404).json({ success: false, message: "Workspace not found" });
    }

    let task = await Task.findOne({ _id: req.params.id, workspace_id: workspaceId });
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    // Members can only update their own tasks; admins can update any
    if (req.user.role === "member" && task.created_by.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "You can only update your own tasks" });
    }

    const currentUserId = req.user ? (req.user._id || req.user.id) : null;
    const sanitized = sanitizeTaskFields(req.body, true, currentUserId); // partial = true
    if (!sanitized.valid) {
      return res.status(400).json({ success: false, message: sanitized.error });
    }
    if (sanitized.data.assigned_to === "CURRENT_USER") {
      sanitized.data.assigned_to = req.user._id;
    }

    // Validate that assigned user exists, is active, and belongs to workspace
    if (sanitized.data.assigned_to) {
      const User = require("../models/User");
      const assigneeUser = await User.findOne({
        _id: sanitized.data.assigned_to,
        isActive: { $ne: false },
      }).lean();

      if (!assigneeUser) {
        return res.status(400).json({
          success: false,
          message: "Assignee not found or inactive in this workspace",
        });
      }

      const workspace = await Workspace.findById(workspaceId).lean();
      if (workspace && Array.isArray(workspace.members) && workspace.members.length > 0) {
        const isOwner = workspace.owner_id.toString() === assigneeUser._id.toString();
        const isMember = workspace.members.some(
          (m) => m.toString() === assigneeUser._id.toString()
        );
        if (!isOwner && !isMember) {
          return res.status(400).json({
            success: false,
            message: "Assignee does not belong to this workspace",
          });
        }
      }
    }

    Object.assign(task, sanitized.data);
    await task.save();

    // Authoritative fresh read verification directly from persistent store
    const verified = await Task.findById(task._id)
      .populate("created_by", "name email")
      .populate("assigned_to", "name email")
      .lean();

    if (!verified) {
      return res.status(500).json({ success: false, message: "Persistence verification failed: updated task could not be read back" });
    }

    // Verify all requested updates are reflected in persistent document
    for (const [key, val] of Object.entries(sanitized.data)) {
      if (key === "assigned_to") {
        const vId = verified.assigned_to ? String(verified.assigned_to._id || verified.assigned_to) : null;
        const reqId = val ? String(val) : null;
        if (vId !== reqId) {
          return res.status(500).json({ success: false, message: `Persistence verification failed for field assigned_to` });
        }
        continue;
      }
      if (key === "due_date") {
        const vTime = verified.due_date ? new Date(verified.due_date).getTime() : null;
        const reqTime = val ? new Date(val).getTime() : null;
        if (vTime !== reqTime) {
          return res.status(500).json({ success: false, message: `Persistence verification failed for field ${key}` });
        }
      } else if (String(verified[key]) !== String(val)) {
        return res.status(500).json({ success: false, message: `Persistence verification failed: expected ${key}='${val}' but found '${verified[key]}'` });
      }
    }

    return res.json({ success: true, task: verified });
  } catch (err) {
    console.error("updateTask error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to update task" });
  }
};

// ── DELETE /api/tasks/:id ─────────────────────────────────────────────────────

exports.deleteTask = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid task ID" });
    }

    if (req.user.role === "viewer") {
      return res.status(403).json({ success: false, message: "Viewers cannot delete tasks" });
    }

    const workspaceId = await resolveWorkspaceId(req.user, req);
    if (!workspaceId) {
      return res.status(404).json({ success: false, message: "Workspace not found" });
    }

    let task = await Task.findOne({ _id: req.params.id, workspace_id: workspaceId });
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    // Members can only delete their own tasks; admins can delete any
    if (req.user.role === "member" && task.created_by.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "You can only delete your own tasks" });
    }

    await task.deleteOne();
    return res.json({ success: true, message: "Task deleted successfully" });
  } catch (err) {
    console.error("deleteTask error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to delete task" });
  }
};
