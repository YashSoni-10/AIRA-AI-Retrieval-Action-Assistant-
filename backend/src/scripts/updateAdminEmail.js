/**
 * AIRA — Update Admin Account Email Script
 * =========================================
 * Safely updates an admin account's primary email address with:
 * - Uniqueness validation on the new email address
 * - Exact single-admin user targeting
 * - Preservation of _id, role: "admin", isActive: true, and password hash
 * - Invalidation of old refresh tokens / active sessions
 * - Resetting isEmailVerified to false and issuing a fresh cryptographic verification token
 * - Automated dispatch of verification email via configured SMTP (Brevo) or console fallback
 * - Safe recovery / retry path if email dispatch encounters an issue
 * - Dry-run mode (--dry-run) to preview changes without modifying MongoDB or dispatching emails
 * - Secret sanitization (never logs raw connection strings, passwords, or raw tokens)
 *
 * Usage:
 *   node src/scripts/updateAdminEmail.js <old-email> <new-email> [--dry-run]
 *   or:
 *   npm run update-admin-email <old-email> <new-email> [--dry-run]
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const authController = require("../controllers/authController");

/**
 * Sanitizes a MongoDB URI for safe logging (masks credentials).
 */
function sanitizeMongoUri(uri) {
  if (!uri || typeof uri !== "string") return "[NOT SET]";
  try {
    return uri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
  } catch {
    return "[MALFORMED URI]";
  }
}

/**
 * Validates basic RFC-style email format.
 */
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Main routine to update admin email.
 * Accepts options object or parses process.argv.
 */
