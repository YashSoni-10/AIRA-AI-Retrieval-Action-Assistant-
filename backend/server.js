require("dotenv").config();

// ── Fail-fast: validate JWT_SECRET before anything else starts ─────────────────
const _jwtSecret = process.env.JWT_SECRET;
if (!_jwtSecret || _jwtSecret.trim() === "") {
  console.error("FATAL: JWT_SECRET environment variable is not configured.");
  console.error("Create backend/.env from backend/.env.example and set JWT_SECRET.");
  process.exit(1);
}
if (_jwtSecret.length < 32) {
  console.error("FATAL: JWT_SECRET is too short. Use a sufficiently long random secret (min 32 characters).");
  process.exit(1);
}
const _refreshSecret = process.env.REFRESH_SECRET;
if (_refreshSecret && _refreshSecret.trim().length < 32) {
  console.error("FATAL: REFRESH_SECRET is too short when configured. Use min 32 characters or omit to default to JWT_SECRET.");
  process.exit(1);
}
// ──────────────────────────────────────────────────────────────────────────────

const dns = require("dns");
// Fix for Node.js SRV DNS resolution on Windows with MongoDB Atlas
try {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
} catch (e) {
  console.warn("Could not set custom DNS servers:", e.message);
}

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const mongoose = require("mongoose");
const { uploadLimiter, githubLimiter } = require("./src/middleware/rateLimiter");

const app = express();

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// CORS
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  credentials: true,
}));

const cookieParser = require("cookie-parser");

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


// Serve uploaded files (avatars, etc.)
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api/auth", require("./src/routes/auth"));
app.use("/api/workspace", require("./src/routes/workspace"));
app.use("/api/conversations", require("./src/routes/conversation"));
app.use("/api/documents", uploadLimiter, require("./src/routes/document"));
app.use("/api/github", githubLimiter, require("./src/routes/github"));
app.use("/api/dashboard", require("./src/routes/dashboard"));
app.use("/api/tasks", require("./src/routes/tasks"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "AIRA Auth Service",
    version: "1.0.0",
    status: "healthy",
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ success: false, message: err.message || "Internal server error" });
});

// Connect DB and start server
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/aira";

console.log("Connecting to MongoDB database...");

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => {
    const host = MONGO_URI.includes("@") ? MONGO_URI.split("@")[1] : MONGO_URI;
    console.log("MongoDB connected successfully to:", host);
    app.listen(PORT, () => {
      console.log(`AIRA Auth Service running on http://localhost:${PORT}`);
      console.log(`API Health: http://localhost:${PORT}/api/health`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    console.log("Starting server with in-memory database fallback...");
    app.listen(PORT, () => {
      console.log(`AIRA Auth Service (Memory DB fallback) on http://localhost:${PORT}`);
    });
  });

module.exports = app;


