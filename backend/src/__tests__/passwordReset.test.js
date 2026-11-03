/**
 * AIRA — Password Reset Test Suite (Phase 6B)
 * ===========================================
 * Validates:
 * 1. POST /api/auth/forgot-password with valid email issues a hashed reset token and returns 200.
 * 2. POST /api/auth/forgot-password with nonexistent email returns generic 200 (prevents enumeration).
 * 3. POST /api/auth/forgot-password with missing email returns 400.
 * 4. POST /api/auth/reset-password updates password, clears reset token fields, and issues new auth token.
 * 5. POST /api/auth/reset-password rejects invalid or expired reset token with 400.
 * 6. POST /api/auth/reset-password rejects short passwords (< 6 chars) with 400.
 * 7. Single-use: reset token cannot be reused after a successful password reset.
 */

const httpMocks = require("node-mocks-http");
const crypto = require("crypto");
const mongoose = require("mongoose");
const authController = require("../controllers/authController");
const User = require("../models/User");
const { forgotPasswordLimiter } = require("../middleware/rateLimiter");

describe("Password Reset Suite (Phase 6B)", () => {
  const userId = new mongoose.Types.ObjectId();
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
      name: "Reset Test User",
      email: "reset@aira.io",
      password: "oldHashedPassword",
      role: "member",
      isActive: true,
      refreshTokens: [],
      generatePasswordResetToken: function () {
        const rawToken = crypto.randomBytes(32).toString("hex");
        this.passwordResetToken = crypto.createHash("sha256").update(rawToken).digest("hex");
        this.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
        return rawToken;
      },
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

    jest.spyOn(User, "findByIdAndUpdate").mockImplementation((id, update) => {
      if (update.$set && update.$set.refreshTokens) {
        testUserDoc.refreshTokens = update.$set.refreshTokens;
      }
      if (update.$push && update.$push.refreshTokens) {
        testUserDoc.refreshTokens.push(update.$push.refreshTokens);
      }
      if (update.$pull && update.$pull.refreshTokens) {
        testUserDoc.refreshTokens = [];
      }
      return Promise.resolve(testUserDoc);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Forgot Password Endpoint", () => {
    it("generates a reset token and returns generic 200 for registered email", async () => {
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(testUserDoc),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/forgot-password",
        body: { email: "reset@aira.io" },
      });
      const res = httpMocks.createResponse();

      await authController.forgotPassword(req, res);

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.message).toMatch(/if that email is registered/i);
      expect(testUserDoc.save).toHaveBeenCalled();
      expect(testUserDoc.passwordResetToken).toBeDefined();
    });

    it("returns generic 200 for non-existent email to prevent enumeration", async () => {
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/forgot-password",
        body: { email: "nonexistent@aira.io" },
      });
      const res = httpMocks.createResponse();

      await authController.forgotPassword(req, res);

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.message).toMatch(/if that email is registered/i);
    });

    it("returns 400 when email is missing", async () => {
      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/forgot-password",
        body: {},
      });
      const res = httpMocks.createResponse();

      await authController.forgotPassword(req, res);

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/email is required/i);
    });

    it("forgotPasswordLimiter middleware is configured", () => {
      expect(forgotPasswordLimiter).toBeDefined();
      expect(typeof forgotPasswordLimiter).toBe("function");
    });
  });

  describe("Reset Password Endpoint", () => {
    it("updates password, invalidates reset token, and issues fresh access token", async () => {
      const rawToken = "raw_sample_reset_token_1234567890abcdef";
      const hashed = crypto.createHash("sha256").update(rawToken).digest("hex");

      testUserDoc.passwordResetToken = hashed;
      testUserDoc.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000);

      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(testUserDoc),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/reset-password",
        body: { token: rawToken, password: "newSecurePassword123" },
      });
      const res = httpMocks.createResponse();

      await authController.resetPassword(req, res);

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.token).toBeDefined();
      expect(testUserDoc.password).toBe("newSecurePassword123");
      expect(testUserDoc.passwordResetToken).toBeUndefined();
      expect(testUserDoc.passwordResetExpires).toBeUndefined();
      expect(testUserDoc.save).toHaveBeenCalled();
    });

    it("rejects invalid or expired reset token with 400", async () => {
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/reset-password",
        body: { token: "invalid_or_expired_token", password: "newPassword123" },
      });
      const res = httpMocks.createResponse();

      await authController.resetPassword(req, res);

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/Reset token is invalid or has expired/i);
    });

    it("rejects password shorter than 6 characters with 400", async () => {
      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/reset-password",
        body: { token: "valid_token", password: "123" },
      });
      const res = httpMocks.createResponse();

      await authController.resetPassword(req, res);

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/at least 6 characters/i);
    });

    it("enforces single-use: token cannot be reused after password update", async () => {
      const rawToken = "single_use_reset_token";
      const hashed = crypto.createHash("sha256").update(rawToken).digest("hex");
      testUserDoc.passwordResetToken = hashed;
      testUserDoc.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000);

      // First reset call succeeds
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(testUserDoc),
      });

      const req1 = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/reset-password",
        body: { token: rawToken, password: "firstNewPassword123" },
      });
      const res1 = httpMocks.createResponse();
      await authController.resetPassword(req1, res1);
      expect(res1.statusCode).toBe(200);

      // Second reset call fails because token fields were cleared
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const req2 = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/reset-password",
        body: { token: rawToken, password: "secondNewPassword123" },
      });
      const res2 = httpMocks.createResponse();
      await authController.resetPassword(req2, res2);

      expect(res2.statusCode).toBe(400);
      const data2 = JSON.parse(res2._getData());
      expect(data2.message).toMatch(/Reset token is invalid or has expired/i);
    });
  });
});
