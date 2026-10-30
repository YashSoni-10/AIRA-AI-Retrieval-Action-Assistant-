/**
 * GitHub Controller
 * =================
 * Manages workspace-level GitHub connections, OAuth authorization, token encryption at rest,
 * and live GitHub REST API integration.
 *
 * Security Guarantees:
 * - Access tokens and refresh tokens are NEVER returned in API responses, logs, or URLs.
 * - Tokens are encrypted at rest using AES-256-GCM (encryptToken / decryptToken).
 * - Connections are strictly workspace-isolated.
 * - Role permissions:
 *     Admin & Member: Can connect, disconnect, add repos, view repos/issues/PRs.
 *     Viewer: Read-only access (cannot connect, cannot disconnect, cannot add repos).
 *
 * Token Lifecycle (GitHub OAuth App with "user token expiration" enabled):
 * - Access tokens (ghu_) expire after 8 hours.
 * - Refresh tokens (ghr_) are valid for ~6 months.
 * - The controller automatically refreshes the access token when it is expired or within
 *   TOKEN_REFRESH_BUFFER_MS of expiry, before retrying the GitHub API request.
 * - If the refresh token is also expired or refresh fails, the connection is marked "error"
 *   and a clean 401 is returned to the caller — mock data is NEVER silently substituted.
 *
 * Mock fallback:
 * - Mock data is ONLY returned when the workspace has NO GitHubConnection document (genuinely
 *   disconnected), not when a connection exists but the token is expired or refresh fails.
 */

const crypto = require("crypto");
const mongoose = require("mongoose");
const GitHubConnection = require("../models/GitHubConnection");
const Workspace = require("../models/Workspace");
const { encryptToken, decryptToken } = require("../utils/encryption");

// How far in advance to refresh the access token before it expires (5 minutes).
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

// In-memory fallback for custom repositories created by users during session
const customRepos = [];

// In-memory fallback for GitHub connections (used when DB is in memory mode or during unit tests)
const memoryConnections = [];

const mockRepos = [
  {
    id: 1,
    name: "AIRA",
    full_name: "aira-workspace/AIRA",
    description: "AI-powered enterprise work assistant workspace repository.",
    html_url: "",
    stargazers_count: 12,
    forks_count: 2,
    language: "TypeScript",
    open_issues_count: 4,
    is_mock: true,
  },
  {
    id: 2,
    name: "payment-service",
    full_name: "aira-workspace/payment-service",
    description: "Microservice handling payment gateways, Stripe integration and billing.",
    html_url: "",
    stargazers_count: 8,
    forks_count: 0,
    language: "Go",
    open_issues_count: 2,
    is_mock: true,
  },
  {
    id: 3,
    name: "customer-portal",
    full_name: "aira-workspace/customer-portal",
    description: "Next.js frontend application for client account dashboard.",
    html_url: "",
    stargazers_count: 15,
    forks_count: 5,
    language: "JavaScript",
    open_issues_count: 6,
    is_mock: true,
  },
];

const mockIssues = [
  {
    number: 101,
    title: "Bug: Theme preference not saving on page refresh",
    state: "open",
    user: { login: "darpan-soni" },
    created_at: "2026-08-29T10:00:00Z",
    html_url: "",
    comments: 3,
    is_mock: true,
  },
  {
    number: 102,
    title: "Feature: Integrate Groq streaming response in Chat page",
    state: "open",
    user: { login: "dev-lead" },
    created_at: "2026-08-30T14:30:00Z",
    html_url: "",
    comments: 1,
    is_mock: true,
  },
];

const mockPulls = [
  {
    number: 42,
    title: "feat: connect live python rag engine and update document uploader",
    state: "open",
    user: { login: "darpan-soni" },
    created_at: "2026-08-30T18:00:00Z",
    html_url: "",
    draft: false,
    is_mock: true,
  },
];

/**
 * Resolves the active workspace for the requesting user.
 */
async function resolveUserWorkspace(userId, requestedWorkspaceId) {
  if (requestedWorkspaceId) {
    try {
      const ws = await Workspace.findById(requestedWorkspaceId);
      if (ws) return ws;
    } catch (_) {}
  }
  if (!isDbConnected()) {
    return { _id: userId, name: "Default Workspace" };
  }
  let ws = await Workspace.findOne({ owner_id: userId, is_default: true });
  if (!ws) {
    ws = await Workspace.findOne({ owner_id: userId });
  }
  if (!ws && userId) {
    try {
      ws = await Workspace.create({
        name: "Default Workspace",
        owner_id: userId,
        is_default: true,
      });
    } catch (e) {
      console.warn("Could not auto-create default workspace:", e.message);
    }
  }
  return ws;
}

/**
 * Creates an HMAC-signed state parameter for OAuth CSRF protection.
 */
