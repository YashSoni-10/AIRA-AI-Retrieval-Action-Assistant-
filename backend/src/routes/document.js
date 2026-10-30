const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/auth");
const {
  createDocument,
  listDocuments,
  getDocument,
  updateDocumentStatus,
  deleteDocument,
} = require("../controllers/documentController");

// All routes require JWT authentication
// Document upload: Admin and Member only (Viewer gets 403)
router.post("/", protect, requireRole("admin", "member"), createDocument);

// Document viewing: Admin, Member, and Viewer
router.get("/", protect, listDocuments);
router.get("/:id", protect, getDocument);

// Document status update: Admin and Member
router.patch("/:id/status", protect, requireRole("admin", "member"), updateDocumentStatus);

// Document deletion: Admin and Member (Member only own, Admin any; Viewer gets 403)
router.delete("/:id", protect, requireRole("admin", "member"), deleteDocument);

module.exports = router;
