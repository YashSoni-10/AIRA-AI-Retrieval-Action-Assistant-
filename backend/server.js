require("dotenv").config();
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

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 2000 })
  .then(() => {
    console.log("MongoDB connected to:", MONGO_URI);
    app.listen(PORT, () => {
      console.log(`AIRA Auth Service running on http://localhost:${PORT}`);
      console.log(`API Health: http://localhost:${PORT}/api/health`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    console.log("Starting server without database (auth endpoints will fail)...");
    app.listen(PORT, () => {
      console.log(`AIRA Auth Service (no DB) on http://localhost:${PORT}`);
    });
  });

module.exports = app;
