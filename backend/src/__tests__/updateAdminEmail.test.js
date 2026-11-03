/**
 * AIRA — Update Admin Email Unit Test Suite
 * ==========================================
 * Tests the safe admin email migration script:
 * 1. Email format validation and identical email detection.
 * 2. MongoDB URI secret masking (never exposes credentials).
 * 3. Exact single-admin user targeting:
 *    - Rejects if user not found.
 *    - Rejects if user is not an admin.
 *    - Rejects if multiple users match oldEmail (integrity error).
 * 4. Duplicate email collision prevention (newEmail already taken).
 * 5. Dry-run mode: calculates and reports changes without saving or sending emails.
 * 6. Live execution:
 *    - Preserves _id, role: "admin", isActive: true, and password hash.
 *    - Updates email to normalized lowercase newEmail.
 *    - Resets isEmailVerified to false.
 *    - Invalidates all active refresh tokens (refreshTokens = []).
 *    - Issues fresh email verification token (SHA-256 hashed with 24h expiry).
 *    - Dispatches verification email.
 * 7. Resilient error handling when email dispatch fails (safe recovery path).
 */

const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/User");
const authController = require("../controllers/authController");
const { updateAdminEmail, sanitizeMongoUri, isValidEmail } = require("../scripts/updateAdminEmail");

