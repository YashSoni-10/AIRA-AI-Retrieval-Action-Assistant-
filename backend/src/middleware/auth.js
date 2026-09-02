const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const { memoryUsers } = require("../controllers/authController");

exports.protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: "Not authorised — no token provided" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    let user;
    if (mongoose.connection.readyState === 1) {
      user = await User.findById(decoded.id);
    } else {
      // In-memory fallback
      user = memoryUsers.find(u => u._id === decoded.id || u.id === decoded.id);
    }

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: "User session is invalid or user deactivated" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

exports.restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "You do not have permission to perform this action" });
  }
  next();
};
