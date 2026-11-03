/**
 * GitHubConnection Model
 * ======================
 * Stores workspace-level GitHub integration details.
 * Both the access token and the refresh token are encrypted at rest using AES-256-GCM.
 *
 * Token lifecycle fields (required when GitHub OAuth App has "user token expiration" enabled):
 *   - token_expires_at:           When the current access token expires (null = non-expiring classic token)
 *   - encrypted_refresh_token:    AES-256-GCM encrypted refresh token ciphertext
 *   - refresh_token_iv:           Encryption IV for the refresh token
 *   - refresh_token_auth_tag:     GCM authentication tag for the refresh token
 *   - refresh_token_expires_at:   When the refresh token itself expires (~6 months from issue)
 */
const mongoose = require("mongoose");

const gitHubConnectionSchema = new mongoose.Schema(
  {
    workspace_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      unique: true,
      index: true,
    },
    connected_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    github_user_id: {
      type: String,
      required: true,
      trim: true,
    },
    github_username: {
      type: String,
      required: true,
      trim: true,
    },
    avatar_url: {
      type: String,
      default: "",
    },

    // ── Primary access token (AES-256-GCM encrypted) ─────────────────────────
    encrypted_access_token: {
      type: String,
      required: true,
    },
    token_iv: {
      type: String,
      required: true,
    },
    token_auth_tag: {
      type: String,
      required: true,
    },

    // ── Token expiry (null when token is a classic ghp_ non-expiring token) ──
    token_expires_at: {
      type: Date,
      default: null,
    },

    // ── Refresh token (AES-256-GCM encrypted; null for classic non-expiring tokens) ──
    encrypted_refresh_token: {
      type: String,
      default: null,
    },
    refresh_token_iv: {
      type: String,
      default: null,
    },
    refresh_token_auth_tag: {
      type: String,
      default: null,
    },
    refresh_token_expires_at: {
      type: Date,
      default: null,
    },

    scopes: {
      type: [String],
      default: ["repo", "read:user"],
    },
    status: {
      type: String,
      enum: ["connected", "disconnected", "error"],
      default: "connected",
    },
    connected_at: {
      type: Date,
      default: Date.now,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("GitHubConnection", gitHubConnectionSchema);
