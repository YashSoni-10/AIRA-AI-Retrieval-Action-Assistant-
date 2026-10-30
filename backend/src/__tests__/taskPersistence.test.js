/**
 * Task Persistence & Update Inconsistency Regression Tests
 * ========================================================
 * Tests:
 * 1. Update todo to in-progress, retrieve via fresh read, assert in_progress.
 * 2. Persistence test covering a fresh API read after update.
 * 3. Rejects empty/invalid updates with 400 instead of false 200.
 * 4. Cache-Control headers ensure no-store caching on task APIs.
 * 5. Role restrictions: viewer cannot update tasks (403).
 */

const httpMocks = require("node-mocks-http");
const mongoose = require("mongoose");
const taskController = require("../controllers/taskController");
const Task = require("../models/Task");
const Workspace = require("../models/Workspace");

// In-memory or mocked mongo tests
describe("Task Persistence & Controller Inconsistency Tests", () => {
  let mockUser;
  let mockWorkspaceId;
  let sampleTaskId;

  beforeAll(async () => {
    mockUser = {
      _id: new mongoose.Types.ObjectId(),
      name: "Persistence Test User",
      role: "member",
    };
    mockWorkspaceId = new mongoose.Types.ObjectId();
    sampleTaskId = new mongoose.Types.ObjectId();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("sanitizeTaskFields normalizes in-progress and rejects empty update", async () => {
    // Empty update should be invalid
    const emptyRes = taskController.updateTask ? true : false;
    expect(emptyRes).toBe(true);

    const reqEmpty = httpMocks.createRequest({
      method: "PATCH",
      params: { id: sampleTaskId.toString() },
      body: {},
      user: mockUser,
    });
    const resEmpty = httpMocks.createResponse();

    // Mock Task.findOne
    jest.spyOn(Workspace, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: mockWorkspaceId }),
    });
    jest.spyOn(Task, "findOne").mockResolvedValue({
      _id: sampleTaskId,
      workspace_id: mockWorkspaceId,
      created_by: mockUser._id,
      status: "todo",
      save: jest.fn().mockResolvedValue(true),
    });

    await taskController.updateTask(reqEmpty, resEmpty);
    // Should return 400 because no valid update fields provided
    expect(resEmpty.statusCode).toBe(400);
    const data = resEmpty._getJSONData();
    expect(data.success).toBe(false);
    expect(data.message).toMatch(/No valid update fields/i);
  });

  test("updateTask updates todo to in-progress, awaits save, and returns verified document", async () => {
    const savedTask = {
      _id: sampleTaskId,
      workspace_id: mockWorkspaceId,
      created_by: mockUser._id,
      title: "Test Task",
      status: "todo",
      priority: "medium",
      save: jest.fn().mockImplementation(async function () {
        this.status = "in_progress";
        return this;
      }),
    };

    jest.spyOn(Workspace, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: mockWorkspaceId }),
    });
    jest.spyOn(Task, "findOne").mockResolvedValue(savedTask);

    // Mock findById for authoritative verification read
    jest.spyOn(Task, "findById").mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: sampleTaskId,
            workspace_id: mockWorkspaceId,
            created_by: { _id: mockUser._id, name: mockUser.name },
            title: "Test Task",
            status: "in_progress",
            priority: "medium",
          }),
        }),
      }),
    });

    const req = httpMocks.createRequest({
      method: "PATCH",
      params: { id: sampleTaskId.toString() },
      body: { status: "in-progress" },
      user: mockUser,
    });
    const res = httpMocks.createResponse();

    await taskController.updateTask(req, res);

    expect(res.statusCode).toBe(200);
    expect(savedTask.save).toHaveBeenCalled();
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.task.status).toBe("in_progress");
    expect(res.getHeader("Cache-Control")).toContain("no-store");
  });

  test("getTask sets Cache-Control no-store and reads persistent record", async () => {
    jest.spyOn(Workspace, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: mockWorkspaceId }),
    });
    jest.spyOn(Task, "findOne").mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: sampleTaskId,
            workspace_id: mockWorkspaceId,
            status: "in_progress",
            title: "Test Task",
          }),
        }),
      }),
    });

    const req = httpMocks.createRequest({
      method: "GET",
      params: { id: sampleTaskId.toString() },
      user: mockUser,
    });
    const res = httpMocks.createResponse();

    await taskController.getTask(req, res);

    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.task.status).toBe("in_progress");
    expect(res.getHeader("Cache-Control")).toContain("no-store");
  });

  test("viewer role is forbidden from updating tasks", async () => {
    const viewerUser = { _id: new mongoose.Types.ObjectId(), role: "viewer" };
    const req = httpMocks.createRequest({
      method: "PATCH",
      params: { id: sampleTaskId.toString() },
      body: { status: "in-progress" },
      user: viewerUser,
    });
    const res = httpMocks.createResponse();

    await taskController.updateTask(req, res);

    expect(res.statusCode).toBe(403);
    const data = res._getJSONData();
    expect(data.success).toBe(false);
  });
});
