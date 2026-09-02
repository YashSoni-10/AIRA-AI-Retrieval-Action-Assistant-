const jwt = require("jsonwebtoken");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

// In-memory fallback database
const memoryUsers = [];

const isDbConnected = () => mongoose.connection.readyState === 1;

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || "7d" });

const sendToken = (user, statusCode, res) => {
  const token = signToken(user._id || user.id);
  // Clone to avoid exposing password
  const userResponse = { ...user };
  delete userResponse.password;
  res.status(statusCode).json({ success: true, token, user: userResponse });
};

// POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Name, email and password are required" });

    const normalizedEmail = email.toLowerCase().trim();

    if (isDbConnected()) {
      const exists = await User.findOne({ email: normalizedEmail });
      if (exists)
        return res.status(409).json({ success: false, message: "Email already registered" });
      const user = await User.create({ name, email: normalizedEmail, password, role: role || "member" });
      sendToken(user.toObject(), 201, res);
    } else {
      // In-memory registration
      const exists = memoryUsers.find(u => u.email === normalizedEmail);
      if (exists)
        return res.status(409).json({ success: false, message: "Email already registered (In-Memory DB)" });

      const hashedPassword = await bcrypt.hash(password, 12);
      const user = {
        _id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        role: role || "member",
        avatar: "",
        isActive: true,
        createdAt: new Date().toISOString()
      };
      memoryUsers.push(user);
      sendToken(user, 201, res);
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password are required" });

    const normalizedEmail = email.toLowerCase().trim();

    if (isDbConnected()) {
      const user = await User.findOne({ email: normalizedEmail }).select("+password");
      if (!user || !(await user.comparePassword(password)))
        return res.status(401).json({ success: false, message: "Invalid email or password" });
      sendToken(user.toObject(), 200, res);
    } else {
      // In-memory login
      const user = memoryUsers.find(u => u.email === normalizedEmail);
      if (!user || !(await bcrypt.compare(password, user.password)))
        return res.status(401).json({ success: false, message: "Invalid email or password (In-Memory DB)" });
      sendToken(user, 200, res);
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    if (isDbConnected()) {
      const user = await User.findById(userId);
      res.status(200).json({ success: true, user });
    } else {
      const user = memoryUsers.find(u => u._id === userId);
      if (!user) return res.status(404).json({ success: false, message: "User not found" });
      const userResponse = { ...user };
      delete userResponse.password;
      res.status(200).json({ success: true, user: userResponse });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/auth/update-profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, role } = req.body;
    const userId = req.user._id || req.user.id;

    if (isDbConnected()) {
      const updated = await User.findByIdAndUpdate(
        userId,
        { ...(name && { name }), ...(role && { role }) },
        { new: true, runValidators: true }
      );
      res.status(200).json({ success: true, user: updated });
    } else {
      // In-memory update
      const index = memoryUsers.findIndex(u => u._id === userId);
      if (index === -1) return res.status(404).json({ success: false, message: "User not found" });
      
      if (name) memoryUsers[index].name = name;
      if (role) memoryUsers[index].role = role;
      
      const userResponse = { ...memoryUsers[index] };
      delete userResponse.password;
      res.status(200).json({ success: true, user: userResponse });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/auth/change-password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id || req.user.id;

    if (isDbConnected()) {
      const user = await User.findById(userId).select("+password");
      if (!(await user.comparePassword(currentPassword)))
        return res.status(401).json({ success: false, message: "Current password is wrong" });
      user.password = newPassword;
      await user.save();
      sendToken(user.toObject(), 200, res);
    } else {
      // In-memory password change
      const index = memoryUsers.findIndex(u => u._id === userId);
      if (index === -1) return res.status(404).json({ success: false, message: "User not found" });

      const user = memoryUsers[index];
      if (!(await bcrypt.compare(currentPassword, user.password)))
        return res.status(401).json({ success: false, message: "Current password is wrong" });

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      memoryUsers[index].password = hashedPassword;
      sendToken(memoryUsers[index], 200, res);
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.memoryUsers = memoryUsers;
