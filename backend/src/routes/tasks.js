/**
 * Task Routes — AIRA
 * ==================
 * All routes require authentication (protect middleware).
 * Role-level enforcement is handled inside the controller (not just here),
 * because frontend hiding alone is not sufficient.
 *
 * GET    /api/tasks         → list tasks in user's workspace
 * GET    /api/tasks/:id     → get a single task
 * POST   /api/tasks         → create a task (admin, member)
 * PATCH  /api/tasks/:id     → update a task (admin=any, member=own only)
 * DELETE /api/tasks/:id     → delete a task (admin=any, member=own only)
 */

"use strict";

const express = require("express");
const router = express.Router();
const {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
} = require("../controllers/taskController");
const { protect } = require("../middleware/auth");

// All task routes require a valid JWT
router.use(protect);

router.get("/", listTasks);
router.get("/:id", getTask);
router.post("/", createTask);
router.patch("/:id", updateTask);
router.delete("/:id", deleteTask);

module.exports = router;
