/**
 * Task Cross-User Authorization & Workspace Boundary Regression Tests
 * ===================================================================
 * Verifies:
 * 1. Vaishnavi can retrieve and update her own task.
 * 2. HM can retrieve and update HM's own task.
 * 3. HM cannot retrieve Vaishnavi's task by ID (404).
 * 4. HM cannot update or delete Vaishnavi's task (404/403).
 * 5. HM cannot bypass workspace boundary using spoofed x-workspace-id header.
 * 6. Task listing and search are strictly scoped to the user's authorized workspace.
 * 7. Legitimate user isolation and task persistence continue working.
 */

const httpMocks = require("node-mocks-http");
const mongoose = require("mongoose");
const taskController = require("../controllers/taskController");
const Task = require("../models/Task");
const Workspace = require("../models/Workspace");

describe("Task Cross-User Authorization & Workspace Isolation", () => {
  const vaishnaviId = new mongoose.Types.ObjectId();
  const hmId = new mongoose.Types.ObjectId();
  const vaishnaviWorkspaceId = new mongoose.Types.ObjectId();
  const hmWorkspaceId = new mongoose.Types.ObjectId();
  const vaishnaviTaskId = new mongoose.Types.ObjectId();
  const hmTaskId = new mongoose.Types.ObjectId();

  const vaishnaviUser = {
    _id: vaishnaviId,
    name: "Vaishnavi",
    email: "test2@gmail.com",
    role: "member",
  };

  const hmUser = {
    _id: hmId,
    name: "HM",
    email: "hm@gmail.com",
    role: "member",
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  // Mock workspace resolution helper
  function setupWorkspaceMock(reqUser, reqHeader = null) {
    jest.spyOn(Workspace, "findOne").mockImplementation((query) => {
      // If querying by _id (validating x-workspace-id header)
      if (query._id) {
        const targetId = query._id.toString();
        const userId = reqUser._id.toString();
        // Only return workspace if user is owner or member
        if (targetId === vaishnaviWorkspaceId.toString() && userId === vaishnaviId.toString()) {
          return { lean: () => Promise.resolve({ _id: vaishnaviWorkspaceId, owner_id: vaishnaviId }) };
        }
        if (targetId === hmWorkspaceId.toString() && userId === hmId.toString()) {
          return { lean: () => Promise.resolve({ _id: hmWorkspaceId, owner_id: hmId }) };
        }
        return { lean: () => Promise.resolve(null) };
      }
      // Default workspace query
      if (query.owner_id && query.owner_id.toString() === vaishnaviId.toString()) {
        return { lean: () => Promise.resolve({ _id: vaishnaviWorkspaceId, owner_id: vaishnaviId }) };
      }
      if (query.owner_id && query.owner_id.toString() === hmId.toString()) {
        return { lean: () => Promise.resolve({ _id: hmWorkspaceId, owner_id: hmId }) };
      }
      return { lean: () => Promise.resolve(null) };
    });
  }

  test("Vaishnavi can retrieve her own task by ID", async () => {
    setupWorkspaceMock(vaishnaviUser);

    const taskDoc = {
      _id: vaishnaviTaskId,
      title: "Agent Persistence Test",
      description: "Verify tasks created by Task Agent",
      status: "todo",
      priority: "medium",
      workspace_id: vaishnaviWorkspaceId,
      created_by: { _id: vaishnaviId, name: "Vaishnavi", email: "test2@gmail.com" },
    };

    jest.spyOn(Task, "findOne").mockImplementation((query) => {
      // New query: { _id, $or: [{ workspace_id }, { assigned_to }] }
      const orClauses = query.$or || [];
      const wsClause = orClauses.find((c) => c.workspace_id);
      if (
        query._id.toString() === vaishnaviTaskId.toString() &&
        wsClause &&
        wsClause.workspace_id.toString() === vaishnaviWorkspaceId.toString()
      ) {
        return {
          populate: () => ({
            populate: () => ({
              lean: () => Promise.resolve(taskDoc),
            }),
          }),
        };
      }
      return {
        populate: () => ({
          populate: () => ({
            lean: () => Promise.resolve(null),
          }),
        }),
      };
    });

    const req = httpMocks.createRequest({
      method: "GET",
      params: { id: vaishnaviTaskId.toString() },
      user: vaishnaviUser,
    });
    const res = httpMocks.createResponse();

    await taskController.getTask(req, res);
    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.task.title).toBe("Agent Persistence Test");
  });

  test("HM can retrieve HM's own task by ID", async () => {
    setupWorkspaceMock(hmUser);

    const hmTaskDoc = {
      _id: hmTaskId,
      title: "HM Isolation Test",
      description: "Verify HM task visibility",
      status: "todo",
      priority: "medium",
      workspace_id: hmWorkspaceId,
      created_by: { _id: hmId, name: "HM", email: "hm@gmail.com" },
    };

    jest.spyOn(Task, "findOne").mockImplementation((query) => {
      // New query: { _id, $or: [{ workspace_id }, { assigned_to }] }
      const orClauses = query.$or || [];
      const wsClause = orClauses.find((c) => c.workspace_id);
      if (
        query._id.toString() === hmTaskId.toString() &&
        wsClause &&
        wsClause.workspace_id.toString() === hmWorkspaceId.toString()
      ) {
        return {
          populate: () => ({
            populate: () => ({
              lean: () => Promise.resolve(hmTaskDoc),
            }),
          }),
        };
      }
      return {
        populate: () => ({
          populate: () => ({
            lean: () => Promise.resolve(null),
          }),
        }),
      };
    });

    const req = httpMocks.createRequest({
      method: "GET",
      params: { id: hmTaskId.toString() },
      user: hmUser,
    });
    const res = httpMocks.createResponse();

    await taskController.getTask(req, res);
    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.task.title).toBe("HM Isolation Test");
  });

  test("HM CANNOT retrieve Vaishnavi's task by ID (returns 404)", async () => {
    setupWorkspaceMock(hmUser);

    jest.spyOn(Task, "findOne").mockImplementation((query) => {
      // New query shape: { _id, $or: [{ workspace_id: hmWorkspaceId }, { assigned_to: hmId }] }
      // Vaishnavi's task lives in vaishnaviWorkspaceId, not hmWorkspaceId, and is not assigned to HM.
      // So MongoDB returns null — simulate that here.
      return {
        populate: () => ({
          populate: () => ({
            lean: () => Promise.resolve(null),
          }),
        }),
      };
    });

    const req = httpMocks.createRequest({
      method: "GET",
      params: { id: vaishnaviTaskId.toString() },
      user: hmUser,
    });
    const res = httpMocks.createResponse();

    await taskController.getTask(req, res);
    expect(res.statusCode).toBe(404);
    const data = res._getJSONData();
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/task not found/i);
  });

  test("HM CANNOT retrieve Vaishnavi's task even with spoofed x-workspace-id header", async () => {
    // HM sends Vaishnavi's workspace_id in x-workspace-id header
    setupWorkspaceMock(hmUser, vaishnaviWorkspaceId);

    const req = httpMocks.createRequest({
      method: "GET",
      params: { id: vaishnaviTaskId.toString() },
      headers: { "x-workspace-id": vaishnaviWorkspaceId.toString() },
      user: hmUser,
    });
    const res = httpMocks.createResponse();

    await taskController.getTask(req, res);
    // Should be rejected (404 Workspace not found because HM is neither owner nor member of Vaishnavi's workspace)
    expect(res.statusCode).toBe(404);
    const data = res._getJSONData();
    expect(data.success).toBe(false);
  });

  test("HM CANNOT update Vaishnavi's task (returns 404)", async () => {
    setupWorkspaceMock(hmUser);

    jest.spyOn(Task, "findOne").mockImplementation((query) => {
      // Scoped to hmWorkspaceId - not found
      return Promise.resolve(null);
    });

    const req = httpMocks.createRequest({
      method: "PATCH",
      params: { id: vaishnaviTaskId.toString() },
      body: { status: "in-progress" },
      user: hmUser,
    });
    const res = httpMocks.createResponse();

    await taskController.updateTask(req, res);
    expect(res.statusCode).toBe(404);
    const data = res._getJSONData();
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/task not found/i);
  });

  test("HM CANNOT delete Vaishnavi's task (returns 404)", async () => {
    setupWorkspaceMock(hmUser);

    jest.spyOn(Task, "findOne").mockImplementation((query) => {
      return Promise.resolve(null);
    });

    const req = httpMocks.createRequest({
      method: "DELETE",
      params: { id: vaishnaviTaskId.toString() },
      user: hmUser,
    });
    const res = httpMocks.createResponse();

    await taskController.deleteTask(req, res);
    expect(res.statusCode).toBe(404);
    const data = res._getJSONData();
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/task not found/i);
  });

  test("Member cannot update another user's task within same workspace (403)", async () => {
    setupWorkspaceMock(hmUser);

    const taskInSameWorkspace = {
      _id: new mongoose.Types.ObjectId(),
      workspace_id: hmWorkspaceId,
      created_by: vaishnaviId, // created by someone else
      title: "Shared task",
      status: "todo",
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Task, "findOne").mockResolvedValue(taskInSameWorkspace);

    const req = httpMocks.createRequest({
      method: "PATCH",
      params: { id: taskInSameWorkspace._id.toString() },
      body: { status: "in-progress" },
      user: hmUser,
    });
    const res = httpMocks.createResponse();

    await taskController.updateTask(req, res);
    expect(res.statusCode).toBe(403);
    const data = res._getJSONData();
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/only update your own tasks/i);
  });

  test("listTasks for HM returns tasks from HM's workspace OR assigned to HM", async () => {
    setupWorkspaceMock(hmUser);

    const hmTasks = [
      {
        _id: hmTaskId,
        title: "HM Isolation Test",
        workspace_id: hmWorkspaceId,
        created_by: { _id: hmId, name: "HM" },
      },
    ];

    jest.spyOn(Task, "find").mockImplementation((filter) => {
      // New filter uses $and with a $or inside — verify it includes HM's workspace
      const firstCond = filter.$and ? filter.$and[0] : filter;
      const orClauses = firstCond.$or || [];
      const wsClause = orClauses.find((c) => c.workspace_id);
      expect(wsClause).toBeDefined();
      expect(wsClause.workspace_id.toString()).toBe(hmWorkspaceId.toString());
      return {
        populate: () => ({
          populate: () => ({
            sort: () => ({
              lean: () => Promise.resolve(hmTasks),
            }),
          }),
        }),
      };
    });

    const req = httpMocks.createRequest({
      method: "GET",
      user: hmUser,
    });
    const res = httpMocks.createResponse();

    await taskController.listTasks(req, res);
    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.tasks.length).toBe(1);
    expect(data.tasks[0].title).toBe("HM Isolation Test");
  });
});