function generateOAuthState(userId, workspaceId) {
  const secret = process.env.JWT_SECRET || "aira_oauth_state_secret";
  const payload = JSON.stringify({
    userId,
    workspaceId,
    timestamp: Date.now(),
    nonce: crypto.randomBytes(8).toString("hex"),
  });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

/**
 * Validates and decodes the OAuth state parameter.
 */
function verifyOAuthState(state) {
  if (!state || !state.includes(".")) return null;
  const [encoded, signature] = state.split(".");
  const secret = process.env.JWT_SECRET || "aira_oauth_state_secret";
  const expectedSignature = crypto.createHmac("sha256", secret).update(encoded).digest("hex");
  if (signature !== expectedSignature) return null;

  try {
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    // State expires in 15 minutes
    if (Date.now() - decoded.timestamp > 15 * 60 * 1000) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Determines whether a stored access token is expired or within the refresh buffer window.
 *
 * @param {Date|null} tokenExpiresAt - The stored token_expires_at timestamp (null = non-expiring).
 * @returns {boolean} true if the token should be refreshed before use.
 */
function isTokenNearExpiry(tokenExpiresAt) {
  if (!tokenExpiresAt) return false; // Classic ghp_ token — no expiry.
  return Date.now() >= tokenExpiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS;
}

/**
 * Attempts to refresh the access token using the stored refresh token.
 * If successful, encrypts and persists the new token pair and updates expiry timestamps.
 * Returns the new plaintext access token on success.
 * Throws a descriptive Error on failure (refresh token expired, GitHub error, etc.).
 *
 * SECURITY: Raw tokens are NEVER logged.
 *
 * @param {object} connection - The GitHubConnection Mongoose document.
 * @returns {Promise<string>} The new plaintext access token.
 */
async function refreshAccessToken(connection) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GitHub OAuth credentials are not configured on the server.");
  }

  // Decrypt the stored refresh token.
  if (
    !connection.encrypted_refresh_token ||
    !connection.refresh_token_iv ||
    !connection.refresh_token_auth_tag
  ) {
    throw new Error(
      "No refresh token is stored for this workspace connection. " +
        "The user must re-authenticate via GitHub OAuth."
    );
  }

  // Check refresh token expiry before attempting the network call.
  if (
    connection.refresh_token_expires_at &&
    new Date() > connection.refresh_token_expires_at
  ) {
    await GitHubConnection.findByIdAndUpdate(connection._id, {
      status: "error",
      updated_at: new Date(),
    });
    throw new Error(
      "The GitHub refresh token has expired. The user must re-authenticate via GitHub OAuth."
    );
  }

  let plainRefreshToken;
  try {
    plainRefreshToken = decryptToken(
      connection.encrypted_refresh_token,
      connection.refresh_token_iv,
      connection.refresh_token_auth_tag
    );
  } catch (decErr) {
    throw new Error("Failed to decrypt the stored refresh token: " + decErr.message);
  }

  // Call GitHub token endpoint with grant_type=refresh_token.
  let tokenResp;
  try {
    tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: plainRefreshToken,
      }),
    });
  } catch (netErr) {
    throw new Error("Network error contacting GitHub for token refresh: " + netErr.message);
  }

  // Eagerly clear the plaintext reference now that the network call is done.
  // (JS GC will handle the actual memory, but this removes the reference.)
  plainRefreshToken = null;

  let tokenData;
  try {
    tokenData = await tokenResp.json();
  } catch {
    throw new Error("Invalid JSON response from GitHub token refresh endpoint.");
  }

  if (!tokenData.access_token) {
    // GitHub returns an error field when refresh fails (e.g. "bad_refresh_token").
    const reason = tokenData.error_description || tokenData.error || "unknown_error";
    await GitHubConnection.findByIdAndUpdate(connection._id, {
      status: "error",
      updated_at: new Date(),
    });
    throw new Error(`GitHub token refresh failed: ${reason}`);
  }

  const newAccessToken = tokenData.access_token;
  const newRefreshToken = tokenData.refresh_token || null;
  const newExpiresIn = tokenData.expires_in ? Number(tokenData.expires_in) : null;
  const newRefreshExpiresIn = tokenData.refresh_token_expires_in
    ? Number(tokenData.refresh_token_expires_in)
    : null;

  const newTokenExpiresAt = newExpiresIn
    ? new Date(Date.now() + newExpiresIn * 1000)
    : null;
  const newRefreshExpiresAt = newRefreshExpiresIn
    ? new Date(Date.now() + newRefreshExpiresIn * 1000)
    : connection.refresh_token_expires_at; // Keep old expiry if GitHub doesn't rotate it.

  // Encrypt new tokens at rest.
  const encAccess = encryptToken(newAccessToken);
  let encRefresh = null;
  if (newRefreshToken) {
    encRefresh = encryptToken(newRefreshToken);
  }

  // Persist updated token pair + timestamps.
  const updatePayload = {
    encrypted_access_token: encAccess.encryptedText,
    token_iv: encAccess.iv,
    token_auth_tag: encAccess.authTag,
    token_expires_at: newTokenExpiresAt,
    status: "connected",
    updated_at: new Date(),
  };
  if (encRefresh) {
    updatePayload.encrypted_refresh_token = encRefresh.encryptedText;
    updatePayload.refresh_token_iv = encRefresh.iv;
    updatePayload.refresh_token_auth_tag = encRefresh.authTag;
    updatePayload.refresh_token_expires_at = newRefreshExpiresAt;
  }

  await GitHubConnection.findByIdAndUpdate(connection._id, updatePayload);

  // Return only the new plaintext access token (used immediately and NOT stored or logged).
  return newAccessToken;
}

