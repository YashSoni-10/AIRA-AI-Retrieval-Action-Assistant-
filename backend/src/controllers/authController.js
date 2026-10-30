const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Workspace = require("../models/Workspace");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const mongoose = require("mongoose");

// In-memory fallback database
const memoryUsers = [];

let dbConnectedOverride = null;
const isDbConnected = () => (dbConnectedOverride !== null ? dbConnectedOverride : mongoose.connection.readyState === 1);
exports._setDbConnected = (val) => { dbConnectedOverride = val; };

/** Short-lived access token (default 15m, tighten via JWT_EXPIRE). */
const signToken = (id, role = "member") =>
  jwt.sign({ id: id && id.toString ? id.toString() : id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "15m",
  });

/** Long-lived refresh token (default 7d, tighten via REFRESH_EXPIRE). */
const signRefreshToken = (id, jti = crypto.randomUUID()) =>
  jwt.sign(
    { id: id && id.toString ? id.toString() : id, jti },
    process.env.REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.REFRESH_EXPIRE || "7d" }
  );

/** Cookie options — httpOnly prevents JS access, lax/none protects cross-origin requests. */
const refreshCookieOptions = () => ({
  httpOnly: true,
  sameSite: process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === "production" ? "none" : "lax"),
  secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days in ms
  path: "/api/auth",
});

/** Cookie options for clearing — matching path, sameSite, secure and httpOnly without maxAge */
const clearCookieOptions = () => ({
  httpOnly: true,
  sameSite: process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === "production" ? "none" : "lax"),
  secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
  path: "/api/auth",
});

/** Leeway window (15s) for concurrent tab refresh race conditions (RFC 6819) */
const ROTATION_GRACE_WINDOW_MS = 15000;

/** Persists an active refresh token jti to MongoDB or memoryUsers, removing expired ones. */
const persistRefreshToken = async (userId, jti, expiresAt) => {
  if (isDbConnected() && mongoose.Types.ObjectId.isValid(userId)) {
    try {
      const graceThreshold = new Date(Date.now() - ROTATION_GRACE_WINDOW_MS);
      await User.findByIdAndUpdate(userId, {
        $pull: {
          refreshTokens: {
            $or: [
              { expiresAt: { $lt: new Date() } },
              { rotatedAt: { $lt: graceThreshold } },
            ],
          },
        },
      });
      await User.findByIdAndUpdate(userId, {
        $push: {
          refreshTokens: {
            tokenId: jti,
            expiresAt,
            createdAt: new Date(),
          },
        },
      });
    } catch (e) {
      // Best-effort persistence
    }
  } else {
    // In-memory mode or mock test IDs
    const memUser = memoryUsers.find(u => (u._id || u.id) === userId);
    if (memUser) {
      if (!Array.isArray(memUser.refreshTokens)) memUser.refreshTokens = [];
      const graceThreshold = new Date(Date.now() - ROTATION_GRACE_WINDOW_MS);
      memUser.refreshTokens = memUser.refreshTokens.filter(
        t => new Date(t.expiresAt) > new Date() && (!t.rotatedAt || new Date(t.rotatedAt) > graceThreshold)
      );
      memUser.refreshTokens.push({ tokenId: jti, expiresAt, createdAt: new Date() });
    }
  }
};

/**
 * Sends a verification email if SMTP is configured.
 * In development, prints verification link to console.
 * Never logs raw token or verification URL in production.
 */
