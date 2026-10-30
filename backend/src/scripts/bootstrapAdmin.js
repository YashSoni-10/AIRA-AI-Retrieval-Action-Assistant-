/**
 * AIRA — Initial Admin Bootstrap CLI
 * ===================================
 * Safe, explicit administrative bootstrap procedure.
 * Promotes a specific registered user to the "admin" role.
 *
 * Usage:
 *   npm run make-admin <user-email>
 *   or:
 *   node src/scripts/bootstrapAdmin.js <user-email>
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

async function bootstrapAdmin() {
  const email = process.argv[2];

  if (!email || !email.includes("@")) {
    console.error("❌ Error: A valid email address is required.\nUsage: node src/scripts/bootstrapAdmin.js <user-email>");
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error("❌ Error: MONGO_URI is not set in the environment or .env file.");
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      console.error(`❌ Error: User with email "${normalizedEmail}" was not found.`);
      console.error("Please create the user account first via registration, then run this bootstrap script.");
      process.exit(1);
    }

    if (user.role === "admin") {
      console.log(`ℹ️ User "${normalizedEmail}" is already an administrator.`);
      process.exit(0);
    }

    user.role = "admin";
    await user.save();

    console.log(`✅ Success: User "${normalizedEmail}" (${user.name}) has been promoted to "admin".`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error running bootstrap script:", err.message);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  bootstrapAdmin();
}

module.exports = { bootstrapAdmin };