async function updateAdminEmail(options = {}) {
  const args = process.argv.slice(2);

  const dryRun = options.dryRun !== undefined
    ? Boolean(options.dryRun)
    : args.includes("--dry-run") || args.includes("-d");

  const nonFlagArgs = args.filter((a) => !a.startsWith("-"));
  const rawOldEmail = options.oldEmail || nonFlagArgs[0] || "hm@gmail.com";
  const rawNewEmail = options.newEmail || nonFlagArgs[1] || "v8463510@gmail.com";

  const oldEmail = String(rawOldEmail).toLowerCase().trim();
  const newEmail = String(rawNewEmail).toLowerCase().trim();

  // 1. Validation
  if (!isValidEmail(oldEmail)) {
    throw new Error(`Invalid source email address format: "${rawOldEmail}"`);
  }
  if (!isValidEmail(newEmail)) {
    throw new Error(`Invalid target email address format: "${rawNewEmail}"`);
  }
  if (oldEmail === newEmail) {
    throw new Error(`Old and new emails are identical ("${oldEmail}"). Nothing to update.`);
  }

  // 2. Database Connection Check
  const mongoUri = options.mongoUri || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI environment variable is not defined.");
  }

  const shouldManageConnection = options.manageConnection !== false && mongoose.connection.readyState !== 1;
  if (shouldManageConnection) {
    console.log(`Connecting to MongoDB (${sanitizeMongoUri(mongoUri)})...`);
    await mongoose.connect(mongoUri);
    console.log(`Connected to database: "${mongoose.connection.name || "default"}".`);
  }

  try {
    // 3. Uniqueness Check on New Email
    const existingTarget = await User.findOne({ email: newEmail });
    if (existingTarget) {
      throw new Error(`Collision detected: Email "${newEmail}" is already registered by account ID ${existingTarget._id}.`);
    }

    // 4. Exact Single Target User Resolution
    const matchingUsers = await User.find({ email: oldEmail }).select("+password +refreshTokens");
    if (!matchingUsers || matchingUsers.length === 0) {
      throw new Error(`Target user with email "${oldEmail}" was not found in the database.`);
    }
    if (matchingUsers.length > 1) {
      throw new Error(`Database integrity error: Found ${matchingUsers.length} users with email "${oldEmail}". Aborting update.`);
    }

    const user = matchingUsers[0];

    // 5. Admin Role Enforcement
    if (user.role !== "admin") {
      throw new Error(`Target account "${oldEmail}" is not an administrator (current role: "${user.role}").`);
    }

    const report = {
      userId: user._id.toString(),
      name: user.name,
      oldEmail: user.email,
      newEmail,
      role: user.role,
      isActive: user.isActive,
      revokedSessionsCount: Array.isArray(user.refreshTokens) ? user.refreshTokens.length : 0,
      dryRun,
    };

    if (dryRun) {
      console.log("\n================ DRY-RUN SUMMARY (NO WRITES PERFORMED) ================");
      console.log(`Target Database:       ${mongoose.connection.name || "connected"}`);
      console.log(`Target User ID:        ${report.userId} (preserved)`);
      console.log(`Target User Name:      ${report.name} (preserved)`);
      console.log(`Target User Role:      ${report.role} (preserved as admin)`);
      console.log(`Account Active Status: ${report.isActive} (preserved as true)`);
      console.log(`Current Email:         ${report.oldEmail}`);
      console.log(`Proposed New Email:    ${report.newEmail}`);
      console.log(`Active Sessions:       ${report.revokedSessionsCount} session(s) will be revoked`);
      console.log(`Verification Status:   will be reset to unverified (isEmailVerified: false)`);
      console.log(`Verification Dispatch: will trigger verification email to ${report.newEmail}`);
      console.log("========================================================================\n");
      return { success: true, ...report, message: "Dry run completed successfully. No changes were made to the database." };
    }

    // 6. Live Update Operations
    user.email = newEmail;
    user.isEmailVerified = false;
    user.refreshTokens = []; // Revoke active sessions

    // Generate fresh cryptographic verification token
    const rawVerificationToken = typeof user.generateEmailVerificationToken === "function"
      ? user.generateEmailVerificationToken()
      : null;

    if (!rawVerificationToken) {
      throw new Error("User model missing generateEmailVerificationToken method.");
    }

    // Save with Mongoose validation enabled
    await user.save({ validateBeforeSave: true });

    // 7. Dispatch Verification Email with Resilient Error Recovery
    let emailResult = { success: false };
    try {
      emailResult = (await authController.sendEmailVerification(newEmail, rawVerificationToken)) || { success: true };
    } catch (dispatchErr) {
      emailResult = { success: false, error: dispatchErr.message };
    }

    const emailSent = emailResult.success !== false;

    console.log("\n================ UPDATE COMPLETED SUCCESSFULLY ================");
    console.log(`User ID:               ${report.userId} (preserved)`);
    console.log(`Name:                  ${report.name} (preserved)`);
    console.log(`Role:                  ${report.role} (preserved)`);
    console.log(`Active:                ${report.isActive} (preserved)`);
    console.log(`Previous Email:        ${report.oldEmail}`);
    console.log(`Updated Email:         ${report.newEmail}`);
    console.log(`Sessions Revoked:      ${report.revokedSessionsCount} refresh token(s) invalidated`);
    console.log(`Verification Status:   Pending verification (isEmailVerified: false)`);

    if (emailSent) {
      console.log(`Email Dispatch:        Dispatched verification email to ${report.newEmail}`);
    } else {
      console.warn(`Email Dispatch Warning: Email dispatch failed (${emailResult.error || "Network/SMTP error"}).`);
      console.warn("RECOVERY INSTRUCTIONS:");
      console.warn(`1. The database update succeeded and your account is secure.`);
      console.warn(`2. You can sign in using your new email (${report.newEmail}) and existing password.`);
      console.warn(`3. Once signed in, click 'Resend verification' on the dashboard banner, or call POST /api/auth/resend-verification.`);
    }
    console.log("================================================================\n");

    return {
      success: true,
      ...report,
      emailSent,
      emailError: emailResult.error || null,
    };
  } finally {
    if (shouldManageConnection && mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  updateAdminEmail()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`❌ Error updating admin email: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { updateAdminEmail, sanitizeMongoUri, isValidEmail };
