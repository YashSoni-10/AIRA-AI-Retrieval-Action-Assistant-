const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ["admin", "member", "viewer"], default: "member" },
    avatar: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    // Email verification (Phase 6C)
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    // Password reset (6B)
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    // Refresh tokens for session rotation and revocation (Phase 6A)
    refreshTokens: {
      type: [
        {
          tokenId: { type: String, required: true },
          expiresAt: { type: Date, required: true },
          createdAt: { type: Date, default: Date.now },
          rotatedAt: { type: Date },
        },
      ],
      select: false,
      default: [],
    },
  },
  { timestamps: true }
);

// Hash password before save (async hook in Mongoose 8 should NOT take or call next)
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Generates a raw email-verification token, stores its SHA-256 hash on the document,
 * sets expiry to 24 hours, and returns the raw token (to be emailed).
 */
userSchema.methods.generateEmailVerificationToken = function () {
  const rawToken = crypto.randomBytes(32).toString("hex");
  this.emailVerificationToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  return rawToken;
};

/**
 * Generates a raw password-reset token, stores its SHA-256 hash on the document,
 * sets expiry to 10 minutes, and returns the raw token (to be emailed).
 * Caller must call user.save() after this.
 */
userSchema.methods.generatePasswordResetToken = function () {
  const rawToken = crypto.randomBytes(32).toString("hex");
  this.passwordResetToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  this.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  return rawToken;
};

// Remove sensitive fields from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  delete obj.emailVerificationToken;
  delete obj.emailVerificationExpires;
  delete obj.refreshTokens;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
