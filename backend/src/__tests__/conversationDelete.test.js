/**
 * Conversation Delete & Clear All History — Regression Tests
 * ===========================================================
 * Tests:
 * 1. clearAllConversations deletes all user conversations and their messages.
 * 2. clearAllConversations with workspace_id filter scopes deletions.
 * 3. clearAllConversations on empty history returns success with deletedCount: 0.
 * 4. clearAllConversations does NOT touch other users' conversations.
 * 5. deleteConversation deletes one conversation and its messages.
 * 6. deleteConversation rejects invalid ObjectId with 400.
 * 7. deleteConversation returns 404 for non-existent conversation.
 * 8. deleteConversation returns 403 when user does not own the conversation.
 * 9. clearAllConversations returns 503 when DB is disconnected.
 */

const httpMocks = require("node-mocks-http");
const mongoose = require("mongoose");
const conversationController = require("../controllers/conversationController");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides = {}) {
  return { _id: new mongoose.Types.ObjectId(), name: "Test User", role: "member", ...overrides };
}

function makeConvId() {
  return new mongoose.Types.ObjectId();
}

/**
 * Patch mongoose.connection.readyState for a single test.
 * Jest cannot spy on non-configurable properties, so we use Object.defineProperty.
 * Returns a restore function — always call it in afterEach / finally.
 */