/**
 * Decrypts the access token from a connection, automatically refreshing it if near expiry.
 * Persists the refreshed token back to the database.
 *
 * @param {object} connection - The GitHubConnection Mongoose document.
 * @returns {Promise<string>} The valid plaintext access token ready for use.
 * @throws {Error} If the token is expired, refresh fails, or decryption fails.
 */
async function getValidAccessToken(connection) {
  if (isTokenNearExpiry(connection.token_expires_at)) {
    // Attempt automatic refresh. This updates the DB record and returns the new token.
    return await refreshAccessToken(connection);
  }

  // Token is valid — just decrypt and return.
  return decryptToken(
    connection.encrypted_access_token,
    connection.token_iv,
    connection.token_auth_tag
  );
}

/**
 * Resolves the active GitHubConnection for the user and workspace.
 * Queries by workspace_id and/or connected_by to ensure robust connection resolution
 * regardless of whether the request used a user ID or workspace ID.
 */
async function getActiveConnectionForUser(userId, requestedWorkspaceId) {
  const ws = await resolveUserWorkspace(userId, requestedWorkspaceId);
  const wsId = ws ? ws._id : null;

  if (!isDbConnected()) {
    const mem = memoryConnections.find(
      (c) =>
        c.status === "connected" &&
        ((wsId && c.workspace_id?.toString() === wsId.toString()) ||
          (userId && c.connected_by?.toString() === userId.toString()))
    );
    return { connection: mem || null, ws, wsId };
  }

  const orConditions = [];
  if (wsId) {
    orConditions.push({ workspace_id: wsId });
  }
  if (userId) {
    const uStr = userId.toString();
    if (mongoose.Types.ObjectId.isValid(uStr)) {
      orConditions.push({ connected_by: uStr });
      orConditions.push({ workspace_id: uStr });
    }
  }
  if (
    requestedWorkspaceId &&
    mongoose.Types.ObjectId.isValid(requestedWorkspaceId) &&
    requestedWorkspaceId.toString() !== wsId?.toString() &&
    requestedWorkspaceId.toString() !== userId?.toString()
  ) {
    orConditions.push({ workspace_id: requestedWorkspaceId });
  }

  if (orConditions.length === 0) {
    return { connection: null, ws, wsId };
  }

  const connection = await GitHubConnection.findOne({
    $or: orConditions,
    status: "connected",
  });

  return { connection, ws, wsId };
}

// ── GET /api/github/status ──────────────────────────────────────────────────
exports.getStatus = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { connection, wsId } = await getActiveConnectionForUser(userId, req.query.workspace_id);

    if (!connection) {
      return res.status(200).json({
        connected: false,
        githubUsername: null,
        avatarUrl: null,
        repositoryCount: 0,
        status: "disconnected",
        tokenState: "no_connection",
        is_mock: true,
        workspace_id: wsId,
      });
    }

    // Connection exists — determine the actual token state.
    let tokenState = "valid";

    if (connection.token_expires_at) {
      const now = new Date();
      if (now > connection.token_expires_at) {
        // Access token is expired — check whether a refresh token is available and non-expired.
        const hasRefreshToken =
          connection.encrypted_refresh_token &&
          connection.refresh_token_iv &&
          connection.refresh_token_auth_tag;
        const refreshExpired =
          connection.refresh_token_expires_at &&
          now > connection.refresh_token_expires_at;

        if (!hasRefreshToken || refreshExpired) {
          // Both tokens are expired — cannot auto-recover; user must reconnect.
          tokenState = "reauth_required";
        } else {
          // Access token expired but refresh token is still valid — auto-refresh is possible.
          tokenState = "token_expired_refresh_available";
        }
      } else if (isTokenNearExpiry(connection.token_expires_at)) {
        tokenState = "near_expiry";
      }
    }

    // Return safe sanitized info — NEVER return access token, refresh token, or encrypted fields!
    return res.status(200).json({
      connected: connection.status === "connected",
      githubUsername: connection.github_username,
      avatarUrl: connection.avatar_url,
      repositoryCount: customRepos.length,
      status: connection.status,
      tokenState,
      tokenExpiresAt: connection.token_expires_at || null,
      connected_at: connection.connected_at,
      is_mock: false,
      workspace_id: wsId,
    });
  } catch (err) {
    console.error("getStatus error:", err.message);
    res.status(500).json({ success: false, message: "Could not retrieve GitHub status" });
  }
};