// ── Viewer Visibility Tests ────────────────────────────────────────────────────

describe("Viewer Task Visibility — assigned-to access", () => {
  const viewerId = new mongoose.Types.ObjectId();
  const memberId = new mongoose.Types.ObjectId();
  const viewerWorkspaceId = new mongoose.Types.ObjectId();
  const memberWorkspaceId = new mongoose.Types.ObjectId();
  const assignedTaskId = new mongoose.Types.ObjectId();
  const unassignedTaskId = new mongoose.Types.ObjectId();

  const viewerUser = {
    _id: viewerId,
    name: "Viewer",
    email: "viewer@test.com",
    role: "viewer",
  };

  const memberUser = {
    _id: memberId,
    name: "Member",
    email: "member@test.com",
    role: "member",
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    // Viewer's default workspace resolves to viewerWorkspaceId
    jest.spyOn(Workspace, "findOne").mockImplementation((query) => {
      if (query._id) {
        const targetId = query._id.toString();
        if (targetId === viewerWorkspaceId.toString() && query.$or) {
          const ownerOk = query.$or.some(
            (c) => c.owner_id && c.owner_id.toString() === viewerId.toString()
          );
          return { lean: () => Promise.resolve(ownerOk ? { _id: viewerWorkspaceId, owner_id: viewerId } : null) };
        }
        return { lean: () => Promise.resolve(null) };
      }
      if (query.owner_id && query.owner_id.toString() === viewerId.toString()) {
        return { lean: () => Promise.resolve({ _id: viewerWorkspaceId, owner_id: viewerId }) };
      }
      return { lean: () => Promise.resolve(null) };
    });
  });

  // Task assigned to Viewer but created in Member's workspace
  const assignedTaskDoc = {
    _id: assignedTaskId,
    title: "Assigned To Viewer",
    status: "todo",
    priority: "medium",
    workspace_id: memberWorkspaceId,
    created_by: { _id: memberId, name: "Member", email: "member@test.com" },
    assigned_to: { _id: viewerId, name: "Viewer", email: "viewer@test.com" },
  };

  test("Viewer can list tasks assigned to them even if in another workspace", async () => {
    jest.spyOn(Task, "find").mockImplementation(() => ({
      populate: () => ({
        populate: () => ({
          sort: () => ({
            lean: () => Promise.resolve([assignedTaskDoc]),
          }),
        }),
      }),
    }));

    const req = httpMocks.createRequest({ method: "GET", user: viewerUser });
    const res = httpMocks.createResponse();

    await taskController.listTasks(req, res);
    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.tasks.length).toBe(1);
    expect(data.tasks[0].title).toBe("Assigned To Viewer");
  });

  test("Viewer can retrieve a task assigned to them via GET /api/tasks/:id", async () => {
    jest.spyOn(Task, "findOne").mockImplementation((query) => {
      // Should use $or with assigned_to: viewerId
      const orClauses = query.$or || [];
      const assignedClause = orClauses.find((c) => c.assigned_to);
      if (
        query._id.toString() === assignedTaskId.toString() &&
        assignedClause &&
        assignedClause.assigned_to.toString() === viewerId.toString()
      ) {
        return {
          populate: () => ({
            populate: () => ({
              lean: () => Promise.resolve(assignedTaskDoc),
            }),
          }),
        };
      }
      return {
        populate: () => ({
          populate: () => ({
            lean: () => Promise.resolve(null),
          }),
        }),
      };
    });

    const req = httpMocks.createRequest({
      method: "GET",
      params: { id: assignedTaskId.toString() },
      user: viewerUser,
    });
    const res = httpMocks.createResponse();

    await taskController.getTask(req, res);
    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.task.title).toBe("Assigned To Viewer");
  });

  test("Viewer CANNOT retrieve an unassigned task from another workspace (returns 404)", async () => {
    jest.spyOn(Task, "findOne").mockImplementation(() => ({
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve(null), // not in viewer's ws, not assigned to viewer
        }),
      }),
    }));

    const req = httpMocks.createRequest({
      method: "GET",
      params: { id: unassignedTaskId.toString() },
      user: viewerUser,
    });
    const res = httpMocks.createResponse();

    await taskController.getTask(req, res);
    expect(res.statusCode).toBe(404);
    const data = res._getJSONData();
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/task not found/i);
  });

  test("Viewer is blocked from createTask (403) even for tasks in any workspace", async () => {
    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/tasks",
      body: { title: "Viewer Try Create", priority: "low" },
      user: viewerUser,
    });
    const res = httpMocks.createResponse();

    await taskController.createTask(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._getJSONData().message).toMatch(/Viewers cannot create tasks/i);
  });

  test("Viewer is blocked from updateTask (403) even for tasks assigned to them", async () => {
    const req = httpMocks.createRequest({
      method: "PATCH",
      params: { id: assignedTaskId.toString() },
      body: { status: "in-progress" },
      user: viewerUser,
    });
    const res = httpMocks.createResponse();

    await taskController.updateTask(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._getJSONData().message).toMatch(/Viewers cannot update tasks/i);
  });

  test("Viewer is blocked from deleteTask (403) even for tasks assigned to them", async () => {
    const req = httpMocks.createRequest({
      method: "DELETE",
      params: { id: assignedTaskId.toString() },
      user: viewerUser,
    });
    const res = httpMocks.createResponse();

    await taskController.deleteTask(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._getJSONData().message).toMatch(/Viewers cannot delete tasks/i);
  });
});

