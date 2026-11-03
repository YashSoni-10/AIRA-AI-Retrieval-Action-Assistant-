const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/auth");
const {
  getOrCreateDefaultWorkspace,
  getWorkspaceById,
  updateWorkspaceSettings,
  getWorkspaceMembers,
} = require("../controllers/workspaceController");

router.get("/me", protect, getOrCreateDefaultWorkspace);
router.get("/members", protect, getWorkspaceMembers);
router.get("/:id", protect, getWorkspaceById);
router.patch("/:id/settings", protect, requireRole("admin"), updateWorkspaceSettings);

module.exports = router;


