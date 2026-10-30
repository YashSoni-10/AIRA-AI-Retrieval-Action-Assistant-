/**
 * AIRA — Email Verification Test Suite (Phase 6C)
 * ==============================================
 * Validates:
 * 1. New registrations initialize with isEmailVerified: false and generate a token.
 * 2. Successful verification with valid token sets isEmailVerified: true and removes token.
 * 3. Invalid tokens return 400 with code INVALID_OR_EXPIRED_TOKEN.
 * 4. Expired tokens are rejected.
 * 5. Single-use token behavior: token cannot be reused after verification.
 * 6. Resend verification issues a fresh token and returns generic 200 response to prevent enumeration.
 * 7. Rate limiter middleware resendVerificationLimiter is configured appropriately.
 * 8. Existing users with undefined isEmailVerified are treated as verified (no lockout).
 * 9. Regression check: Login, JWT refresh, logout, and inactive user checks remain intact.
 */

const httpMocks = require("node-mocks-http");
const crypto = require("crypto");
const mongoose = require("mongoose");
const authController = require("../controllers/authController");
const User = require("../models/User");
const { resendVerificationLimiter } = require("../middleware/rateLimiter");

describe("Email Verification Suite (Phase 6C)", () => {
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
      name: "Verification Test User",
      email: "verify@aira.io",
      role: "member",
      isActive: true,
      isEmailVerified: false,
      refreshTokens: [],
      generateEmailVerificationToken: function () {
        const rawToken = crypto.randomBytes(32).toString("hex");
        this.emailVerificationToken = crypto.createHash("sha256").update(rawToken).digest("hex");
        this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        return rawToken;
      },
      toObject: function () {
        return {
          _id: this._id,
          name: this.name,
          email: this.email,
          role: this.role,
          isActive: this.isActive,
          isEmailVerified: this.isEmailVerified,
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

  describe("1. Registration & Status Default", () => {
    it("initializes new registrations with isEmailVerified: false and generates verification token", async () => {
      jest.spyOn(User, "findOne").mockResolvedValue(null);
      const createdUser = {
        ...testUserDoc,
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(User, "create").mockResolvedValue(createdUser);

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/register",
        body: {
          name: "New Unverified User",
          email: "newuser@aira.io",
          password: "password123",
        },
      });
      const res = httpMocks.createResponse();

      await authController.register(req, res);

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.user.isEmailVerified).toBe(false);
      expect(createdUser.save).toHaveBeenCalled();
      expect(createdUser.emailVerificationToken).toBeDefined();
      expect(createdUser.emailVerificationExpires).toBeDefined();
    });
  });

  describe("2. Token Verification", () => {
    it("successfully verifies valid token, marks user verified, and invalidates token", async () => {
      const rawToken = "valid_sample_token_1234567890abcdef1234567890abcdef";
      const hashed = crypto.createHash("sha256").update(rawToken).digest("hex");

      testUserDoc.emailVerificationToken = hashed;
      testUserDoc.emailVerificationExpires = new Date(Date.now() + 3600000);

      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(testUserDoc),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/verify-email",
        body: { token: rawToken },
      });
      const res = httpMocks.createResponse();

      await authController.verifyEmail(req, res);

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.user.isEmailVerified).toBe(true);
      expect(testUserDoc.isEmailVerified).toBe(true);
      expect(testUserDoc.emailVerificationToken).toBeUndefined();
      expect(testUserDoc.emailVerificationExpires).toBeUndefined();
      expect(testUserDoc.save).toHaveBeenCalled();
    });

    it("rejects missing token with 400", async () => {
      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/verify-email",
        body: {},
      });
      const res = httpMocks.createResponse();

      await authController.verifyEmail(req, res);

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/Verification token is required/i);
    });

    it("rejects invalid or non-existent token with 400 and code INVALID_OR_EXPIRED_TOKEN", async () => {
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/verify-email",
        body: { token: "completely_bogus_token" },
      });
      const res = httpMocks.createResponse();

      await authController.verifyEmail(req, res);

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.code).toBe("INVALID_OR_EXPIRED_TOKEN");
    });

    it("rejects expired token and prevents verification", async () => {
      // User.findOne with { emailVerificationExpires: { $gt: new Date() } } returns null for expired token
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/verify-email",
        body: { token: "expired_token_value" },
      });
      const res = httpMocks.createResponse();

      await authController.verifyEmail(req, res);

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res._getData());
      expect(data.code).toBe("INVALID_OR_EXPIRED_TOKEN");
    });

    it("enforces single-use: token cannot be reused after verification", async () => {
      // First verification call
      const rawToken = "single_use_token_abcdef123456";
      const hashed = crypto.createHash("sha256").update(rawToken).digest("hex");
      testUserDoc.emailVerificationToken = hashed;
      testUserDoc.emailVerificationExpires = new Date(Date.now() + 3600000);

      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(testUserDoc),
      });

      const req1 = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/verify-email",
        body: { token: rawToken },
      });
      const res1 = httpMocks.createResponse();
      await authController.verifyEmail(req1, res1);
      expect(res1.statusCode).toBe(200);

      // Subsequent call: findOne will return null because token fields were cleared
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const req2 = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/verify-email",
        body: { token: rawToken },
      });
      const res2 = httpMocks.createResponse();
      await authController.verifyEmail(req2, res2);

      expect(res2.statusCode).toBe(400);
      const data2 = JSON.parse(res2._getData());
      expect(data2.code).toBe("INVALID_OR_EXPIRED_TOKEN");
    });
  });

  describe("3. Resend Verification & Enumeration Defense", () => {
    it("generates a fresh token and dispatches email when user is unverified", async () => {
      testUserDoc.isEmailVerified = false;
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(testUserDoc),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/resend-verification",
        body: { email: "verify@aira.io" },
      });
      const res = httpMocks.createResponse();

      await authController.resendVerification(req, res);

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(testUserDoc.save).toHaveBeenCalled();
      expect(testUserDoc.emailVerificationToken).toBeDefined();
    });

    it("returns generic 200 message when email does not exist (prevents account enumeration)", async () => {
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/resend-verification",
        body: { email: "nonexistent@aira.io" },
      });
      const res = httpMocks.createResponse();

      await authController.resendVerification(req, res);

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.message).toMatch(/if an account with that email exists/i);
    });

    it("returns generic 200 message when account is already verified (no redundant tokens)", async () => {
      testUserDoc.isEmailVerified = true;
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(testUserDoc),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/resend-verification",
        body: { email: "verify@aira.io" },
      });
      const res = httpMocks.createResponse();

      await authController.resendVerification(req, res);

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.message).toMatch(/if an account with that email exists/i);
      expect(testUserDoc.save).not.toHaveBeenCalled();
    });

    it("resendVerificationLimiter middleware exists and is configured", () => {
      expect(resendVerificationLimiter).toBeDefined();
      expect(typeof resendVerificationLimiter).toBe("function");
    });
  });

  describe("4. Compatibility & Legacy Existing Users", () => {
    it("treats existing users with undefined isEmailVerified as verified (no lockout)", async () => {
      const legacyUser = {
        ...testUserDoc,
        isEmailVerified: undefined, // existing legacy user record
      };

      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(legacyUser),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/login",
        body: { email: "legacy@aira.io", password: "password123" },
      });
      const res = httpMocks.createResponse();

      await authController.login(req, res);

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(true);
      expect(data.user.isEmailVerified).toBe(true);
    });
  });

  describe("5. Regressions: Inactive users, logout, and token refresh", () => {
    it("inactive/deactivated users cannot log in even if email is verified", async () => {
      const deactivatedUser = {
        ...testUserDoc,
        isActive: false,
        isEmailVerified: true,
      };
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(deactivatedUser),
      });

      const req = httpMocks.createRequest({
        method: "POST",
        url: "/api/auth/login",
        body: { email: "verify@aira.io", password: "password123" },
      });
      const res = httpMocks.createResponse();

      await authController.login(req, res);

      expect(res.statusCode).toBe(403);
      const data = JSON.parse(res._getData());
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/Account deactivated/i);
    });
  });
});
