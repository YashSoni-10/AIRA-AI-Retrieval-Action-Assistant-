/**
 * GitHub Controller — Token Lifecycle Unit Tests
 * ===============================================
 * Tests the pure internal helpers exported via _internal without
 * any real network calls or database connections.
 *
 * Covers (matching the integration test numbering):
 *  2. Valid token (no expiry / far future) → isTokenNearExpiry returns false.
 *  3. Near-expiry token (within buffer)    → isTokenNearExpiry returns true.
 *  4. Expired token (past expiry)          → isTokenNearExpiry returns true.
 *  5. refreshAccessToken rotates token pair in DB and returns new access token.
 *  6. refreshAccessToken with bad refresh token → throws descriptive Error.
 * 12. refreshAccessToken when refresh token itself expired → throws, marks status "error".
 * 18. PAT (null token_expires_at) → isTokenNearExpiry returns false.
 */

"use strict";

const { encryptToken, decryptToken } = require("../utils/encryption");

// We require the controller to access _internal helpers.
// To avoid real mongoose/DB imports breaking the test, we mock the heavy deps.
jest.mock("mongoose", () => {
  const actual = jest.requireActual("mongoose");
  return {
    ...actual,
    connection: { readyState: 0 }, // not connected — prevents real DB calls
    Schema: {
      Types: { ObjectId: String },
    },
  };
});

jest.mock("../models/GitHubConnection", () => ({
  findByIdAndUpdate: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock("../models/Workspace", () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
}));

const GitHubConnection = require("../models/GitHubConnection");
const { _internal } = require("../controllers/githubController");
const { isTokenNearExpiry, TOKEN_REFRESH_BUFFER_MS } = _internal;

// ── isTokenNearExpiry ─────────────────────────────────────────────────────────

describe("isTokenNearExpiry", () => {
  test("2 — returns false when token_expires_at is null (classic PAT / no-expiry token)", () => {
    expect(isTokenNearExpiry(null)).toBe(false);
  });

  test("2 — returns false when token_expires_at is far in the future", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    expect(isTokenNearExpiry(future)).toBe(false);
  });

  test("3 — returns true when token_expires_at is within the refresh buffer", () => {
    const nearExpiry = new Date(Date.now() + TOKEN_REFRESH_BUFFER_MS - 1000); // 1 second inside buffer
    expect(isTokenNearExpiry(nearExpiry)).toBe(true);
  });

  test("4 — returns true when token_expires_at is in the past (already expired)", () => {
    const expired = new Date(Date.now() - 60 * 1000); // 1 minute ago
    expect(isTokenNearExpiry(expired)).toBe(true);
  });

  test("18 — returns false for undefined token_expires_at (PAT connection)", () => {
    expect(isTokenNearExpiry(undefined)).toBe(false);
  });
});

// ── refreshAccessToken ────────────────────────────────────────────────────────