const sendEmailVerification = async (email, rawToken) => {
  const verificationUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?token=${rawToken}`;
  const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

  if (smtpConfigured) {
    try {
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: process.env.SMTP_PORT === "465",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: "AIRA — Verify your email address",
        text: `Welcome to AIRA! Please verify your email by clicking the link below (valid for 24 hours):\n\n${verificationUrl}\n\nIf you did not register for AIRA, ignore this email.`,
        html: `<p>Welcome to AIRA!</p><p>Please verify your email address by clicking the link below (valid for <strong>24 hours</strong>):</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>If you did not register for AIRA, ignore this email.</p>`,
      });
    } catch (mailErr) {
      console.error("[sendEmailVerification] Email send failed:", mailErr.message);
    }
  } else {
    // Only log URL in non-production environments
    if (process.env.NODE_ENV !== "production") {
      console.info(`[sendEmailVerification] SMTP not configured. Verification link for ${email}:\n${verificationUrl}`);
    } else {
      console.info(`[sendEmailVerification] SMTP not configured. Skipping email dispatch for ${email}.`);
    }
  }
};

const sendToken = async (user, statusCode, res) => {
  const userId = user._id || user.id;
  const token = signToken(userId, user.role || "member");
  // Clone to avoid exposing password or sensitive tokens
  const userResponse = { ...user };
  delete userResponse.password;
  delete userResponse.passwordResetToken;
  delete userResponse.passwordResetExpires;
  delete userResponse.emailVerificationToken;
  delete userResponse.emailVerificationExpires;
  delete userResponse.refreshTokens;

  // Preserve existing users who might have isEmailVerified: undefined
  if (userResponse.isEmailVerified === undefined) {
    userResponse.isEmailVerified = true;
  }

  // Issue refresh token in httpOnly cookie
  if (userId) {
    const jti = crypto.randomUUID();
    const refreshToken = signRefreshToken(userId, jti);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await persistRefreshToken(userId.toString(), jti, expiresAt);
    res.cookie("aira_refresh", refreshToken, refreshCookieOptions());
  }

  res.status(statusCode).json({ success: true, token, user: userResponse });
};

// POST /api/auth/register
// SECURITY: role is intentionally NOT accepted from the request body.
// All new users are always created with role="member".
// Only an authenticated admin can promote a user via PATCH /api/auth/users/:id/role.
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Name, email and password are required" });

    const normalizedEmail = email.toLowerCase().trim();

    if (isDbConnected()) {
      const exists = await User.findOne({ email: normalizedEmail });
      if (exists)
        return res.status(409).json({ success: false, message: "Email already registered" });
      const user = await User.create({
        name,
        email: normalizedEmail,
        password,
        role: "member",
        isEmailVerified: false,
      });
      const rawVerificationToken = typeof user.generateEmailVerificationToken === "function"
        ? user.generateEmailVerificationToken()
        : crypto.randomBytes(32).toString("hex");
      if (typeof user.save === "function") {
        await user.save({ validateBeforeSave: false });
      }
      await sendEmailVerification(normalizedEmail, rawVerificationToken);
      await sendToken(user.toObject ? user.toObject() : user, 201, res);
    } else {
      // In-memory registration
      const exists = memoryUsers.find(u => u.email === normalizedEmail);
      if (exists)
        return res.status(409).json({ success: false, message: "Email already registered (In-Memory DB)" });

      const hashedPassword = await bcrypt.hash(password, 12);
      const rawVerificationToken = crypto.randomBytes(32).toString("hex");
      const user = {
        _id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role: "member",
        avatar: "",
        isActive: true,
        isEmailVerified: false,
        emailVerificationToken: crypto.createHash("sha256").update(rawVerificationToken).digest("hex"),
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString()
      };
      memoryUsers.push(user);
      await sendEmailVerification(normalizedEmail, rawVerificationToken);
      await sendToken(user, 201, res);
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password are required" });

    const normalizedEmail = email.toLowerCase().trim();

    if (isDbConnected()) {
      const user = await User.findOne({ email: normalizedEmail }).select("+password");
      if (!user || !(await user.comparePassword(password)))
        return res.status(401).json({ success: false, message: "Invalid email or password" });
      if (!user.isActive) {
        return res.status(403).json({ success: false, message: "Account deactivated" });
      }
      await sendToken(user.toObject(), 200, res);
    } else {
      // In-memory login
      const user = memoryUsers.find(u => u.email === normalizedEmail);
      if (!user || !(await bcrypt.compare(password, user.password)))
        return res.status(401).json({ success: false, message: "Invalid email or password (In-Memory DB)" });
      if (!user.isActive) {
        return res.status(403).json({ success: false, message: "Account deactivated" });
      }
      await sendToken(user, 200, res);
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    if (isDbConnected()) {
      const user = await User.findById(userId);
      res.status(200).json({ success: true, user });
    } else {
      const user = memoryUsers.find(u => u._id === userId);
      if (!user) return res.status(404).json({ success: false, message: "User not found" });
      const userResponse = { ...user };
      delete userResponse.password;
      res.status(200).json({ success: true, user: userResponse });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/auth/update-profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, role } = req.body;
    const userId = req.user._id || req.user.id;

    // SECURITY: Roles cannot be modified through update-profile.
    // Role changes must be explicitly performed through PATCH /api/auth/users/:id/role
    // by an authorized administrator to prevent self-promotion and last-admin demotion bypass.
    if (role !== undefined) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: role cannot be modified via profile update. Use the admin user management API.",
      });
    }

    if (isDbConnected()) {
      const updated = await User.findByIdAndUpdate(
        userId,
        { ...(name && { name: String(name).trim() }) },
        { new: true, runValidators: true }
      ).select("-password");
      res.status(200).json({ success: true, user: updated });
    } else {
      // In-memory update
      const index = memoryUsers.findIndex(u => u._id === userId || u.id === userId);
      if (index === -1) return res.status(404).json({ success: false, message: "User not found" });
      
      if (name) memoryUsers[index].name = String(name).trim();
      
      const userResponse = { ...memoryUsers[index] };
      delete userResponse.password;
      res.status(200).json({ success: true, user: userResponse });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/auth/users (Admin only)
exports.listUsers = async (req, res) => {
  try {
    if (isDbConnected()) {
      const users = await User.find({}).select("-password").sort({ createdAt: -1 }).lean();
      const userIds = users.map(u => u._id);
      const workspaces = await Workspace.find({ owner_id: { $in: userIds }, is_default: true }).lean();
      const wsMap = new Map();
      workspaces.forEach(ws => wsMap.set(ws.owner_id.toString(), { _id: ws._id, name: ws.name }));

      const enriched = users.map(u => ({
        ...u,
        workspace: wsMap.get(u._id.toString()) || { name: `${u.name}'s Workspace` },
      }));

      res.status(200).json({ success: true, users: enriched, count: enriched.length });
    } else {
      const sanitized = memoryUsers.map(u => {
        const copy = { ...u };
        delete copy.password;
        copy.workspace = { name: "Default Workspace" };
        return copy;
      });
      res.status(200).json({ success: true, users: sanitized, count: sanitized.length });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/auth/users/:id/role (Admin only)
exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    const targetUserId = req.params.id;

    const validRoles = ["admin", "member", "viewer"];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${validRoles.join(", ")}`,
      });
    }

    if (isDbConnected()) {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      // Prevent accidental demotion or removal of the last active administrator
      if (targetUser.role === "admin" && role !== "admin") {
        const activeAdminCount = await User.countDocuments({ role: "admin", isActive: true });
        if (activeAdminCount <= 1) {
          return res.status(400).json({
            success: false,
            message: "Cannot demote the last active administrator. Assign another admin first.",
          });
        }
      }

      targetUser.role = role;
      await targetUser.save();

      const userResponse = targetUser.toObject();
      delete userResponse.password;
      res.status(200).json({ success: true, user: userResponse });
    } else {
      const index = memoryUsers.findIndex(u => u._id === targetUserId || u.id === targetUserId);
      if (index === -1) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const targetUser = memoryUsers[index];
      // Prevent accidental demotion or removal of the last active administrator
      if (targetUser.role === "admin" && role !== "admin") {
        const activeAdminCount = memoryUsers.filter(u => u.role === "admin" && u.isActive !== false).length;
        if (activeAdminCount <= 1) {
          return res.status(400).json({
            success: false,
            message: "Cannot demote the last active administrator. Assign another admin first.",
          });
        }
      }

      memoryUsers[index].role = role;
      const userResponse = { ...memoryUsers[index] };
      delete userResponse.password;
      res.status(200).json({ success: true, user: userResponse });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/auth/users/:id/status  (Admin only)
// Activates or deactivates a user account.
exports.toggleUserStatus = async (req, res) => {
  try {
    const { isActive } = req.body;
    const targetUserId = req.params.id;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean (true or false).",
      });
    }

    // Prevent self-deactivation — an admin who deactivates themselves
    // would be immediately locked out and unable to restore access.
    const requestingUserId = (req.user._id || req.user.id).toString();
    if (requestingUserId === targetUserId && !isActive) {
      return res.status(400).json({
        success: false,
        message: "You cannot deactivate your own account.",
      });
    }

    if (isDbConnected()) {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // Prevent deactivating the last active admin
      if (targetUser.role === "admin" && !isActive) {
        const activeAdminCount = await User.countDocuments({ role: "admin", isActive: true });
        if (activeAdminCount <= 1) {
          return res.status(400).json({
            success: false,
            message: "Cannot deactivate the last active administrator. Assign another administrator first.",
          });
        }
      }

      targetUser.isActive = isActive;
      await targetUser.save();

      const userResponse = targetUser.toObject();
      delete userResponse.password;
      res.status(200).json({ success: true, user: userResponse });
    } else {
      // In-memory mode
      const index = memoryUsers.findIndex((u) => u._id === targetUserId || u.id === targetUserId);
      if (index === -1) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // Prevent deactivating the last active admin (in-memory)
      if (memoryUsers[index].role === "admin" && !isActive) {
        const activeAdminCount = memoryUsers.filter((u) => u.role === "admin" && u.isActive !== false).length;
        if (activeAdminCount <= 1) {
          return res.status(400).json({
            success: false,
            message: "Cannot deactivate the last active administrator. Assign another administrator first.",
          });
        }
      }

      memoryUsers[index].isActive = isActive;
      const userResponse = { ...memoryUsers[index] };
      delete userResponse.password;
      res.status(200).json({ success: true, user: userResponse });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/auth/change-password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id || req.user.id;

    if (isDbConnected()) {
      const user = await User.findById(userId).select("+password");
      if (!(await user.comparePassword(currentPassword)))
        return res.status(401).json({ success: false, message: "Current password is wrong" });
      user.password = newPassword;
      await user.save();
      await sendToken(user.toObject(), 200, res);
    } else {
      // In-memory password change
      const index = memoryUsers.findIndex(u => u._id === userId);
      if (index === -1) return res.status(404).json({ success: false, message: "User not found" });

      const user = memoryUsers[index];
      if (!(await bcrypt.compare(currentPassword, user.password)))
        return res.status(401).json({ success: false, message: "Current password is wrong" });

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      memoryUsers[index].password = hashedPassword;
      await sendToken(memoryUsers[index], 200, res);
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.memoryUsers = memoryUsers;

// ── POST /api/auth/avatar ─────────────────────────────────────────────────────
/**
 * Accepts a multipart image (handled by multer in avatarUpload middleware),
 * stores it in backend/uploads/avatars/, updates User.avatar, and returns
 * the new avatar URL.
 *
 * Served at: http://localhost:5000/uploads/avatars/<filename>
 * (Express static middleware registered in server.js)
 */
exports.uploadAvatar = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No image file provided" });
  }

  const userId = req.user._id || req.user.id;
  const baseUrl = process.env.BACKEND_URL || "http://localhost:5000";
  const avatarUrl = `${baseUrl}/uploads/avatars/${req.file.filename}`;

  try {
    if (isDbConnected()) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      // Delete the old avatar file from disk (best-effort)
      if (user.avatar && user.avatar.includes("/uploads/avatars/")) {
        const { AVATAR_DIR } = require("../middleware/avatarUpload");
        const fs = require("fs");
        const oldFilename = user.avatar.split("/uploads/avatars/").pop();
        const oldPath = require("path").join(AVATAR_DIR, oldFilename || "");
        if (oldFilename) fs.unlink(oldPath, () => {});
      }

      user.avatar = avatarUrl;
      await user.save();

      const userResponse = user.toObject();
      return res.status(200).json({ success: true, avatar: avatarUrl, user: userResponse });
    } else {
      // In-memory mode: store the URL (file is still written to disk)
      const index = memoryUsers.findIndex(u => (u._id || u.id) === userId);
      if (index !== -1) memoryUsers[index].avatar = avatarUrl;
      return res.status(200).json({ success: true, avatar: avatarUrl });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};


/**
 * Verifies the httpOnly refresh cookie, validates user status, performs
 * rotation and issues a fresh access + refresh pair.
 * Called automatically by the frontend silent-refresh interceptor when a 401 is received.
 */
exports.refresh = async (req, res) => {
  const token = req.cookies?.aira_refresh;
  if (!token) {
    return res.status(401).json({ success: false, message: "No refresh token provided", code: "NO_REFRESH_TOKEN" });
  }
  try {
    const secret = process.env.REFRESH_SECRET || process.env.JWT_SECRET;
    const payload = jwt.verify(token, secret);
    const userId = payload.id;
    const jti = payload.jti;

    if (!userId) {
      res.clearCookie("aira_refresh", clearCookieOptions());
      return res.status(401).json({ success: false, message: "Invalid refresh token payload", code: "REFRESH_INVALID" });
    }

    if (isDbConnected() && mongoose.Types.ObjectId.isValid(userId)) {
      const user = await User.findById(userId).select("+refreshTokens");
      if (!user || !user.isActive) {
        res.clearCookie("aira_refresh", clearCookieOptions());
        return res.status(401).json({ success: false, message: "User not found or deactivated", code: "USER_INVALID" });
      }

      // Check if jti is present in user's active refresh tokens (if issued with jti)
      if (jti) {
        const tokenEntry = user.refreshTokens && user.refreshTokens.find(t => t.tokenId === jti && new Date(t.expiresAt) > new Date());
        if (!tokenEntry) {
          // Token not found or expired — replay or invalid
          res.clearCookie("aira_refresh", clearCookieOptions());
          return res.status(401).json({ success: false, message: "Refresh token revoked or already used", code: "REFRESH_REVOKED" });
        }

        if (tokenEntry.rotatedAt) {
          const elapsed = Date.now() - new Date(tokenEntry.rotatedAt).getTime();
          if (elapsed <= ROTATION_GRACE_WINDOW_MS) {
            // Concurrent tab refresh race condition within 15s grace window (RFC 6819)
            // Issue fresh access token without invalidating or clearing the session
            const accessToken = signToken(user._id || user.id, user.role || "member");
            const userResponse = user.toObject ? user.toObject() : { ...user };
            delete userResponse.password;
            delete userResponse.passwordResetToken;
            delete userResponse.passwordResetExpires;
            delete userResponse.refreshTokens;
            return res.status(200).json({ success: true, token: accessToken, user: userResponse });
          } else {
            // Genuine replay attack (>15s after rotation): invalidate all tokens for security
            await User.findByIdAndUpdate(userId, { $set: { refreshTokens: [] } });
            res.clearCookie("aira_refresh", clearCookieOptions());
            return res.status(401).json({ success: false, message: "Refresh token revoked or already used", code: "REFRESH_REVOKED" });
          }
        }

        // First rotation: mark token as rotated with current timestamp
        await User.updateOne(
          { _id: userId, "refreshTokens.tokenId": jti },
          { $set: { "refreshTokens.$.rotatedAt": new Date() } }
        );
      }

      await sendToken(user.toObject(), 200, res);
    } else {
      // In-memory mode or mock test IDs
      const memUser = memoryUsers.find(u => (u._id || u.id) === userId);
      if (!memUser || !memUser.isActive) {
        res.clearCookie("aira_refresh", clearCookieOptions());
        return res.status(401).json({ success: false, message: "User not found or deactivated", code: "USER_INVALID" });
      }

      if (jti && Array.isArray(memUser.refreshTokens)) {
        const tokenEntry = memUser.refreshTokens.find(t => t.tokenId === jti && new Date(t.expiresAt) > new Date());
        if (!tokenEntry) {
          res.clearCookie("aira_refresh", clearCookieOptions());
          return res.status(401).json({ success: false, message: "Refresh token revoked or already used", code: "REFRESH_REVOKED" });
        }

        if (tokenEntry.rotatedAt) {
          const elapsed = Date.now() - new Date(tokenEntry.rotatedAt).getTime();
          if (elapsed <= ROTATION_GRACE_WINDOW_MS) {
            const accessToken = signToken(memUser._id || memUser.id, memUser.role || "member");
            const userResponse = { ...memUser };
            delete userResponse.password;
            delete userResponse.passwordResetToken;
            delete userResponse.passwordResetExpires;
            delete userResponse.refreshTokens;
            return res.status(200).json({ success: true, token: accessToken, user: userResponse });
          } else {
            memUser.refreshTokens = [];
            res.clearCookie("aira_refresh", clearCookieOptions());
            return res.status(401).json({ success: false, message: "Refresh token revoked or already used", code: "REFRESH_REVOKED" });
          }
        }

        tokenEntry.rotatedAt = new Date();
      }

      await sendToken(memUser, 200, res);
    }
  } catch (err) {
    res.clearCookie("aira_refresh", clearCookieOptions());
    return res.status(401).json({ success: false, message: "Invalid or expired refresh token", code: "REFRESH_INVALID" });
  }
};

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
/** Revokes the specific refresh session and clears the httpOnly refresh cookie. */
exports.logout = async (req, res) => {
  const token = req.cookies?.aira_refresh;
  if (token) {
    try {
      const secret = process.env.REFRESH_SECRET || process.env.JWT_SECRET;
      const payload = jwt.verify(token, secret);
      const userId = payload.id;
      const jti = payload.jti;

      if (userId && jti) {
        if (isDbConnected() && mongoose.Types.ObjectId.isValid(userId)) {
          await User.findByIdAndUpdate(userId, {
            $pull: { refreshTokens: { tokenId: jti } },
          });
        } else {
          const memUser = memoryUsers.find(u => (u._id || u.id) === userId);
          if (memUser && Array.isArray(memUser.refreshTokens)) {
            memUser.refreshTokens = memUser.refreshTokens.filter(t => t.tokenId !== jti);
          }
        }
      }
    } catch {
      // Ignore token verification errors during logout — cookie will be cleared anyway
    }
  }

  res.clearCookie("aira_refresh", clearCookieOptions());
  res.status(200).json({ success: true, message: "Logged out" });
};

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
/**
 * Generates a password-reset token, saves its hash to the User document,
 * and — when SMTP is configured — sends a reset email.
 *
 * Required env vars for email delivery:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (optional)
 *   FRONTEND_URL  (e.g. http://localhost:5173) — used to build the reset link
 *
 * If SMTP is not configured, the endpoint still returns 200 and logs the link
 * to the server console (useful during local development).
 */
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }
  const normalizedEmail = String(email).toLowerCase().trim();

  try {
    if (!isDbConnected()) {
      // In-memory: silently accept but can't store token
      return res.status(200).json({ success: true, message: "If that email is registered you will receive a reset link." });
    }

    const user = await User.findOne({ email: normalizedEmail }).select("+passwordResetToken +passwordResetExpires");
    // Always return 200 to avoid email enumeration
    if (!user) {
      return res.status(200).json({ success: true, message: "If that email is registered you will receive a reset link." });
    }

    const rawToken = user.generatePasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${rawToken}`;

    // ── Email delivery (optional) ─────────────────────────────────────────────
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    if (smtpConfigured) {
      try {
        const nodemailer = require("nodemailer");
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || "587", 10),
          secure: process.env.SMTP_PORT === "465",
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: user.email,
          subject: "AIRA — Reset your password",
          text: `You requested a password reset. Click the link below (valid for 10 minutes):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
          html: `<p>You requested a password reset. Click the link below (valid for <strong>10 minutes</strong>):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
        });
      } catch (mailErr) {
        console.error("[forgotPassword] Email send failed:", mailErr.message);
        // Don't expose mail failure to the user — still return 200
      }
    } else {
      // Development fallback: print link to console
      console.info(`[forgotPassword] SMTP not configured. Reset link for ${user.email}:\n${resetUrl}`);
    }

    return res.status(200).json({ success: true, message: "If that email is registered you will receive a reset link." });
  } catch (err) {
    console.error("forgotPassword error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ── POST /api/auth/reset-password ────────────────────────────────────────────
/**
 * Verifies the raw reset token (matched against its SHA-256 hash) and updates
 * the user's password. Token must not have expired.
 */
exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ success: false, message: "Token and new password are required" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
  }

  try {
    if (!isDbConnected()) {
      return res.status(503).json({ success: false, message: "Database not available", code: "DB_UNAVAILABLE" });
    }

    const hashedToken = crypto.createHash("sha256").update(String(token)).digest("hex");
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    }).select("+password +passwordResetToken +passwordResetExpires");

    if (!user) {
      return res.status(400).json({ success: false, message: "Reset token is invalid or has expired" });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    await sendToken(user.toObject(), 200, res);
  } catch (err) {
    console.error("resetPassword error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ── POST /api/auth/verify-email ──────────────────────────────────────────────
/**
 * Verifies the user's email using the single-use time-limited verification token.
 * Validates token hash and expiration, updates isEmailVerified to true, and invalidates the token.
 */
exports.verifyEmail = async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: "Verification token is required" });
  }

  try {
    const hashedToken = crypto.createHash("sha256").update(String(token)).digest("hex");

    if (isDbConnected()) {
      const user = await User.findOne({
        emailVerificationToken: hashedToken,
        emailVerificationExpires: { $gt: new Date() },
      }).select("+emailVerificationToken +emailVerificationExpires");

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Verification token is invalid, expired, or has already been used.",
          code: "INVALID_OR_EXPIRED_TOKEN",
        });
      }

      user.isEmailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      await user.save({ validateBeforeSave: false });

      const userResponse = user.toObject();
      delete userResponse.password;
      delete userResponse.passwordResetToken;
      delete userResponse.passwordResetExpires;
      delete userResponse.emailVerificationToken;
      delete userResponse.emailVerificationExpires;
      delete userResponse.refreshTokens;

      return res.status(200).json({
        success: true,
        message: "Email verified successfully.",
        user: userResponse,
      });
    } else {
      // In-memory mode
      const user = memoryUsers.find(
        (u) =>
          u.emailVerificationToken === hashedToken &&
          new Date(u.emailVerificationExpires) > new Date()
      );

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Verification token is invalid, expired, or has already been used.",
          code: "INVALID_OR_EXPIRED_TOKEN",
        });
      }

      user.isEmailVerified = true;
      delete user.emailVerificationToken;
      delete user.emailVerificationExpires;

      const userResponse = { ...user };
      delete userResponse.password;
      delete userResponse.refreshTokens;

      return res.status(200).json({
        success: true,
        message: "Email verified successfully.",
        user: userResponse,
      });
    }
  } catch (err) {
    console.error("verifyEmail error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ── POST /api/auth/resend-verification ────────────────────────────────────────
/**
 * Resends an email verification link.
 * Protected by resendVerificationLimiter.
 * Always returns a generic 200 response to prevent account enumeration.
 */
exports.resendVerification = async (req, res) => {
  let email = req.body?.email;
  // If user is authenticated, read from req.user
  if (!email && req.user && req.user.email) {
    email = req.user.email;
  }
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  try {
    if (isDbConnected()) {
      const user = await User.findOne({ email: normalizedEmail }).select(
        "+emailVerificationToken +emailVerificationExpires"
      );

      // Return generic 200 message to avoid email enumeration
      if (!user || user.isEmailVerified) {
        return res.status(200).json({
          success: true,
          message: "If an account with that email exists and is unverified, a verification link has been sent.",
        });
      }

      const rawToken = user.generateEmailVerificationToken();
      await user.save({ validateBeforeSave: false });
      await sendEmailVerification(user.email, rawToken);

      return res.status(200).json({
        success: true,
        message: "If an account with that email exists and is unverified, a verification link has been sent.",
      });
    } else {
      // In-memory mode
      const user = memoryUsers.find((u) => u.email === normalizedEmail);
      if (!user || user.isEmailVerified) {
        return res.status(200).json({
          success: true,
          message: "If an account with that email exists and is unverified, a verification link has been sent.",
        });
      }

      const rawToken = crypto.randomBytes(32).toString("hex");
      user.emailVerificationToken = crypto.createHash("sha256").update(rawToken).digest("hex");
      user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await sendEmailVerification(user.email, rawToken);

      return res.status(200).json({
        success: true,
        message: "If an account with that email exists and is unverified, a verification link has been sent.",
      });
    }
  } catch (err) {
    console.error("resendVerification error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.sendEmailVerification = sendEmailVerification;