describe("Update Admin Email Script (Safe Migration)", () => {
  const adminId = new mongoose.Types.ObjectId();
  let mockAdminUser;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAdminUser = {
      _id: adminId,
      id: adminId.toString(),
      name: "Existing Admin",
      email: "hm@gmail.com",
      role: "admin",
      isActive: true,
      isEmailVerified: true,
      password: "existingHashedPassword123",
      refreshTokens: [
        { tokenId: "token-1", expiresAt: new Date(Date.now() + 86400000) },
        { tokenId: "token-2", expiresAt: new Date(Date.now() + 86400000) },
      ],
      generateEmailVerificationToken: jest.fn(function () {
        const rawToken = crypto.randomBytes(32).toString("hex");
        this.emailVerificationToken = crypto.createHash("sha256").update(rawToken).digest("hex");
        this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        return rawToken;
      }),
      save: jest.fn().mockResolvedValue(true),
    };
  });

  describe("1. Validation & URI Sanitization", () => {
    it("validates correct and malformed email addresses", () => {
      expect(isValidEmail("admin@aira.io")).toBe(true);
      expect(isValidEmail("v8463510@gmail.com")).toBe(true);
      expect(isValidEmail("not-an-email")).toBe(false);
      expect(isValidEmail("")).toBe(false);
      expect(isValidEmail("@missingusername.com")).toBe(false);
      expect(isValidEmail("missingdomain@")).toBe(false);
    });

    it("masks credentials in MongoDB connection URIs", () => {
      const sensitiveUri = "mock:uri";
      const sanitized = sanitizeMongoUri(sensitiveUri);
      expect(sanitized).not.toContain("SuperSecretPassword123");
      expect(sanitized).toBe("mongodb+srv://admin_user:****@cluster0.yvheuvo.mongodb.net/aira_db");
    });

    it("rejects invalid source or target email formats", async () => {
      await expect(
        updateAdminEmail({ oldEmail: "invalid-email", newEmail: "v8463510@gmail.com", manageConnection: false })
      ).rejects.toThrow(/Invalid source email/);

      await expect(
        updateAdminEmail({ oldEmail: "hm@gmail.com", newEmail: "invalid-target", manageConnection: false })
      ).rejects.toThrow(/Invalid target email/);
    });

    it("rejects when source and target emails are identical", async () => {
      await expect(
        updateAdminEmail({ oldEmail: "hm@gmail.com", newEmail: "hm@gmail.com", manageConnection: false })
      ).rejects.toThrow(/identical/);
    });
  });

  describe("2. Targeting & Collision Safety Checks", () => {
    it("aborts if newEmail is already registered by another account", async () => {
      jest.spyOn(User, "findOne").mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        email: "v8463510@gmail.com",
      });

      await expect(
        updateAdminEmail({
          oldEmail: "hm@gmail.com",
          newEmail: "v8463510@gmail.com",
          manageConnection: false,
        })
      ).rejects.toThrow(/Collision detected/);
    });

    it("aborts if target oldEmail is not found in database", async () => {
      jest.spyOn(User, "findOne").mockResolvedValue(null);
      jest.spyOn(User, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      });

      await expect(
        updateAdminEmail({
          oldEmail: "hm@gmail.com",
          newEmail: "v8463510@gmail.com",
          manageConnection: false,
        })
      ).rejects.toThrow(/was not found in the database/);
    });

    it("aborts if target user is not an administrator", async () => {
      mockAdminUser.role = "member";
      jest.spyOn(User, "findOne").mockResolvedValue(null);
      jest.spyOn(User, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([mockAdminUser]),
      });

      await expect(
        updateAdminEmail({
          oldEmail: "hm@gmail.com",
          newEmail: "v8463510@gmail.com",
          manageConnection: false,
        })
      ).rejects.toThrow(/is not an administrator/);
    });

    it("aborts if multiple records match oldEmail (database integrity error)", async () => {
      jest.spyOn(User, "findOne").mockResolvedValue(null);
      jest.spyOn(User, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([mockAdminUser, { ...mockAdminUser, _id: new mongoose.Types.ObjectId() }]),
      });

      await expect(
        updateAdminEmail({
          oldEmail: "hm@gmail.com",
          newEmail: "v8463510@gmail.com",
          manageConnection: false,
        })
      ).rejects.toThrow(/integrity error/i);
    });
  });

  describe("3. Dry-Run Mode", () => {
    it("reports planned changes without modifying database or sending emails", async () => {
      jest.spyOn(User, "findOne").mockResolvedValue(null);
      jest.spyOn(User, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([mockAdminUser]),
      });
      const sendSpy = jest.spyOn(authController, "sendEmailVerification");

      const result = await updateAdminEmail({
        oldEmail: "hm@gmail.com",
        newEmail: "v8463510@gmail.com",
        dryRun: true,
        manageConnection: false,
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.userId).toBe(adminId.toString());
      expect(result.role).toBe("admin");
      expect(result.isActive).toBe(true);
      expect(result.oldEmail).toBe("hm@gmail.com");
      expect(result.newEmail).toBe("v8463510@gmail.com");

      // Verify no database mutation or email call occurred
      expect(mockAdminUser.save).not.toHaveBeenCalled();
      expect(mockAdminUser.email).toBe("hm@gmail.com"); // Still original
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe("4. Live Execution & State Preservation", () => {
    it("updates email, preserves _id, role, isActive, password, revokes sessions, and sends verification", async () => {
      jest.spyOn(User, "findOne").mockResolvedValue(null);
      jest.spyOn(User, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([mockAdminUser]),
      });
      const sendSpy = jest.spyOn(authController, "sendEmailVerification").mockResolvedValue({ success: true, sent: true });

      const result = await updateAdminEmail({
        oldEmail: "hm@gmail.com",
        newEmail: "v8463510@gmail.com",
        dryRun: false,
        manageConnection: false,
      });

      expect(result.success).toBe(true);
      expect(result.userId).toBe(adminId.toString());
      expect(result.oldEmail).toBe("hm@gmail.com");
      expect(result.newEmail).toBe("v8463510@gmail.com");
      expect(result.emailSent).toBe(true);

      // Verify preservation
      expect(mockAdminUser._id).toBe(adminId);
      expect(mockAdminUser.role).toBe("admin");
      expect(mockAdminUser.isActive).toBe(true);
      expect(mockAdminUser.password).toBe("existingHashedPassword123");

      // Verify modifications
      expect(mockAdminUser.email).toBe("v8463510@gmail.com");
      expect(mockAdminUser.isEmailVerified).toBe(false);
      expect(mockAdminUser.refreshTokens).toEqual([]); // Revoked sessions

      // Verify verification token generation and save
      expect(mockAdminUser.generateEmailVerificationToken).toHaveBeenCalled();
      expect(mockAdminUser.save).toHaveBeenCalledWith({ validateBeforeSave: true });

      // Verify verification email dispatched to new email
      expect(sendSpy).toHaveBeenCalledWith("v8463510@gmail.com", expect.any(String));
    });

    it("handles email dispatch failure safely without aborting successful database update", async () => {
      jest.spyOn(User, "findOne").mockResolvedValue(null);
      jest.spyOn(User, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([mockAdminUser]),
      });
      // Simulate email dispatch failure
      jest.spyOn(authController, "sendEmailVerification").mockRejectedValue(new Error("SMTP Connection Timeout"));

      const result = await updateAdminEmail({
        oldEmail: "hm@gmail.com",
        newEmail: "v8463510@gmail.com",
        dryRun: false,
        manageConnection: false,
      });

      // Update in DB succeeded
      expect(result.success).toBe(true);
      expect(result.emailSent).toBe(false);
      expect(result.emailError).toContain("SMTP Connection Timeout");
      expect(mockAdminUser.email).toBe("v8463510@gmail.com");
      expect(mockAdminUser.save).toHaveBeenCalled();
    });
  });
});