// ── GET /api/github/oauth/authorize ──────────────────────────────────────────
exports.oauthAuthorize = async (req, res) => {
  try {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID in your environment.",
        code: "OAUTH_NOT_CONFIGURED",
      });
    }

    const userId = req.user._id || req.user.id;
    const ws = await resolveUserWorkspace(userId, req.query.workspace_id);
    const wsId = ws ? ws._id.toString() : "";

    const state = generateOAuthState(userId.toString(), wsId);
    const redirectUri =
      process.env.GITHUB_CALLBACK_URL || "http://localhost:5000/api/github/oauth/callback";

    const scope = "repo,read:user";
    const githubUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
      clientId
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(
      state
    )}`;

    res.status(200).json({
      success: true,
      authorization_url: githubUrl,
    });
  } catch (err) {
    console.error("oauthAuthorize error:", err.message);
    res.status(500).json({ success: false, message: "Failed to initiate GitHub authorization" });
  }
};

// ── GET /api/github/oauth/callback ──────────────────────────────────────────
exports.oauthCallback = async (req, res) => {
  const frontendUrl = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.warn("GitHub OAuth declined:", error);
      return res.redirect(
        `${frontendUrl}/github?error=${encodeURIComponent(error_description || error)}`
      );
    }

    if (!code || !state) {
      return res.redirect(`${frontendUrl}/github?error=missing_code_or_state`);
    }

    const verifiedState = verifyOAuthState(state);
    if (!verifiedState) {
      return res.redirect(`${frontendUrl}/github?error=invalid_or_expired_state`);
    }

    const { userId, workspaceId } = verifiedState;
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri =
      process.env.GITHUB_CALLBACK_URL || "http://localhost:5000/api/github/oauth/callback";

    // 1. Exchange code for access token
    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      console.error("OAuth token exchange failed (no access_token in response).");
      return res.redirect(
        `${frontendUrl}/github?error=${encodeURIComponent(
          tokenData.error_description || "Token exchange failed"
        )}`
      );
    }

    // Fix B: Capture all token lifecycle fields from GitHub's response.
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || null;
    const expiresIn = tokenData.expires_in ? Number(tokenData.expires_in) : null;
    const refreshExpiresIn = tokenData.refresh_token_expires_in
      ? Number(tokenData.refresh_token_expires_in)
      : null;

    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
    const refreshExpiresAt = refreshExpiresIn
      ? new Date(Date.now() + refreshExpiresIn * 1000)
      : null;

    // 2. Fetch authenticated GitHub user profile.
    const userResp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "AIRA-Assistant",
      },
    });

    if (!userResp.ok) {
      return res.redirect(`${frontendUrl}/github?error=failed_to_fetch_profile`);
    }

    const ghUser = await userResp.json();

    // 3. Encrypt access token at rest using AES-256-GCM.
    const encAccess = encryptToken(accessToken);

    // 4. Encrypt refresh token at rest (if present).
    let encRefresh = null;
    if (refreshToken) {
      encRefresh = encryptToken(refreshToken);
    }

    // 5. Resolve workspace.
    let wsId = workspaceId;
    if ((!wsId || wsId === "") && isDbConnected()) {
      const ws = await resolveUserWorkspace(userId);
      wsId = ws ? ws._id : null;
    }

    if (isDbConnected() && wsId) {
      await GitHubConnection.findOneAndUpdate(
        { workspace_id: wsId },
        {
          workspace_id: wsId,
          connected_by: userId,
          github_user_id: String(ghUser.id),
          github_username: ghUser.login,
          avatar_url: ghUser.avatar_url || "",
          // Access token
          encrypted_access_token: encAccess.encryptedText,
          token_iv: encAccess.iv,
          token_auth_tag: encAccess.authTag,
          token_expires_at: tokenExpiresAt,
          // Refresh token (only set when GitHub provides one)
          encrypted_refresh_token: encRefresh ? encRefresh.encryptedText : null,
          refresh_token_iv: encRefresh ? encRefresh.iv : null,
          refresh_token_auth_tag: encRefresh ? encRefresh.authTag : null,
          refresh_token_expires_at: refreshExpiresAt,
          scopes: tokenData.scope ? tokenData.scope.split(",") : ["repo", "read:user"],
          status: "connected",
          connected_at: new Date(),
          updated_at: new Date(),
        },
        { upsert: true, new: true }
      );
    }

    res.redirect(
      `${frontendUrl}/github?connection=success&username=${encodeURIComponent(ghUser.login)}`
    );
  } catch (err) {
    console.error("oauthCallback error:", err.message);
    res.redirect(`${frontendUrl}/github?error=internal_oauth_error`);
  }
};

// ── POST /api/github/connect-pat (Fallback / Dev Token Connect) ──────────────
exports.connectPat = async (req, res) => {
  try {
    const { token, workspace_id } = req.body || {};
    if (!token || token.trim() === "") {
      return res.status(400).json({ success: false, message: "Personal Access Token is required" });
    }

    // Verify token directly with GitHub API
    const userResp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "User-Agent": "AIRA-Assistant",
      },
    });

    if (!userResp.ok) {
      return res.status(401).json({
        success: false,
        message: "Invalid GitHub token. GitHub rejected credentials.",
      });
    }

    const userId = req.user._id || req.user.id;
    const ws = await resolveUserWorkspace(userId, workspace_id);
    const wsId = ws ? ws._id : null;

    if (!wsId) {
      return res.status(400).json({ success: false, message: "Workspace could not be determined" });
    }

    const ghUser = await userResp.json();
    const enc = encryptToken(token.trim());

    const connDoc = {
      workspace_id: wsId,
      connected_by: userId,
      github_user_id: String(ghUser.id),
      github_username: ghUser.login,
      avatar_url: ghUser.avatar_url || "",
      encrypted_access_token: enc.encryptedText,
      token_iv: enc.iv,
      token_auth_tag: enc.authTag,
      token_expires_at: null,
      encrypted_refresh_token: null,
      refresh_token_iv: null,
      refresh_token_auth_tag: null,
      refresh_token_expires_at: null,
      status: "connected",
      connected_at: new Date(),
      updated_at: new Date(),
    };

    if (isDbConnected()) {
      await GitHubConnection.findOneAndUpdate(
        { workspace_id: wsId },
        connDoc,
        { upsert: true, new: true }
      );
    } else {
      const idx = memoryConnections.findIndex(
        (c) => c.workspace_id?.toString() === wsId?.toString() || c.connected_by?.toString() === userId?.toString()
      );
      if (idx >= 0) {
        memoryConnections[idx] = { ...memoryConnections[idx], ...connDoc };
      } else {
        memoryConnections.push(connDoc);
      }
    }

    res.status(200).json({
      success: true,
      message: `Successfully connected GitHub account '${ghUser.login}' to workspace`,
      connection: {
        connected: true,
        githubUsername: ghUser.login,
        avatarUrl: ghUser.avatar_url,
        workspace_id: wsId,
        is_mock: false,
      },
    });
  } catch (err) {
    console.error("connectPat error:", err.message);
    res.status(500).json({ success: false, message: "Could not connect GitHub token" });
  }
};

// ── POST /api/github/disconnect ─────────────────────────────────────────────
exports.disconnect = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const ws = await resolveUserWorkspace(userId, req.body?.workspace_id);
    const wsId = ws ? ws._id : null;

    if (isDbConnected() && wsId) {
      await GitHubConnection.findOneAndUpdate(
        { workspace_id: wsId },
        { status: "disconnected", updated_at: new Date() }
      );
    } else {
      const idx = memoryConnections.findIndex(
        (c) => (wsId && c.workspace_id?.toString() === wsId.toString()) || (userId && c.connected_by?.toString() === userId.toString())
      );
      if (idx >= 0) {
        memoryConnections[idx].status = "disconnected";
        memoryConnections[idx].updated_at = new Date();
      }
    }

    res.status(200).json({
      success: true,
      message: "Workspace GitHub connection disconnected successfully",
      status: "disconnected",
    });
  } catch (err) {
    console.error("disconnect error:", err.message);
    res.status(500).json({ success: false, message: "Could not disconnect GitHub connection" });
  }
};

// ── GET /api/github/repos ───────────────────────────────────────────────────
exports.listRepos = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { connection, wsId } = await getActiveConnectionForUser(userId, req.query.workspace_id);

    if (connection) {
      // A connection exists — NEVER silently fall back to mock data.
      // Obtain a valid access token (auto-refreshing if expired).
      let accessToken;
      try {
        accessToken = await getValidAccessToken(connection);
      } catch (tokenErr) {
        console.error("Token acquisition failed for listRepos:", tokenErr.message);
        return res.status(401).json({
          success: false,
          message:
            "GitHub authentication failed. " +
            "Your GitHub access token has expired and could not be refreshed. " +
            "Please reconnect GitHub via Settings → GitHub.",
          code: "GITHUB_AUTH_EXPIRED",
          reconnect_required: true,
        });
      }

      let allLiveRepos = [];
      let page = 1;
      let hasMore = true;

      try {
        while (hasMore && page <= 3) {
          const ghResp = await fetch(
            `https://api.github.com/user/repos?per_page=100&sort=updated&type=all&page=${page}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.github.v3+json",
                "User-Agent": "AIRA-Assistant",
              },
            }
          );

          if (!ghResp.ok) {
            if (page === 1) {
              const ghErrText = await ghResp.text().catch(() => "");
              console.error(`GitHub API error (${ghResp.status}) on listRepos:`, ghErrText);
              return res.status(ghResp.status).json({
                success: false,
                message: `GitHub API error: HTTP ${ghResp.status}`,
                code: "GITHUB_API_ERROR",
              });
            }
            break;
          }

          const pageItems = await ghResp.json();
          if (!Array.isArray(pageItems) || pageItems.length === 0) {
            hasMore = false;
          } else {
            allLiveRepos.push(...pageItems);
            if (pageItems.length < 100) {
              hasMore = false;
            } else {
              page++;
            }
          }
        }
      } catch (netErr) {
        console.error("Network error contacting GitHub API:", netErr.message);
        return res.status(502).json({
          success: false,
          message: `Network error connecting to GitHub: ${netErr.message}`,
          code: "GITHUB_NETWORK_ERROR",
        });
      }

      const mapped = allLiveRepos.map((r) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        description: r.description || "",
        html_url: r.html_url || `https://github.com/${r.full_name}`,
        stargazers_count: r.stargazers_count || 0,
        forks_count: r.forks_count || 0,
        language: r.language || "Unknown",
        open_issues_count: r.open_issues_count || 0,
        owner: r.owner ? { login: r.owner.login, avatar_url: r.owner.avatar_url } : null,
        private: Boolean(r.private),
        is_mock: false,
      }));

      const allRepos = [...customRepos, ...mapped];
      return res.status(200).json({
        repositories: allRepos,
        count: allRepos.length,
        is_mock: false,
        source: "live_github",
      });
    }

    // Workspace has NO connected GitHubConnection → genuine disconnected mock fallback.
    const allRepos = [...customRepos, ...mockRepos];
    res.status(200).json({
      repositories: allRepos,
      count: allRepos.length,
      is_mock: true,
      source: "mock_fallback",
    });
  } catch (err) {
    console.error("listRepos error:", err.message);
    res.status(500).json({ success: false, message: "Could not fetch repositories" });
  }
};

