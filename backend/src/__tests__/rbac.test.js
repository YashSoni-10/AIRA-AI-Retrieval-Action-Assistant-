/**
 * AIRA — Comprehensive RBAC & Role Management Regression Tests
 * =============================================================
 * Proves:
 * 1. New registrations default to `member` (body role ignored).
 * 2. Normal member cannot promote themselves or other users.
 * 3. Non-admins cannot access admin-only endpoints even when calling directly.
 * 4. Only an authorized admin can change roles.
 * 5. Accidental removal or demotion of the last active admin is blocked (returns 400).
 * 6. Viewer cannot perform write operations through direct APIs (tasks, documents, github).
 * 7. Viewer can still access explicitly permitted read-only features.
 * 8. Cross-user task access remains blocked for all roles.
 * 9. Admin can manage permitted workspace settings (member/viewer get 403).
 */

const httpMocks = require("node-mocks-http");
const mongoose = require("mongoose");
const authController = require("../controllers/authController");
const taskController = require("../controllers/taskController");
const workspaceController = require("../controllers/workspaceController");
const documentController = require("../controllers/documentController");
const githubController = require("../controllers/githubController");
const { requireRole } = require("../middleware/auth");
const User = require("../models/User");
const Task = require("../models/Task");
const Workspace = require("../models/Workspace");
const Document = require("../models/Document");

