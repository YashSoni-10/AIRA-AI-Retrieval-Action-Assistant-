const express = require("express");
const router = express.Router();
const {
  register,
  login,
  refresh,
  logout,
  getMe,
  updateProfile,
  changePassword,
  listUsers,
  updateUserRole,
  toggleUserStatus,
  forgotPassword,
  resetPassword,
  uploadAvatar,
  verifyEmail,
  resendVerification,
} = require("../controllers/authController");
const { protect, requireRole } = require("../middleware/auth");
const { loginLimiter, registerLimiter, forgotPasswordLimiter, resendVerificationLimiter } = require("../middleware/rateLimiter");
const { avatarUpload } = require("../middleware/avatarUpload");


router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/refresh", refresh);          // No auth required — uses httpOnly cookie
router.post("/logout", logout);            // No auth required — clears cookie
router.get("/me", protect, getMe);
router.patch("/update-profile", protect, updateProfile);
router.patch("/change-password", protect, changePassword);

// Password reset (6B)
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPassword);

// Email verification (6C)
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerificationLimiter, resendVerification);

// Avatar upload (6D)
router.post("/avatar", protect, avatarUpload.single("avatar"), uploadAvatar);

// User & Role Management (Admin only)
router.get("/users", protect, requireRole("admin"), listUsers);
router.patch("/users/:id/role", protect, requireRole("admin"), updateUserRole);
router.patch("/users/:id/status", protect, requireRole("admin"), toggleUserStatus);

module.exports = router;