function patchReadyState(value) {
  const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState");
  Object.defineProperty(mongoose.connection, "readyState", {
    get: () => value,
    configurable: true,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(mongoose.connection, "readyState", descriptor);
    }
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("Conversation Delete & Clear History Controller Tests", () => {
  let userA;
  let userB;
  let wsId;
  let convId;
  let restoreReadyState;

  beforeAll(() => {
    userA = makeUser();
    userB = makeUser();
    wsId = new mongoose.Types.ObjectId();
    convId = makeConvId();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (restoreReadyState) {
      restoreReadyState();
      restoreReadyState = null;
    }
  });

  // ── 1. clearAllConversations: deletes all user conversations ──────────────

  test("clearAllConversations deletes all conversations and messages for the user", async () => {
    const id1 = makeConvId();
    const id2 = makeConvId();

    restoreReadyState = patchReadyState(1);

    jest.spyOn(Conversation, "find").mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: id1 }, { _id: id2 }]),
      }),
    });

    jest.spyOn(Message, "deleteMany").mockResolvedValue({ deletedCount: 5 });
    jest.spyOn(Conversation, "deleteMany").mockResolvedValue({ deletedCount: 2 });

    const req = httpMocks.createRequest({
      method: "DELETE",
      user: userA,
      query: {},
    });
    const res = httpMocks.createResponse();

    await conversationController.clearAllConversations(req, res);

    expect(res.statusCode).toBe(200);
    const body = res._getJSONData();
    expect(body.success).toBe(true);
    expect(body.deletedCount).toBe(2);
    expect(body.messagesDeletedCount).toBe(5);

    // deleteMany must be scoped to userA's conversation IDs
    const convDeleteArgs = Conversation.deleteMany.mock.calls[0][0];
    expect(convDeleteArgs.user_id.toString()).toBe(userA._id.toString());
    expect(convDeleteArgs._id.$in).toHaveLength(2);
  });

  // ── 2. clearAllConversations with workspace_id filter ────────────────────

  test("clearAllConversations with valid workspace_id scopes filter", async () => {
    restoreReadyState = patchReadyState(1);

    jest.spyOn(Conversation, "find").mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: makeConvId() }]),
      }),
    });
    jest.spyOn(Message, "deleteMany").mockResolvedValue({ deletedCount: 2 });
    jest.spyOn(Conversation, "deleteMany").mockResolvedValue({ deletedCount: 1 });

    const req = httpMocks.createRequest({
      method: "DELETE",
      user: userA,
      query: { workspace_id: wsId.toString() },
    });
    const res = httpMocks.createResponse();

    await conversationController.clearAllConversations(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().success).toBe(true);

    // Confirm Conversation.find was called with workspace_id in filter
    const findArgs = Conversation.find.mock.calls[0][0];
    expect(findArgs.workspace_id).toBe(wsId.toString());
  });

  // ── 3. clearAllConversations on empty history ─────────────────────────────

  test("clearAllConversations returns success with deletedCount 0 when no conversations exist", async () => {
    restoreReadyState = patchReadyState(1);
    jest.spyOn(Conversation, "find").mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });

    const req = httpMocks.createRequest({
      method: "DELETE",
      user: userA,
      query: {},
    });
    const res = httpMocks.createResponse();

    await conversationController.clearAllConversations(req, res);

    expect(res.statusCode).toBe(200);
    const body = res._getJSONData();
    expect(body.success).toBe(true);
    expect(body.deletedCount).toBe(0);
    expect(body.messagesDeletedCount).toBe(0);
  });

  // ── 4. clearAllConversations does NOT touch other users' conversations ─────

  test("clearAllConversations scopes deletions to authenticated user only", async () => {
    const userAConvId = makeConvId();
    restoreReadyState = patchReadyState(1);

    // Only userA's conversations are returned by the find()
    jest.spyOn(Conversation, "find").mockImplementation((filter) => {
      expect(filter.user_id.toString()).toBe(userA._id.toString());
      return {
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: userAConvId }]),
        }),
      };
    });

    const msgDeleteSpy = jest.spyOn(Message, "deleteMany").mockResolvedValue({ deletedCount: 3 });
    const convDeleteSpy = jest.spyOn(Conversation, "deleteMany").mockResolvedValue({ deletedCount: 1 });

    const req = httpMocks.createRequest({ method: "DELETE", user: userA, query: {} });
    const res = httpMocks.createResponse();

    await conversationController.clearAllConversations(req, res);

    expect(res.statusCode).toBe(200);
    // The deleteMany for Conversation must also re-assert user_id ownership
    const convDeleteFilter = convDeleteSpy.mock.calls[0][0];
    expect(convDeleteFilter.user_id.toString()).toBe(userA._id.toString());
  });

  // ── 5. deleteConversation deletes one conversation and messages ───────────

  test("deleteConversation deletes the conversation and its messages", async () => {
    restoreReadyState = patchReadyState(1);

    const mockConv = {
      _id: convId,
      user_id: userA._id,
    };

    jest.spyOn(Conversation, "findById").mockResolvedValue(mockConv);
    jest.spyOn(Message, "deleteMany").mockResolvedValue({ deletedCount: 4 });
    jest.spyOn(Conversation, "findByIdAndDelete").mockResolvedValue(mockConv);

    const req = httpMocks.createRequest({
      method: "DELETE",
      params: { id: convId.toString() },
      user: userA,
    });
    const res = httpMocks.createResponse();

    await conversationController.deleteConversation(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().success).toBe(true);
    expect(Message.deleteMany).toHaveBeenCalledWith({ conversation_id: mockConv._id });
    expect(Conversation.findByIdAndDelete).toHaveBeenCalledWith(mockConv._id);
  });

  // ── 6. deleteConversation rejects invalid ObjectId ────────────────────────

  test("deleteConversation returns 400 for invalid conversation ID", async () => {
    restoreReadyState = patchReadyState(1);

    const req = httpMocks.createRequest({
      method: "DELETE",
      params: { id: "not-a-valid-object-id" },
      user: userA,
    });
    const res = httpMocks.createResponse();

    await conversationController.deleteConversation(req, res);

    expect(res.statusCode).toBe(400);
    const body = res._getJSONData();
    expect(body.success).toBe(false);
    expect(body.code).toBe("INVALID_ID");
  });

  // ── 7. deleteConversation returns 404 for non-existent conversation ────────

  test("deleteConversation returns 404 when conversation does not exist", async () => {
    restoreReadyState = patchReadyState(1);
    jest.spyOn(Conversation, "findById").mockResolvedValue(null);

    const req = httpMocks.createRequest({
      method: "DELETE",
      params: { id: convId.toString() },
      user: userA,
    });
    const res = httpMocks.createResponse();

    await conversationController.deleteConversation(req, res);

    expect(res.statusCode).toBe(404);
    expect(res._getJSONData().code).toBe("NOT_FOUND");
  });

  // ── 8. deleteConversation returns 403 for cross-user access ───────────────

  test("deleteConversation returns 403 when userB tries to delete userA's conversation", async () => {
    restoreReadyState = patchReadyState(1);

    jest.spyOn(Conversation, "findById").mockResolvedValue({
      _id: convId,
      user_id: userA._id,
    });

    const msgDeleteSpy = jest.spyOn(Message, "deleteMany").mockResolvedValue({ deletedCount: 0 });
    const findAndDeleteSpy = jest.spyOn(Conversation, "findByIdAndDelete").mockResolvedValue(null);

    // Request comes from userB
    const req = httpMocks.createRequest({
      method: "DELETE",
      params: { id: convId.toString() },
      user: userB,
    });
    const res = httpMocks.createResponse();

    await conversationController.deleteConversation(req, res);

    expect(res.statusCode).toBe(403);
    expect(res._getJSONData().code).toBe("FORBIDDEN");
    // Ensure no deletion occurred
    expect(msgDeleteSpy).not.toHaveBeenCalled();
    expect(findAndDeleteSpy).not.toHaveBeenCalled();
  });

  // ── 9. clearAllConversations returns 503 when DB is disconnected ──────────

  test("clearAllConversations returns 503 when database is not connected", async () => {
    restoreReadyState = patchReadyState(0);

    const req = httpMocks.createRequest({
      method: "DELETE",
      user: userA,
      query: {},
    });
    const res = httpMocks.createResponse();

    await conversationController.clearAllConversations(req, res);

    expect(res.statusCode).toBe(503);
    expect(res._getJSONData().code).toBe("DB_UNAVAILABLE");
  });
});
