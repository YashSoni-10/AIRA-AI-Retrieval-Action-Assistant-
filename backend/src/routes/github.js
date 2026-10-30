const express = require("express");
const router = express.Router();
const {
  getStatus,
  oauthAuthorize,
  oauthCallback,
  connectPat,
  disconnect,
  listRepos,
  addRepo,
  listIssues,
  listPulls,
  getRepoTree,
  getFileContent,
} = require("../controllers/githubController");
const { protect, requireRole } = require("../middleware/auth");

// Connection Status (All authenticated roles: admin, member, viewer)
router.get("/status", protect, getStatus);

// OAuth Flow (Initiate requires admin or member; callback handles verified state)
router.get("/oauth/authorize", protect, requireRole("admin", "member"), oauthAuthorize);
router.get("/oauth/callback", oauthCallback);

// PAT Connection (Dev / Test / Fallback — Admin and Member only)
router.post("/connect-pat", protect, requireRole("admin", "member"), connectPat);

// Disconnect (Admin and Member only; Viewers return 403)
router.post("/disconnect", protect, requireRole("admin", "member"), disconnect);

// Repository & Issue Management
router.get("/repos", protect, listRepos);
router.post("/repos", protect, requireRole("admin", "member"), addRepo);
router.get("/issues", protect, listIssues);
router.get("/pulls", protect, listPulls);
router.get("/tree", protect, getRepoTree);
router.get("/file", protect, getFileContent);
router.get("/content", protect, getFileContent);

module.exports = router;