// ── Extended Task Creation & Assignee Validation Tests ─────────────────────────

describe("Task Creation with Due Date, Assignee, Workspace Boundary & Deduplication", () => {
  const memberId = new mongoose.Types.ObjectId();
  const teammateId = new mongoose.Types.ObjectId();
  const outsideUserId = new mongoose.Types.ObjectId();
  const workspaceId = new mongoose.Types.ObjectId();
  const User = require("../models/User");

  const memberUser = {
    _id: memberId,
    name: "Task Author",
    email: "author@aira.io",
    role: "member",
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Workspace, "findOne").mockReturnValue({
      lean: () => Promise.resolve({ _id: workspaceId, owner_id: memberId }),
    });
    jest.spyOn(Workspace, "findById").mockReturnValue({
      lean: () => Promise.resolve({ _id: workspaceId, owner_id: memberId }),
    });
  });

  test("creates task with all five fields: title, description, priority, due_date, assigned_to", async () => {
    const dueDateStr = "2026-11-05";
    const createdTask = {
      _id: new mongoose.Types.ObjectId(),
      title: "Test AIRA Task Agent",
      description: "Verify task creation and persistence.",
      priority: "high",
      status: "todo",
      due_date: new Date(dueDateStr),
      assigned_to: memberId,
      workspace_id: workspaceId,
      created_by: memberId,
    };

    jest.spyOn(Task, "findOne").mockResolvedValue(null); // No duplicate
    jest.spyOn(User, "findOne").mockReturnValue({
      lean: () => Promise.resolve({ _id: memberId, name: "Task Author", isActive: true }),
    });
    jest.spyOn(Task, "create").mockResolvedValue(createdTask);
    jest.spyOn(Task, "findById").mockReturnValue({
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve({
            ...createdTask,
            created_by: { _id: memberId, name: "Task Author", email: "author@aira.io" },
            assigned_to: { _id: memberId, name: "Task Author", email: "author@aira.io" },
          }),
        }),
      }),
    });

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/tasks",
      body: {
        title: "Test AIRA Task Agent",
        description: "Verify task creation and persistence.",
        priority: "high",
        dueDate: dueDateStr,
        assigned_to: "current_user",
      },
      user: memberUser,
    });
    const res = httpMocks.createResponse();

    await taskController.createTask(req, res);
    expect(res.statusCode).toBe(201);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.task.title).toBe("Test AIRA Task Agent");
    expect(data.task.priority).toBe("high");
    expect(data.task.assigned_to._id.toString()).toBe(memberId.toString());
  });

  test("assigning to another valid workspace member succeeds", async () => {
    const createdTask = {
      _id: new mongoose.Types.ObjectId(),
      title: "Collaborative Task",
      priority: "medium",
      status: "todo",
      assigned_to: teammateId,
      workspace_id: workspaceId,
      created_by: memberId,
    };

    jest.spyOn(Task, "findOne").mockResolvedValue(null);
    jest.spyOn(User, "findOne").mockReturnValue({
      lean: () => Promise.resolve({ _id: teammateId, name: "Teammate", isActive: true }),
    });
    jest.spyOn(Task, "create").mockResolvedValue(createdTask);
    jest.spyOn(Task, "findById").mockReturnValue({
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve({
            ...createdTask,
            assigned_to: { _id: teammateId, name: "Teammate", email: "teammate@aira.io" },
          }),
        }),
      }),
    });

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/tasks",
      body: {
        title: "Collaborative Task",
        assigned_to: teammateId.toString(),
      },
      user: memberUser,
    });
    const res = httpMocks.createResponse();

    await taskController.createTask(req, res);
    expect(res.statusCode).toBe(201);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.task.assigned_to._id.toString()).toBe(teammateId.toString());
  });

  test("rejects invalid or cross-workspace assignee with 400", async () => {
    jest.spyOn(Task, "findOne").mockResolvedValue(null);
    // User not found or inactive
    jest.spyOn(User, "findOne").mockReturnValue({
      lean: () => Promise.resolve(null),
    });

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/tasks",
      body: {
        title: "Bad Assignee Task",
        assigned_to: outsideUserId.toString(),
      },
      user: memberUser,
    });
    const res = httpMocks.createResponse();

    await taskController.createTask(req, res);
    expect(res.statusCode).toBe(400);
    const data = res._getJSONData();
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/Assignee not found or inactive/i);
  });

  test("rejects malformed due_date with 400", async () => {
    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/tasks",
      body: {
        title: "Bad Date Task",
        due_date: "not-a-real-date",
      },
      user: memberUser,
    });
    const res = httpMocks.createResponse();

    await taskController.createTask(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().message).toMatch(/due_date must be a valid date/i);
  });

  test("duplicate prevention: returns existing task if identical task was created recently", async () => {
    const recentTask = {
      _id: new mongoose.Types.ObjectId(),
      title: "Test AIRA Task Agent",
      priority: "high",
      status: "todo",
      workspace_id: workspaceId,
      created_by: { _id: memberId, name: "Task Author" },
      assigned_to: { _id: memberId, name: "Task Author" },
    };

    jest.spyOn(Task, "findOne").mockReturnValue({
      lean: () => Promise.resolve(recentTask),
    });
    jest.spyOn(Task, "findById").mockReturnValue({
      populate: () => ({
        populate: () => ({
          lean: () => Promise.resolve(recentTask),
        }),
      }),
    });
    const createSpy = jest.spyOn(Task, "create");

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/tasks",
      body: {
        title: "Test AIRA Task Agent",
        priority: "high",
      },
      user: memberUser,
    });
    const res = httpMocks.createResponse();

    await taskController.createTask(req, res);
    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.deduplicated).toBe(true);
    expect(data.task._id.toString()).toBe(recentTask._id.toString());
    expect(createSpy).not.toHaveBeenCalled();
  });
});
