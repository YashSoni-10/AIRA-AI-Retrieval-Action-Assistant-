/**
 * Avatar Upload Middleware — Phase 6D
 * =====================================
 * Uses multer for multipart/form-data.
 * Files are stored in backend/uploads/avatars/.
 * Allowed: JPEG, PNG, WebP (≤ 2 MB).
 *
 * Serving: the /uploads route in server.js exposes this directory
 * so the frontend can reference avatars at http://localhost:5000/uploads/avatars/<filename>.
 */

"use strict";

const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure the upload directory exists at startup
const AVATAR_DIR = path.join(__dirname, "../../uploads/avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (req, _file, cb) => {
    // <userId>-<timestamp>.ext — prevents collisions and makes old files easy to identify
    const userId = req.user?._id || req.user?.id || "unknown";
    const ext = path.extname(_file.originalname).toLowerCase() || ".jpg";
    cb(null, `${userId}-${Date.now()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, and WebP images are allowed"), false);
  }
};

const avatarUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
});

module.exports = { avatarUpload, AVATAR_DIR };