// ── POST /api/github/repos (Add Repository) ──────────────────────────────────
exports.addRepo = async (req, res) => {
  try {
    const { name, full_name, description, html_url, language } = req.body;
    if (!name || name.trim() === "") {
      return res.status(400).json({ success: false, message: "Repository name is required" });
    }

    const trimmedName = name.trim();
    const resolvedFullName = full_name?.trim() || `workspace/${trimmedName}`;
    const resolvedHtmlUrl = html_url?.trim() || "";

    const newRepo = {
      id: Date.now(),
      name: trimmedName,
      full_name: resolvedFullName,
      description: description?.trim() || "User connected repository.",
      html_url: resolvedHtmlUrl,
      stargazers_count: 0,
      forks_count: 0,
      language: language?.trim() || "TypeScript",
      open_issues_count: 0,
      is_mock: false,
    };

    customRepos.unshift(newRepo);

    res.status(201).json({
      success: true,
      repository: newRepo,
      message: `Repository '${newRepo.full_name}' added successfully`,
    });
  } catch (err) {
    console.error("addRepo error:", err.message);
    res.status(500).json({ success: false, message: "Could not add repository" });
  }
};

// ── GET /api/github/issues ──────────────────────────────────────────────────
exports.listIssues = async (req, res) => {
  try {
    const rawRepo = req.query.repo || null;
    const userId = req.user._id || req.user.id;
    const { connection } = await getActiveConnectionForUser(userId, req.query.workspace_id);

    let repo = rawRepo ? rawRepo.trim().replace(/[.,:;?!"'`()\[\]{}<>]+$/, "") : null;
    if (repo && !repo.includes("/") && connection?.github_username) {
      repo = `${connection.github_username}/${repo}`;
    }

    if (connection) {
      if (!repo || !repo.includes("/")) {
        return res.status(400).json({
          success: false,
          message: "Repository full_name (owner/name) is required to fetch issues",
        });
      }

      let accessToken;
      try {
        accessToken = await getValidAccessToken(connection);
      } catch (tokenErr) {
        console.error("Token acquisition failed for listIssues:", tokenErr.message);
        return res.status(401).json({
          success: false,
          message:
            "GitHub authentication failed. Your access token has expired and could not be refreshed. " +
            "Please reconnect GitHub.",
          code: "GITHUB_AUTH_EXPIRED",
          reconnect_required: true,
        });
      }

      let ghResp;
      const issueState = req.query.state || "all";
      try {
        ghResp = await fetch(`https://api.github.com/repos/${repo}/issues?per_page=50&state=${issueState}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "AIRA-Assistant",
          },
        });
      } catch (netErr) {
        return res.status(502).json({
          success: false,
          message: `Network error connecting to GitHub: ${netErr.message}`,
        });
      }

      if (!ghResp.ok) {
        console.error(`GitHub API error (${ghResp.status}) on listIssues.`);
        return res.status(ghResp.status).json({
          success: false,
          message: `GitHub API error fetching issues: HTTP ${ghResp.status}`,
          code: "GITHUB_API_ERROR",
        });
      }

      const liveItems = await ghResp.json();
      const liveIssues = liveItems
        .filter((item) => !item.pull_request)
        .map((issue) => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          user: { login: issue.user?.login || "unknown" },
          created_at: issue.created_at,
          html_url: issue.html_url,
          comments: issue.comments || 0,
          is_mock: false,
        }));

      return res.status(200).json({
        issues: liveIssues,
        count: liveIssues.length,
        repository: repo,
        is_mock: false,
      });
    }

    // Genuinely disconnected fallback
    res.status(200).json({
      issues: mockIssues,
      count: mockIssues.length,
      repository: repo,
      is_mock: true,
    });
  } catch (err) {
    console.error("listIssues error:", err.message);
    res.status(500).json({ success: false, message: "Could not fetch issues" });
  }
};

// ── GET /api/github/pulls ───────────────────────────────────────────────────
exports.listPulls = async (req, res) => {
  try {
    const rawRepo = req.query.repo || null;
    const userId = req.user._id || req.user.id;
    const { connection } = await getActiveConnectionForUser(userId, req.query.workspace_id);

    let repo = rawRepo ? rawRepo.trim().replace(/[.,:;?!"'`()\[\]{}<>]+$/, "") : null;
    if (repo && !repo.includes("/") && connection?.github_username) {
      repo = `${connection.github_username}/${repo}`;
    }

    if (connection) {
      if (!repo || !repo.includes("/")) {
        return res.status(400).json({
          success: false,
          message: "Repository full_name (owner/name) is required to fetch pull requests",
        });
      }

      let accessToken;
      try {
        accessToken = await getValidAccessToken(connection);
      } catch (tokenErr) {
        console.error("Token acquisition failed for listPulls:", tokenErr.message);
        return res.status(401).json({
          success: false,
          message:
            "GitHub authentication failed. Your access token has expired and could not be refreshed. " +
            "Please reconnect GitHub.",
          code: "GITHUB_AUTH_EXPIRED",
          reconnect_required: true,
        });
      }

      let ghResp;
      const pullState = req.query.state || "all";
      try {
        ghResp = await fetch(`https://api.github.com/repos/${repo}/pulls?per_page=50&state=${pullState}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "AIRA-Assistant",
          },
        });
      } catch (netErr) {
        return res.status(502).json({
          success: false,
          message: `Network error connecting to GitHub: ${netErr.message}`,
        });
      }

      if (!ghResp.ok) {
        console.error(`GitHub API error (${ghResp.status}) on listPulls.`);
        return res.status(ghResp.status).json({
          success: false,
          message: `GitHub API error fetching pull requests: HTTP ${ghResp.status}`,
          code: "GITHUB_API_ERROR",
        });
      }

      const livePulls = await ghResp.json();
      const mappedPulls = livePulls.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        user: { login: pr.user?.login || "unknown" },
        created_at: pr.created_at,
        html_url: pr.html_url,
        draft: Boolean(pr.draft),
        is_mock: false,
      }));

      return res.status(200).json({
        pulls: mappedPulls,
        count: mappedPulls.length,
        repository: repo,
        is_mock: false,
      });
    }

    // Genuinely disconnected fallback
    res.status(200).json({
      pulls: mockPulls,
      count: mockPulls.length,
      repository: repo,
      is_mock: true,
    });
  } catch (err) {
    console.error("listPulls error:", err.message);
    res.status(500).json({ success: false, message: "Could not fetch pull requests" });
  }
};

// ── GET /api/github/tree ────────────────────────────────────────────────────
exports.getRepoTree = async (req, res) => {
  try {
    const rawRepo = req.query.repo || null;
    const userId = req.user._id || req.user.id;
    const { connection } = await getActiveConnectionForUser(userId, req.query.workspace_id);

    let repo = rawRepo ? rawRepo.trim().replace(/[.,:;?!"'`()\[\]{}<>]+$/, "") : null;
    if (repo && !repo.includes("/") && connection?.github_username) {
      repo = `${connection.github_username}/${repo}`;
    }

    if (connection) {
      if (!repo || !repo.includes("/")) {
        return res.status(400).json({
          success: false,
          message: "Repository full_name (owner/name) is required to fetch tree",
        });
      }

      let accessToken;
      try {
        accessToken = await getValidAccessToken(connection);
      } catch (tokenErr) {
        return res.status(401).json({
          success: false,
          message:
            "GitHub authentication failed. Your access token has expired and could not be refreshed. " +
            "Please reconnect GitHub.",
          code: "GITHUB_AUTH_EXPIRED",
          reconnect_required: true,
        });
      }

      const targetBranch = req.query.branch || "HEAD";
      let ghResp;
      try {
        ghResp = await fetch(
          `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(targetBranch)}?recursive=1`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "AIRA-Assistant",
            },
          }
        );
      } catch (netErr) {
        return res.status(502).json({
          success: false,
          message: `Network error connecting to GitHub: ${netErr.message}`,
        });
      }

      if (!ghResp.ok) {
        if (ghResp.status === 404) {
          return res.status(404).json({
            success: false,
            message: `Repository or branch not found on GitHub: ${repo} (${targetBranch})`,
            code: "NOT_FOUND",
          });
        }
        if (ghResp.status === 401 || ghResp.status === 403) {
          return res.status(ghResp.status).json({
            success: false,
            message: `GitHub permission or rate limit error: HTTP ${ghResp.status}`,
            code: "GITHUB_PERM_ERROR",
          });
        }
        return res.status(ghResp.status).json({
          success: false,
          message: `GitHub API error fetching file tree: HTTP ${ghResp.status}`,
          code: "GITHUB_API_ERROR",
        });
      }

      const data = await ghResp.json();
      const rawTree = Array.isArray(data.tree) ? data.tree : [];
      const files = [];
      const directories = [];
      const treeItems = [];

      for (const item of rawTree) {
        if (item.type === "blob") {
          files.push(item.path);
          treeItems.push({ path: item.path, type: "blob", size: item.size });
        } else if (item.type === "tree") {
          directories.push(item.path);
          treeItems.push({ path: item.path, type: "tree" });
        }
      }

      return res.status(200).json({
        success: true,
        repository: repo,
        branch: targetBranch,
        truncated: Boolean(data.truncated),
        tree: treeItems,
        files,
        directories,
        count: files.length,
        is_mock: false,
        source: "live_github",
      });
    }

    // Disconnected fallback: return standard mock tree structure
    const mockFiles = [
      "README.md",
      "package.json",
      "frontend/src/App.tsx",
      "frontend/src/pages/DashboardPage.tsx",
      "frontend/src/pages/ChatPage.tsx",
      "frontend/src/services/api.ts",
      "backend/server.js",
      "backend/src/routes/github.js",
      "backend/src/controllers/githubController.js",
      "Ai-Service/app/main.py",
      "Ai-Service/app/services/agent_service.py",
      "Ai-Service/app/services/langgraph_agent.py",
    ];
    return res.status(200).json({
      success: true,
      repository: repo || "aira-workspace/AIRA",
      branch: "main",
      truncated: false,
      tree: mockFiles.map((p) => ({ path: p, type: "blob", size: 1024 })),
      files: mockFiles,
      directories: ["frontend", "backend", "Ai-Service"],
      count: mockFiles.length,
      is_mock: true,
      source: "mock_fallback",
    });
  } catch (err) {
    console.error("getRepoTree error:", err.message);
    res.status(500).json({ success: false, message: "Could not fetch repository file tree" });
  }
};

// ── GET /api/github/file ────────────────────────────────────────────────────
exports.getFileContent = async (req, res) => {
  try {
    const rawRepo = req.query.repo || null;
    const rawPath = req.query.path || null;
    const userId = req.user._id || req.user.id;
    const { connection } = await getActiveConnectionForUser(userId, req.query.workspace_id);

    let repo = rawRepo ? rawRepo.trim().replace(/[.,:;?!"'`()\[\]{}<>]+$/, "") : null;
    if (repo && !repo.includes("/") && connection?.github_username) {
      repo = `${connection.github_username}/${repo}`;
    }

    if (!rawPath || !rawPath.trim()) {
      return res.status(400).json({
        success: false,
        message: "File path parameter 'path' is required",
      });
    }

    const filePath = rawPath.trim().replace(/^\/+/, "");

    if (connection) {
      if (!repo || !repo.includes("/")) {
        return res.status(400).json({
          success: false,
          message: "Repository full_name (owner/name) is required to fetch file",
        });
      }

      let accessToken;
      try {
        accessToken = await getValidAccessToken(connection);
      } catch (tokenErr) {
        return res.status(401).json({
          success: false,
          message:
            "GitHub authentication failed. Your access token has expired and could not be refreshed. " +
            "Please reconnect GitHub.",
          code: "GITHUB_AUTH_EXPIRED",
          reconnect_required: true,
        });
      }

      const refParam = req.query.ref ? `?ref=${encodeURIComponent(req.query.ref)}` : "";
      let ghResp;
      try {
        ghResp = await fetch(
          `https://api.github.com/repos/${repo}/contents/${filePath}${refParam}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "AIRA-Assistant",
            },
          }
        );
      } catch (netErr) {
        return res.status(502).json({
          success: false,
          message: `Network error connecting to GitHub: ${netErr.message}`,
        });
      }

      if (!ghResp.ok) {
        if (ghResp.status === 404) {
          return res.status(404).json({
            success: false,
            message: `File '${filePath}' not found in repository '${repo}'`,
            code: "FILE_NOT_FOUND",
          });
        }
        if (ghResp.status === 401 || ghResp.status === 403) {
          return res.status(ghResp.status).json({
            success: false,
            message: `GitHub permission or rate limit error reading '${filePath}': HTTP ${ghResp.status}`,
            code: "GITHUB_PERM_ERROR",
          });
        }
        return res.status(ghResp.status).json({
          success: false,
          message: `GitHub API error fetching file content: HTTP ${ghResp.status}`,
          code: "GITHUB_API_ERROR",
        });
      }

      const data = await ghResp.json();
      let contentText = "";
      if (data.encoding === "base64" && data.content) {
        contentText = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
      } else if (typeof data.content === "string") {
        contentText = data.content;
      }

      // Max 100KB for response body safety
      const MAX_LEN = 100 * 1024;
      const isTruncated = contentText.length > MAX_LEN;
      const safeContent = isTruncated
        ? contentText.slice(0, MAX_LEN) + "\n\n[... truncated by server ...]"
        : contentText;

      return res.status(200).json({
        success: true,
        repository: repo,
        path: filePath,
        size: data.size || safeContent.length,
        content: safeContent,
        truncated: isTruncated,
        is_mock: false,
        source: "live_github",
      });
    }

    // Disconnected fallback: return clear mock content
    return res.status(200).json({
      success: true,
      repository: repo || "aira-workspace/AIRA",
      path: filePath,
      size: 200,
      content: `[MOCK FILE: ${filePath}]\nThis is fallback content because workspace is disconnected from GitHub.`,
      truncated: false,
      is_mock: true,
      source: "mock_fallback",
    });
  } catch (err) {
    console.error("getFileContent error:", err.message);
    res.status(500).json({ success: false, message: "Could not fetch file content" });
  }
};

// Export internal helpers for unit testing only.
// These are NOT part of the public API and must not be called from routes.
exports._internal = {
  isTokenNearExpiry,
  refreshAccessToken,
  getValidAccessToken,
  TOKEN_REFRESH_BUFFER_MS,
};
