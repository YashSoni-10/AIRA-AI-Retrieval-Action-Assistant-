/**
 * Token Encryption Utility
 * ========================
 * Implements AES-256-GCM encryption/decryption for sensitive credentials (e.g. GitHub tokens).
 * Tokens are never stored in plaintext at rest.
 */
const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Standard 96-bit IV for GCM

/**
 * Derives a 32-byte (256-bit) encryption key from the environment.
 * Prefers ENCRYPTION_KEY; falls back to SHA-256 hash of JWT_SECRET.
 */
function getEncryptionKey() {
  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length === 64) {
    // Hex encoded 32-byte key
    return Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  }
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "aira_default_secure_vault_secret_key_2026";
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a plaintext token using AES-256-GCM.
 * Returns { encryptedText, iv, authTag } (all hex-encoded).
 */
function encryptToken(plainText) {
  if (!plainText) {
    throw new Error("Plaintext token is required for encryption");
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    encryptedText: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag,
  };
}

/**
 * Decrypts a token from { encryptedText, iv, authTag } using AES-256-GCM.
 */
function decryptToken(encryptedText, ivHex, authTagHex) {
  if (!encryptedText || !ivHex || !authTagHex) {
    throw new Error("Missing encrypted components for decryption");
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

module.exports = {
  encryptToken,
  decryptToken,
};