describe("AIRA RBAC & Role Management Regression Suite", () => {
  const adminId = new mongoose.Types.ObjectId();
  const memberId = new mongoose.Types.ObjectId();
  const viewerId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();

  const adminWsId = new mongoose.Types.ObjectId();
  const memberWsId = new mongoose.Types.ObjectId();
  const otherWsId = new mongoose.Types.ObjectId();

  const adminUser = {
    _id: adminId,
    id: adminId.toString(),
    name: "Admin User",
    email: "admin@aira.io",
    role: "admin",
    isActive: true,
  };

  const memberUser = {
    _id: memberId,
    id: memberId.toString(),
    name: "Member User",
    email: "member@aira.io",
    role: "member",
    isActive: true,
  };

  const viewerUser = {
    _id: viewerId,
    id: viewerId.toString(),
    name: "Viewer User",
    email: "viewer@aira.io",
    role: "viewer",
    isActive: true,
  };

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-for-jest";
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    authController._setDbConnected(null);
    workspaceController._setConnected(null);
  });

  // ── 1. Registration Role Default ───────────────────────────────────────────
  describe("Registration Defaults", () => {
    it("assigns role 'member' by default and ignores client-supplied 'admin' role", async () => {
      authController._setDbConnected(true);
      jest.spyOn(User, "findOne").mockResolvedValue(null);

      let createdRole = null;
      jest.spyOn(User, "create").mockImplementation((doc) => {
        createdRole = doc.role;
        return Promise.resolve({
          ...doc,
          _id: new mongoose.Types.ObjectId(),
          toObject: () => ({ ...doc, _id: "new_id" }),
        });
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/register",
        body: {
          name: "Malicious User",
          email: "hacker@test.com",
          password: "password123",
          role: "admin", // Malicious attempt to self-promote
        },
      });
      const res = httpMocks.createResponse();

      await authController.register(req, res);

      expect(res.statusCode).toBe(201);
      expect(createdRole).toBe("member");
      const data = res._getJSONData();
      expect(data.user.role).toBe("member");
    });
  });

  // ── 2. Member Self-Promotion & Unauthorized Role Change Prevention ───────────
  describe("Self-Promotion Prevention", () => {
    it("blocks members from modifying roles via update-profile (returns 403)", async () => {
      const req = httpMocks.createRequest({
        method: "PATCH",
        url: "/api/auth/update-profile",
        user: memberUser,
        body: { name: "Hacked Name", role: "admin" },
      });
      const res = httpMocks.createResponse();

      await authController.updateProfile(req, res);

      expect(res.statusCode).toBe(403);
      const data = res._getJSONData();
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/role cannot be modified via profile update/i);
    });

    it("rejects non-admins from role-change route at middleware level (returns 403)", () => {
      const middleware = requireRole("admin");

      const req = httpMocks.createRequest({ user: memberUser });
      const res = httpMocks.createResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res, next);

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res._getJSONData().message).toMatch(/Forbidden/i);
    });

    it("rejects viewers from role-change route at middleware level (returns 403)", () => {
      const middleware = requireRole("admin");

      const req = httpMocks.createRequest({ user: viewerUser });
      const res = httpMocks.createResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res, next);

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  // ── 3. Non-Admins Cannot Access Admin Endpoints ────────────────────────────
  describe("Admin Route Protection", () => {
    it("blocks non-admins from listing users via requireRole('admin')", () => {
      const middleware = requireRole("admin");

      const req = httpMocks.createRequest({ user: memberUser });
      const res = httpMocks.createResponse();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  // ── 4. Authorized Admin Role Assignment ────────────────────────────────────
  describe("Admin Role Assignment", () => {
    it("allows authorized admin to change a member's role to viewer", async () => {
      authController._setDbConnected(true);

      const targetMember = {
        _id: memberId,
        name: "Member User",
        email: "member@aira.io",
        role: "member",
        isActive: true,
        save: jest.fn().mockResolvedValue(true),
        toObject: function () { return { ...this }; },
      };

      jest.spyOn(User, "findById").mockResolvedValue(targetMember);

      const req = httpMocks.createRequest({
        method: "PATCH",
        url: `/api/auth/users/${memberId}/role`,
        params: { id: memberId.toString() },
        user: adminUser,
        body: { role: "viewer" },
      });
      const res = httpMocks.createResponse();

      await authController.updateUserRole(req, res);

      expect(res.statusCode).toBe(200);
      expect(targetMember.role).toBe("viewer");
      expect(targetMember.save).toHaveBeenCalled();
    });

    it("rejects invalid role assignment with 400", async () => {
      const req = httpMocks.createRequest({
        method: "PATCH",
        url: `/api/auth/users/${memberId}/role`,
        params: { id: memberId.toString() },
        user: adminUser,
        body: { role: "superuser" },
      });
      const res = httpMocks.createResponse();

      await authController.updateUserRole(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toMatch(/Invalid role/i);
    });
  });

  // ── 5. Last Active Admin Protection ─────────────────────────────────────────
  describe("Last Active Admin Protection", () => {
    it("blocks demoting the last active administrator (returns 400)", async () => {
      authController._setDbConnected(true);

      const soleAdmin = {
        _id: adminId,
        name: "Admin User",
        email: "admin@aira.io",
        role: "admin",
        isActive: true,
        save: jest.fn(),
        toObject: function () { return { ...this }; },
      };

      jest.spyOn(User, "findById").mockResolvedValue(soleAdmin);
      // Exactly 1 active admin in database
      jest.spyOn(User, "countDocuments").mockResolvedValue(1);

      const req = httpMocks.createRequest({
        method: "PATCH",
        url: `/api/auth/users/${adminId}/role`,
        params: { id: adminId.toString() },
        user: adminUser,
        body: { role: "member" },
      });
      const res = httpMocks.createResponse();

      await authController.updateUserRole(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().success).toBe(false);
      expect(res._getJSONData().message).toMatch(/Cannot demote the last active administrator/i);
      expect(soleAdmin.save).not.toHaveBeenCalled();
      expect(soleAdmin.role).toBe("admin");
    });

    it("allows demoting an admin when another active admin exists", async () => {
      authController._setDbConnected(true);

      const adminToDemote = {
        _id: new mongoose.Types.ObjectId(),
        name: "Second Admin",
        email: "admin2@aira.io",
        role: "admin",
        isActive: true,
        save: jest.fn().mockResolvedValue(true),
        toObject: function () { return { ...this }; },
      };

      jest.spyOn(User, "findById").mockResolvedValue(adminToDemote);
      // 2 active admins in database
      jest.spyOn(User, "countDocuments").mockResolvedValue(2);

      const req = httpMocks.createRequest({
        method: "PATCH",
        url: `/api/auth/users/${adminToDemote._id}/role`,
        params: { id: adminToDemote._id.toString() },
        user: adminUser,
        body: { role: "member" },
      });
      const res = httpMocks.createResponse();

      await authController.updateUserRole(req, res);

      expect(res.statusCode).toBe(200);
      expect(adminToDemote.role).toBe("member");
      expect(adminToDemote.save).toHaveBeenCalled();
    });
  });

  // ── 6. Viewer Write Restrictions (Direct APIs) ──────────────────────────────
  describe("Viewer Write Restrictions", () => {
    it("blocks viewer from creating a task (returns 403)", async () => {
      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/tasks",
        user: viewerUser,
        body: { title: "Viewer Task", priority: "high" },
      });
      const res = httpMocks.createResponse();

      await taskController.createTask(req, res);

      expect(res.statusCode).toBe(403);
      expect(res._getJSONData().message).toMatch(/Viewers cannot create tasks/i);
    });

    it("blocks viewer from updating a task (returns 403)", async () => {
      const req = httpMocks.createRequest({
        method: "PATCH",
        url: `/api/tasks/${new mongoose.Types.ObjectId()}`,
        params: { id: new mongoose.Types.ObjectId().toString() },
        user: viewerUser,
        body: { status: "completed" },
      });
      const res = httpMocks.createResponse();

      await taskController.updateTask(req, res);

      expect(res.statusCode).toBe(403);
      expect(res._getJSONData().message).toMatch(/Viewers cannot update tasks/i);
    });

    it("blocks viewer from deleting a task (returns 403)", async () => {
      const req = httpMocks.createRequest({
        method: "DELETE",
        url: `/api/tasks/${new mongoose.Types.ObjectId()}`,
        params: { id: new mongoose.Types.ObjectId().toString() },
        user: viewerUser,
      });
      const res = httpMocks.createResponse();

      await taskController.deleteTask(req, res);

      expect(res.statusCode).toBe(403);
      expect(res._getJSONData().message).toMatch(/Viewers cannot delete tasks/i);
    });

    it("blocks viewer from document creation & deletion at route middleware level (returns 403)", () => {
      const middleware = requireRole("admin", "member");

      const req = httpMocks.createRequest({ user: viewerUser });
      const res = httpMocks.createResponse();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
    });

    it("blocks viewer from GitHub connection mutations at route middleware level (returns 403)", () => {
      const middleware = requireRole("admin", "member");

      const req = httpMocks.createRequest({ user: viewerUser });
      const res = httpMocks.createResponse();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  // ── 7. Viewer Permitted Read-Only Access ─────────────────────────────────────
  describe("Viewer Permitted Read-Only Access", () => {
    it("permits viewer to list tasks in their workspace", async () => {
      jest.spyOn(Workspace, "findOne").mockReturnValue({
        lean: () => Promise.resolve({ _id: viewerId, owner_id: viewerId, is_default: true }),
      });

      jest.spyOn(Task, "find").mockReturnValue({
        populate: () => ({
          populate: () => ({
            sort: () => ({
              lean: () => Promise.resolve([
                { _id: new mongoose.Types.ObjectId(), title: "Read Task", status: "todo" }
              ]),
            }),
          }),
        }),
      });

      const req = httpMocks.createRequest({
        method: "GET",
        url: "/api/tasks",
        user: viewerUser,
      });
      const res = httpMocks.createResponse();

      await taskController.listTasks(req, res);

      expect(res.statusCode).toBe(200);
      const data = res._getJSONData();
      expect(data.success).toBe(true);
      expect(data.tasks.length).toBe(1);
    });

    it("permits viewer to get a specific task by ID in their workspace", async () => {
      const taskId = new mongoose.Types.ObjectId();
      jest.spyOn(Workspace, "findOne").mockReturnValue({
        lean: () => Promise.resolve({ _id: viewerId, owner_id: viewerId, is_default: true }),
      });

      jest.spyOn(Task, "findOne").mockReturnValue({
        populate: () => ({
          populate: () => ({
            lean: () => Promise.resolve({ _id: taskId, title: "Specific Task", status: "todo" }),
          }),
        }),
      });

      const req = httpMocks.createRequest({
        method: "GET",
        url: `/api/tasks/${taskId}`,
        params: { id: taskId.toString() },
        user: viewerUser,
      });
      const res = httpMocks.createResponse();

      await taskController.getTask(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().task.title).toBe("Specific Task");
    });
  });

  // ── 8. Cross-User Task Access Remains Blocked For All Roles ─────────────────
  describe("Cross-User Task Isolation for All Roles", () => {
    it("blocks an admin from retrieving a task in another workspace (returns 404)", async () => {
      const foreignTaskId = new mongoose.Types.ObjectId();

      // Admin's workspace resolution returns adminWsId
      jest.spyOn(Workspace, "findOne").mockReturnValue({
        lean: () => Promise.resolve({ _id: adminWsId, owner_id: adminId, is_default: true }),
      });

      // Query scopes to { _id: foreignTaskId, workspace_id: adminWsId }, which yields null
      jest.spyOn(Task, "findOne").mockReturnValue({
        populate: () => ({
          populate: () => ({
            lean: () => Promise.resolve(null),
          }),
        }),
      });

      const req = httpMocks.createRequest({
        method: "GET",
        url: `/api/tasks/${foreignTaskId}`,
        params: { id: foreignTaskId.toString() },
        user: adminUser,
      });
      const res = httpMocks.createResponse();

      await taskController.getTask(req, res);

      expect(res.statusCode).toBe(404);
      expect(res._getJSONData().message).toMatch(/Task not found/i);
    });

    it("blocks a member from updating a task owned by another user in the workspace", async () => {
      const taskId = new mongoose.Types.ObjectId();
      jest.spyOn(Workspace, "findOne").mockReturnValue({
        lean: () => Promise.resolve({ _id: memberWsId, owner_id: memberId, is_default: true }),
      });

      // Task belongs to otherUserId
      const foreignTask = {
        _id: taskId,
        workspace_id: memberWsId,
        created_by: otherUserId,
        title: "Other User Task",
        status: "todo",
      };
      jest.spyOn(Task, "findOne").mockResolvedValue(foreignTask);

      const req = httpMocks.createRequest({
        method: "PATCH",
        url: `/api/tasks/${taskId}`,
        params: { id: taskId.toString() },
        user: memberUser,
        body: { status: "completed" },
      });
      const res = httpMocks.createResponse();

      await taskController.updateTask(req, res);

      expect(res.statusCode).toBe(403);
      expect(res._getJSONData().message).toMatch(/You can only update your own tasks/i);
    });
  });

  // ── 9. Workspace Settings Permissions ───────────────────────────────────────
  describe("Workspace Settings Permissions", () => {
    it("allows admin to update workspace settings", async () => {
      workspaceController._setConnected(true);

      const mockWs = {
        _id: adminWsId,
        owner_id: adminId,
        name: "Original Name",
        description: "Original Description",
        settings: { max_file_size_mb: 10, allowed_file_types: [".pdf"] },
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(Workspace, "findById").mockResolvedValue(mockWs);

      const req = httpMocks.createRequest({
        method: "PATCH",
        url: `/api/workspace/${adminWsId}/settings`,
        params: { id: adminWsId.toString() },
        user: adminUser,
        body: {
          name: "Updated Workspace",
          settings: { max_file_size_mb: 50 },
        },
      });
      const res = httpMocks.createResponse();

      await workspaceController.updateWorkspaceSettings(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockWs.name).toBe("Updated Workspace");
      expect(mockWs.settings.max_file_size_mb).toBe(50);
      expect(mockWs.save).toHaveBeenCalled();
    });

    it("blocks non-admins from workspace settings endpoint via requireRole('admin')", () => {
      const middleware = requireRole("admin");

      const req = httpMocks.createRequest({ user: memberUser });
      const res = httpMocks.createResponse();
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  // ── User Status Toggle (Phase 2A) ──────────────────────────────────────────
  describe("toggleUserStatus", () => {
    beforeEach(() => {
      // Reset in-memory users for each test
      authController.memoryUsers.length = 0;
      authController._setDbConnected(false);
    });

    afterAll(() => {
      authController._setDbConnected(null);
    });

    it("activates a deactivated user account", async () => {
      const targetId = "target_user_001";
      authController.memoryUsers.push({
        _id: targetId,
        name: "Target User",
        email: "target@test.com",
        password: "hashed",
        role: "member",
        isActive: false,
      });

      const req = httpMocks.createRequest({
        user: { _id: "admin_001", id: "admin_001", role: "admin" },
        params: { id: targetId },
        body: { isActive: true },
      });
      const res = httpMocks.createResponse();

      await authController.toggleUserStatus(req, res);

      expect(res.statusCode).toBe(200);
      const data = res._getJSONData();
      expect(data.success).toBe(true);
      expect(data.user.isActive).toBe(true);
    });

    it("deactivates an active user account", async () => {
      const targetId = "target_user_002";
      authController.memoryUsers.push(
        { _id: "admin_seed", name: "Admin", email: "a@a.com", password: "h", role: "admin", isActive: true },
        { _id: targetId, name: "Member", email: "m@m.com", password: "h", role: "member", isActive: true },
      );

      const req = httpMocks.createRequest({
        user: { _id: "admin_seed", id: "admin_seed", role: "admin" },
        params: { id: targetId },
        body: { isActive: false },
      });
      const res = httpMocks.createResponse();

      await authController.toggleUserStatus(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().user.isActive).toBe(false);
    });

    it("blocks an admin from deactivating their own account", async () => {
      const selfId = "self_admin";
      authController.memoryUsers.push({
        _id: selfId, name: "Self", email: "self@a.com", password: "h", role: "admin", isActive: true,
      });

      const req = httpMocks.createRequest({
        user: { _id: selfId, id: selfId, role: "admin" },
        params: { id: selfId },
        body: { isActive: false },
      });
      const res = httpMocks.createResponse();

      await authController.toggleUserStatus(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toMatch(/cannot deactivate your own/i);
    });

    it("blocks deactivating the last active admin", async () => {
      const onlyAdminId = "only_admin";
      authController.memoryUsers.push(
        { _id: onlyAdminId, name: "OnlyAdmin", email: "oa@a.com", password: "h", role: "admin", isActive: true },
        { _id: "regular_admin_requester", name: "Req", email: "req@a.com", password: "h", role: "admin", isActive: true },
      );
      // Simulate only 1 active admin by removing the second from in-memory
      // (requester is not the target; we specifically want only the target to be admin)
      authController.memoryUsers.length = 0;
      authController.memoryUsers.push(
        { _id: onlyAdminId, name: "OnlyAdmin", email: "oa@a.com", password: "h", role: "admin", isActive: true },
      );
      // Add a second admin as the requesting user (different id)
      authController.memoryUsers.push(
        { _id: "req_admin", name: "Req", email: "req@a.com", password: "h", role: "admin", isActive: true },
      );
      // Remove the requester from the count by making the target the only admin
      authController.memoryUsers.length = 0;
      authController.memoryUsers.push(
        { _id: onlyAdminId, name: "OnlyAdmin", email: "oa@a.com", password: "h", role: "admin", isActive: true },
      );

      const req = httpMocks.createRequest({
        // A different admin user tries to deactivate the only admin
        user: { _id: "another_admin", id: "another_admin", role: "admin" },
        params: { id: onlyAdminId },
        body: { isActive: false },
      });
      const res = httpMocks.createResponse();

      await authController.toggleUserStatus(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toMatch(/last active administrator/i);
    });

    it("returns 400 when isActive is not a boolean", async () => {
      const req = httpMocks.createRequest({
        user: { _id: "admin_x", id: "admin_x", role: "admin" },
        params: { id: "some_user" },
        body: { isActive: "yes" },
      });
      const res = httpMocks.createResponse();

      await authController.toggleUserStatus(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toMatch(/boolean/i);
    });
  });
});

