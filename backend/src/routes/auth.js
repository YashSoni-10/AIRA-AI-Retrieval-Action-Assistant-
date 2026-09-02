const express = require("express");
const router = express.Router();
const { register, login, getMe, updateProfile, changePassword } = require("../controllers/authController");
const { protect } = require("../middleware/auth");

router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, getMe);
router.patch("/update-profile", protect, updateProfile);
router.patch("/change-password", protect, changePassword);

module.exports = router;
