require("dotenv").config();
const dns = require("dns");
// Fix for Node.js SRV DNS resolution on Windows with MongoDB Atlas
try {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
} catch (e) {
  console.warn("Could not set custom DNS servers:", e.message);
}

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

// CORS
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  credentials: true,
}));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/auth", require("./src/routes/auth"));

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