describe("refreshAccessToken", () => {
  const makeConnection = (overrides = {}) => ({
    _id: "conn_id_123",
    encrypted_refresh_token: null,
    refresh_token_iv: null,
    refresh_token_auth_tag: null,
    refresh_token_expires_at: null,
    token_expires_at: new Date(Date.now() - 1000), // expired 1 sec ago
    ...overrides,
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset fetch mock
    if (global.fetch && global.fetch.mockRestore) {
      global.fetch.mockRestore();
    }
  });

  test("6 — throws when no refresh token is stored in the connection", async () => {
    const { refreshAccessToken } = _internal;
    const conn = makeConnection({
      encrypted_refresh_token: null,
      refresh_token_iv: null,
      refresh_token_auth_tag: null,
    });

    // Must not require GITHUB_CLIENT_ID/SECRET if it throws before network call.
    process.env.GITHUB_CLIENT_ID = "test_client_id";
    process.env.GITHUB_CLIENT_SECRET = "test_client_secret";

    await expect(refreshAccessToken(conn)).rejects.toThrow(
      /No refresh token is stored/
    );
  });

  test("12 — throws and marks status=error when refresh token is expired", async () => {
    const { refreshAccessToken } = _internal;

    const enc = encryptToken("ghr_fake_refresh_token");
    const conn = makeConnection({
      encrypted_refresh_token: enc.encryptedText,
      refresh_token_iv: enc.iv,
      refresh_token_auth_tag: enc.authTag,
      refresh_token_expires_at: new Date(Date.now() - 1000), // expired
    });

    GitHubConnection.findByIdAndUpdate.mockResolvedValue({});
    process.env.GITHUB_CLIENT_ID = "test_client_id";
    process.env.GITHUB_CLIENT_SECRET = "test_client_secret";

    await expect(refreshAccessToken(conn)).rejects.toThrow(
      /refresh token has expired/i
    );

    expect(GitHubConnection.findByIdAndUpdate).toHaveBeenCalledWith(
      conn._id,
      expect.objectContaining({ status: "error" })
    );
  });

  test("6 — throws with descriptive message when GitHub returns error on refresh", async () => {
    const { refreshAccessToken } = _internal;

    const enc = encryptToken("ghr_fake_but_valid_looking_refresh_token");
    const conn = makeConnection({
      encrypted_refresh_token: enc.encryptedText,
      refresh_token_iv: enc.iv,
      refresh_token_auth_tag: enc.authTag,
      refresh_token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // valid for 60 days
    });

    // Mock global fetch to simulate GitHub returning a bad_refresh_token error.
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        error: "bad_refresh_token",
        error_description: "The refresh token passed is incorrect or expired.",
      }),
    });

    GitHubConnection.findByIdAndUpdate.mockResolvedValue({});
    process.env.GITHUB_CLIENT_ID = "test_client_id";
    process.env.GITHUB_CLIENT_SECRET = "test_client_secret";

    await expect(refreshAccessToken(conn)).rejects.toThrow(
      /GitHub token refresh failed/
    );

    // Must mark status as error in DB.
    expect(GitHubConnection.findByIdAndUpdate).toHaveBeenCalledWith(
      conn._id,
      expect.objectContaining({ status: "error" })
    );
  });

  test("5 — successful refresh encrypts and persists new token pair, returns new access token", async () => {
    const { refreshAccessToken } = _internal;

    const enc = encryptToken("ghr_old_refresh_token");
    const conn = makeConnection({
      encrypted_refresh_token: enc.encryptedText,
      refresh_token_iv: enc.iv,
      refresh_token_auth_tag: enc.authTag,
      refresh_token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });

    const NEW_ACCESS = "ghu_new_access_token_from_github";
    const NEW_REFRESH = "ghr_new_refresh_token_from_github";

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        access_token: NEW_ACCESS,
        refresh_token: NEW_REFRESH,
        expires_in: 28800,
        refresh_token_expires_in: 15897600,
        token_type: "bearer",
        scope: "repo,read:user",
      }),
    });

    GitHubConnection.findByIdAndUpdate.mockResolvedValue({});
    process.env.GITHUB_CLIENT_ID = "test_client_id";
    process.env.GITHUB_CLIENT_SECRET = "test_client_secret";

    const newToken = await refreshAccessToken(conn);

    // Must return the new access token (plaintext) for immediate use.
    expect(newToken).toBe(NEW_ACCESS);

    // Must persist encrypted tokens in DB (not plaintext).
    expect(GitHubConnection.findByIdAndUpdate).toHaveBeenCalledWith(
      conn._id,
      expect.objectContaining({
        status: "connected",
        token_expires_at: expect.any(Date),
        // New encrypted_access_token must be present and NOT equal to the raw new token.
        encrypted_access_token: expect.not.stringContaining(NEW_ACCESS),
        encrypted_refresh_token: expect.not.stringContaining(NEW_REFRESH),
      })
    );

    // Verify that the stored encrypted values can be decrypted correctly.
    const updateCall = GitHubConnection.findByIdAndUpdate.mock.calls[0][1];
    const decryptedAccess = decryptToken(
      updateCall.encrypted_access_token,
      updateCall.token_iv,
      updateCall.token_auth_tag
    );
    expect(decryptedAccess).toBe(NEW_ACCESS);

    const decryptedRefresh = decryptToken(
      updateCall.encrypted_refresh_token,
      updateCall.refresh_token_iv,
      updateCall.refresh_token_auth_tag
    );
    expect(decryptedRefresh).toBe(NEW_REFRESH);
  });

  test("5 — refreshAccessToken throws when GITHUB_CLIENT_ID is missing", async () => {
    const { refreshAccessToken } = _internal;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;

    const enc = encryptToken("ghr_test_refresh_token");
    const conn = makeConnection({
      encrypted_refresh_token: enc.encryptedText,
      refresh_token_iv: enc.iv,
      refresh_token_auth_tag: enc.authTag,
      refresh_token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });

    await expect(refreshAccessToken(conn)).rejects.toThrow(
      /GitHub OAuth credentials are not configured/
    );
  });
});

// ── getValidAccessToken ───────────────────────────────────────────────────────

describe("getValidAccessToken", () => {
  afterEach(() => {
    jest.clearAllMocks();
    if (global.fetch && global.fetch.mockReset) global.fetch.mockReset();
  });

  test("2 — returns decrypted token directly when not near expiry (no refresh call)", async () => {
    const { getValidAccessToken } = _internal;

    const PLAIN_TOKEN = "ghp_classic_pat_no_expiry";
    const enc = encryptToken(PLAIN_TOKEN);

    const conn = {
      _id: "conn_valid_id",
      encrypted_access_token: enc.encryptedText,
      token_iv: enc.iv,
      token_auth_tag: enc.authTag,
      token_expires_at: null, // classic non-expiring token
    };

    const token = await getValidAccessToken(conn);
    expect(token).toBe(PLAIN_TOKEN);
  });

  test("3/4 — calls refreshAccessToken when token is near/past expiry", async () => {
    const { getValidAccessToken } = _internal;

    const enc = encryptToken("ghu_almost_expired");
    const encRefresh = encryptToken("ghr_refresh_token");

    const conn = {
      _id: "conn_near_expiry",
      encrypted_access_token: enc.encryptedText,
      token_iv: enc.iv,
      token_auth_tag: enc.authTag,
      token_expires_at: new Date(Date.now() - 5000), // already expired
      encrypted_refresh_token: encRefresh.encryptedText,
      refresh_token_iv: encRefresh.iv,
      refresh_token_auth_tag: encRefresh.authTag,
      refresh_token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    };

    const NEW_TOKEN = "ghu_freshly_refreshed_token";

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        access_token: NEW_TOKEN,
        refresh_token: "ghr_rotated",
        expires_in: 28800,
        refresh_token_expires_in: 15897600,
      }),
    });

    GitHubConnection.findByIdAndUpdate.mockResolvedValue({});
    process.env.GITHUB_CLIENT_ID = "test_client";
    process.env.GITHUB_CLIENT_SECRET = "test_secret";

    const result = await getValidAccessToken(conn);
    expect(result).toBe(NEW_TOKEN);
    // fetch must have been called for the refresh endpoint, not for any data endpoint.
    expect(global.fetch).toHaveBeenCalledWith(
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({ method: "POST" })
    );
  });
});
