const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  createConversation,
  listConversations,
  getConversation,
  deleteConversation,
  clearAllConversations,
  saveMessage,
  getMessages,
} = require("../controllers/conversationController");

router.post("/", protect, createConversation);
router.get("/", protect, listConversations);
router.delete("/clear", protect, clearAllConversations);
router.delete("/", protect, clearAllConversations);
router.get("/:id", protect, getConversation);
router.delete("/:id", protect, deleteConversation);
router.post("/:id/messages", protect, saveMessage);
router.get("/:id/messages", protect, getMessages);

module.exports = router;
