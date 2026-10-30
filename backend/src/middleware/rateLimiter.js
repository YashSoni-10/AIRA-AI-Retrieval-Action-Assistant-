/**
 * Rate Limiters — AIRA Backend
 * ==============================
 * All limiters use express-rate-limit with a clean JSON handler.
 * No stack traces are exposed in 429 responses.
 *
 * Applied limits:
 *   loginLimiter    — POST /api/auth/login     : 10 req / 15 min / IP
 *   registerLimiter — POST /api/auth/register  : 5  req / 60 min / IP
 *   uploadLimiter   — /api/documents upload    : 30 req / min / IP  (Qdrant embedding is expensive)
 *   githubLimiter   — /api/github routes       : 60 req / min / IP
 *
 * Limits are intentionally generous for local development.
 * Tighten via environment variables before production deployment.
 *
 * NOTE: Custom keyGenerator is intentionally omitted.
 * express-rate-limit v7+ requires using its built-in ipKeyGenerator for IPv6-safe
 * IP-based limiting. The default behaviour is correct for single-server deployments.
 * If deploying behind a reverse proxy, set app.set('trust proxy', 1) and configure
 * express-rate-limit's requestPropertyName or a custom store accordingly.
 */

"use strict";

const { rateLimit } = require("express-rate-limit");

// ── Shared 429 handler ────────────────────────────────────────────────────────

const handler429 = (_req, res) => {
  res.status(429).json({
    success: false,
    message: "Too many requests. Please try again later.",
  });
};

// ── Login: 10 attempts / 15 minutes / IP ─────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,            // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || "10", 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: false,        // count ALL attempts (including valid logins)
  handler: handler429,
});

// ── Register: 5 attempts / hour / IP ─────────────────────────────────────────

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,            // 1 hour
  // Default: 50/hr for development (integration tests register multiple users).
  // Set RATE_LIMIT_REGISTER_MAX=5 (or lower) in production via environment variable.
  max: parseInt(process.env.RATE_LIMIT_REGISTER_MAX || "50", 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: handler429,
});

// ── Document upload: 30 req / minute / IP (Qdrant embedding is expensive) ────

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,                  // 1 minute
  max: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX || "30", 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: handler429,
});

// ── GitHub API proxy: 60 req / minute / IP ───────────────────────────────────

const githubLimiter = rateLimit({
  windowMs: 60 * 1000,                  // 1 minute
  max: parseInt(process.env.RATE_LIMIT_GITHUB_MAX || "60", 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: handler429,
});

// ── Forgot password: 5 attempts / hour / IP ──────────────────────────────────
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,            // 1 hour
  max: parseInt(process.env.RATE_LIMIT_FORGOT_PASSWORD_MAX || "5", 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: handler429,
});

// ── Resend email verification: 5 req / hour / IP ─────────────────────────────
const resendVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,            // 1 hour
  max: parseInt(process.env.RATE_LIMIT_RESEND_VERIFICATION_MAX || "5", 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: handler429,
});

module.exports = {
  loginLimiter,
  registerLimiter,
  uploadLimiter,
  githubLimiter,
  forgotPasswordLimiter,
  resendVerificationLimiter,
};
