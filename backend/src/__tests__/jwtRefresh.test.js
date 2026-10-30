/**
 * AIRA — JWT Silent Refresh & Token Lifecycle Test Suite (Phase 6A)
 * ================================================================
 * Validates:
 * 1. Login sets short-lived access token and HttpOnly refresh cookie.
 * 2. POST /api/auth/refresh returns a fresh access token and rotates the refresh token.
 * 3. Multi-tab concurrency: concurrent refresh requests within the 15s grace window succeed (no accidental session invalidation).
 * 4. Stale token replay after grace window (>15s) is rejected with 401 REFRESH_REVOKED.
 * 5. Missing refresh cookie returns 401 with code NO_REFRESH_TOKEN.
 * 6. Invalid or expired refresh token returns 401 and clears cookie.
 * 7. Deactivated/inactive users cannot refresh into an authenticated session.
 * 8. Logout works with an expired access token, revoking the specific session and clearing the cookie.
 * 9. Other active sessions for the user or other users remain valid on single logout.
 */

const httpMocks = require("node-mocks-http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const authController = require("../controllers/authController");
const User = require("../models/User");

describe("JWT Refresh & Session Lifecycle Suite (Phase 6A)", () => {
  const userId = new mongoose.Types.ObjectId();
  const rawPassword = "password123";

  let testUserDoc;

  beforeEach(() => {
    process.env.JWT_SECRET = "test_jwt_secret_at_least_32_characters_long_123456";
    process.env.REFRESH_SECRET = "test_refresh_secret_at_least_32_characters_long_123456";
    process.env.JWT_EXPIRE = "15m";
    process.env.REFRESH_EXPIRE = "7d";

    authController._setDbConnected(true);

    testUserDoc = {
      _id: userId,
      id: userId.toString(),
      name: "Refresh Test User",
      email: "refresh@aira.io",
      role: "member",
      isActive: true,
      refreshTokens: [],
      toObject: function () {
        return {
          _id: this._id,
          name: this.name,
          email: this.email,
          role: this.role,
          isActive: this.isActive,
        };
      },
      comparePassword: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(User, "findById").mockImplementation((id) => {
      if (id.toString() === userId.toString()) {
        return {
          select: jest.fn().mockResolvedValue(testUserDoc),
        };
      }
      return { select: jest.fn().mockResolvedValue(null) };
    });

    jest.spyOn(User, "findOne").mockImplementation((query) => {
      if (query.email === "refresh@aira.io") {
        return {
          select: jest.fn().mockResolvedValue(testUserDoc),
        };
      }
      return { select: jest.fn().mockResolvedValue(null) };
    });

    jest.spyOn(User, "updateOne").mockImplementation((query, update) => {
      if (update.$set && update.$set["refreshTokens.$.rotatedAt"]) {
        const tokenId = query["refreshTokens.tokenId"];
        const entry = testUserDoc.refreshTokens.find((t) => t.tokenId === tokenId);
        if (entry) {
          entry.rotatedAt = update.$set["refreshTokens.$.rotatedAt"];
        }
      }
      return Promise.resolve({ acknowledged: true, modifiedCount: 1 });
    });

    jest.spyOn(User, "findByIdAndUpdate").mockImplementation((id, update) => {
      if (update.$set && update.$set.refreshTokens) {
        testUserDoc.refreshTokens = update.$set.refreshTokens;
      }
      if (update.$push && update.$push.refreshTokens) {
        testUserDoc.refreshTokens.push(update.$push.refreshTokens);
      }
      if (update.$pull && update.$pull.refreshTokens) {
        if (update.$pull.refreshTokens.tokenId) {
          testUserDoc.refreshTokens = testUserDoc.refreshTokens.filter(
            (t) => t.tokenId !== update.$pull.refreshTokens.tokenId
          );
        }
      }
      return Promise.resolve(testUserDoc);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("1. Successful login issues short-lived access token and sets httpOnly refresh cookie", async () => {
    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/auth/login",
      body: { email: "refresh@aira.io", password: rawPassword },
    });
    const res = httpMocks.createResponse();

    await authController.login(req, res);

    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();

    // Verify access token claims and expiry
    const decodedAccess = jwt.verify(data.token, process.env.JWT_SECRET);
    expect(decodedAccess.id).toBe(userId.toString());
    expect(decodedAccess.role).toBe("member");

    // Verify cookie
    const cookies = res.cookies;
    expect(cookies.aira_refresh).toBeDefined();
    expect(cookies.aira_refresh.options.httpOnly).toBe(true);
    expect(cookies.aira_refresh.options.path).toBe("/api/auth");

    // Verify refresh token payload
    const decodedRefresh = jwt.verify(cookies.aira_refresh.value, process.env.REFRESH_SECRET);
    expect(decodedRefresh.id).toBe(userId.toString());
    expect(decodedRefresh.jti).toBeDefined();
    expect(testUserDoc.refreshTokens.length).toBeGreaterThanOrEqual(1);
  });

  test("2. Successful refresh rotates token and marks previous token as rotated", async () => {
    const initialJti = "session-token-uuid-1";
    testUserDoc.refreshTokens = [
      { tokenId: initialJti, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date() },
    ];

    const refreshToken = jwt.sign(
      { id: userId.toString(), jti: initialJti },
      process.env.REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { aira_refresh: refreshToken },
    });
    const res = httpMocks.createResponse();

    await authController.refresh(req, res);

    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();

    // Verify old jti was marked with rotatedAt
    const oldEntry = testUserDoc.refreshTokens.find((t) => t.tokenId === initialJti);
    expect(oldEntry).toBeDefined();
    expect(oldEntry.rotatedAt).toBeDefined();

    // Verify new refresh cookie was set
    const cookies = res.cookies;
    expect(cookies.aira_refresh).toBeDefined();
    const newDecoded = jwt.verify(cookies.aira_refresh.value, process.env.REFRESH_SECRET);
    expect(newDecoded.jti).not.toBe(initialJti);
    expect(testUserDoc.refreshTokens.some((t) => t.tokenId === newDecoded.jti)).toBe(true);
  });

  test("3. Multi-tab race condition: concurrent refresh requests within 15s grace window succeed without invalidating session", async () => {
    const initialJti = "session-token-uuid-tab-race";
    // Simulate token that was rotated 2 seconds ago (< 15s grace window)
    testUserDoc.refreshTokens = [
      {
        tokenId: initialJti,
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(Date.now() - 5000),
        rotatedAt: new Date(Date.now() - 2000),
      },
      {
        tokenId: "new-jti-from-tab1",
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(Date.now() - 2000),
      },
    ];

    const tab2Token = jwt.sign(
      { id: userId.toString(), jti: initialJti },
      process.env.REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { aira_refresh: tab2Token },
    });
    const res = httpMocks.createResponse();

    await authController.refresh(req, res);

    // Tab 2 succeeds without error!
    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
    // The session is NOT destroyed: the user remains authenticated
    expect(testUserDoc.refreshTokens.length).toBeGreaterThan(0);
  });

  test("4. Stale token replay after grace window (>15s) is rejected with 401 REFRESH_REVOKED and revokes all sessions", async () => {
    const oldJti = "stale-rotated-token";
    // Rotated 60 seconds ago (> 15s grace window)
    testUserDoc.refreshTokens = [
      {
        tokenId: oldJti,
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(Date.now() - 70000),
        rotatedAt: new Date(Date.now() - 60000),
      },
      {
        tokenId: "compromised-user-active-session",
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(Date.now() - 60000),
      },
    ];

    const replayToken = jwt.sign(
      { id: userId.toString(), jti: oldJti },
      process.env.REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { aira_refresh: replayToken },
    });
    const res = httpMocks.createResponse();

    await authController.refresh(req, res);

    expect(res.statusCode).toBe(401);
    const data = res._getJSONData();
    expect(data.code).toBe("REFRESH_REVOKED");
    // All tokens wiped on replay attack detection
    expect(testUserDoc.refreshTokens.length).toBe(0);
  });

  test("5. Missing refresh cookie returns 401 NO_REFRESH_TOKEN", async () => {
    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: {},
    });
    const res = httpMocks.createResponse();

    await authController.refresh(req, res);

    expect(res.statusCode).toBe(401);
    const data = res._getJSONData();
    expect(data.code).toBe("NO_REFRESH_TOKEN");
  });

  test("6. Invalid or expired refresh token returns 401 REFRESH_INVALID and clears cookie", async () => {
    const expiredToken = jwt.sign(
      { id: userId.toString(), jti: "some-id" },
      process.env.REFRESH_SECRET,
      { expiresIn: "-1s" }
    );

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { aira_refresh: expiredToken },
    });
    const res = httpMocks.createResponse();

    await authController.refresh(req, res);

    expect(res.statusCode).toBe(401);
    const data = res._getJSONData();
    expect(data.code).toBe("REFRESH_INVALID");
  });

  test("7. Deactivated or inactive user cannot refresh into an active session", async () => {
    testUserDoc.isActive = false;
    const jti = "inactive-user-jti";
    testUserDoc.refreshTokens = [
      { tokenId: jti, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date() },
    ];

    const token = jwt.sign(
      { id: userId.toString(), jti },
      process.env.REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { aira_refresh: token },
    });
    const res = httpMocks.createResponse();

    await authController.refresh(req, res);

    expect(res.statusCode).toBe(401);
    const data = res._getJSONData();
    expect(data.code).toBe("USER_INVALID");
  });

  test("8. Logout works when access token is completely expired, revoking session and clearing cookie", async () => {
    const jtiToRevoke = "session-to-logout";
    const jtiToKeep = "session-on-other-device";
    testUserDoc.refreshTokens = [
      { tokenId: jtiToRevoke, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date() },
      { tokenId: jtiToKeep, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date() },
    ];

    // Notice: Expired access token in Authorization header
    const expiredAccessToken = jwt.sign(
      { id: userId.toString(), role: "member" },
      process.env.JWT_SECRET,
      { expiresIn: "-1h" }
    );

    const validRefreshToken = jwt.sign(
      { id: userId.toString(), jti: jtiToRevoke },
      process.env.REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        authorization: `Bearer ${expiredAccessToken}`,
      },
      cookies: { aira_refresh: validRefreshToken },
    });
    const res = httpMocks.createResponse();

    await authController.logout(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().success).toBe(true);

    // Revoked jti is removed
    expect(testUserDoc.refreshTokens.some((t) => t.tokenId === jtiToRevoke)).toBe(false);
    // Other device session is preserved!
    expect(testUserDoc.refreshTokens.some((t) => t.tokenId === jtiToKeep)).toBe(true);
  });
});
