// controllers/userController.js (snippet: ONLY registerUser shown updated)

const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const UserService = require('../services/userService');
const { normalizePhone } = require('../services/userService');
const AuthService = require('../services/authService');
const generateToken = require('../utils/generateToken');
const User = require('../models/User');
const {
  sendSuccess,
  sendError,
  sendValidationError,
  sendNotFound,
  sendUnauthorized,
} = require('../utils/responseHelper');

// -------------------- REGISTER (UPDATED) --------------------
const registerUser = asyncHandler(async (req, res) => {
  try {
    const user = await AuthService.registerUser(req.body, req.files);

    return sendSuccess(res, 201, 'User registered successfully', user);
  } catch (error) {
    console.error('Registration Error:', error);
    return sendError(
      res,
      error.statusCode || 500,
      error.message || 'Registration failed'
    );
  }
});

const signupStart = asyncHandler(async (req, res) => {
  try {
    const { identifier, name, role } = req.body;
    const data = await AuthService.startSignup({ identifier, name, role });
    return sendSuccess(res, 200, 'Verification code sent successfully', data);
  } catch (error) {
    console.error('Signup Start Error:', error);
    return sendError(res, error.statusCode || 500, error.message || 'Failed to start signup');
  }
});

const signupVerify = asyncHandler(async (req, res) => {
  try {
    const { identifier, code } = req.body;
    const data = await AuthService.verifySignupOtp({ identifier, code });
    return sendSuccess(res, 200, 'Code verified successfully', data);
  } catch (error) {
    console.error('Signup Verify Error:', error);
    return sendError(res, error.statusCode || 500, error.message || 'Failed to verify code');
  }
});

// Step 3 — Set passcode
const signupPasscode = asyncHandler(async (req, res) => {
  try {
    const { signupToken, password } = req.body;
    const data = await AuthService.setPasscode({ signupToken, password });
    return sendSuccess(res, 200, 'Passcode set successfully', data);
  } catch (error) {
    console.error('Signup Passcode Error:', error);
    return sendError(res, error.statusCode || 500, error.message || 'Failed to set passcode');
  }
});

// Step 4 — Complete signup: name + email (email required for phone-flow users)
const signupComplete = asyncHandler(async (req, res) => {
  try {
    const { tempToken, name, email, ...profile } = req.body;
    const user = await AuthService.completeSignup({
      tempToken,
      name,
      email,
      profile: { ...profile, files: req.files },
    });
    const token = generateToken(user._id, user.role);
    return sendSuccess(res, 201, 'Account created successfully', { token, user });
  } catch (error) {
    console.error('Signup Complete Error:', error);
    return sendError(res, error.statusCode || 500, error.message || 'Failed to complete signup');
  }
});

const forgotPassword = asyncHandler(async (req, res) => {
  try {
    const { email, resetBaseUrl } = req.body;
    const data = await AuthService.forgotPassword({ email, resetBaseUrl });
    return sendSuccess(res, 200, data.message);
  } catch (error) {
    console.error('Forgot Password Error:', error);
    return sendError(res, error.statusCode || 500, error.message || 'Failed to process forgot password');
  }
});

const resetPassword = asyncHandler(async (req, res) => {
  try {
    const { token, password } = req.body;
    const data = await AuthService.resetPassword({ token, password });
    return sendSuccess(res, 200, data.message);
  } catch (error) {
    console.error('Reset Password Error:', error);
    return sendError(res, error.statusCode || 500, error.message || 'Failed to reset password');
  }
});


// -------------------- (your existing functions stay unchanged) --------------------

// Check if account exists by email or phone
const checkUser = asyncHandler(async (req, res) => {
  try {
    const { identifier } = req.body;
    const raw = (identifier || '').toString().trim();

    if (!raw) {
      return sendValidationError(res, 'Identifier (email or phone) is required');
    }

    const isEmail = raw.includes('@');

    let user;
    if (isEmail) {
      user = await UserService.findByEmail(raw.toLowerCase());
    } else {
      const normalizedPhone = normalizePhone(raw);
      if (!normalizedPhone) {
        return sendValidationError(res, 'Invalid phone number format');
      }
      user = await UserService.findByPhone(normalizedPhone);
    }

    return sendSuccess(res, 200, 'Check complete', {
      exists: !!user,
      type: isEmail ? 'email' : 'phone',
    });
  } catch (error) {
    console.error('Check User Error:', error);
    return sendError(res, 500, error.message || 'Failed to check user');
  }
});


const loginUser = asyncHandler(async (req, res) => {
  try {
    const { identifier, email, phone, password } = req.body;

    // Accept identifier, or legacy email/phone fields
    const raw = (identifier || email || phone || '').toString().trim();

    if (!raw || !password) {
      return sendValidationError(res, 'Identifier (email or phone) and password are required');
    }

    // Detect type: if it contains @ → email, otherwise treat as phone
    const isEmail = raw.includes('@');

    let user;
    if (isEmail) {
      user = await UserService.findByEmail(raw.toLowerCase());
    } else {
      const normalizedPhone = normalizePhone(raw);
      if (!normalizedPhone) {
        return sendValidationError(res, 'Invalid phone number format');
      }
      user = await UserService.findByPhone(normalizedPhone);
    }

    if (!user) {
      return sendUnauthorized(res, 'Invalid credentials');
    }

    if (!user.password) {
      return sendUnauthorized(res, 'Password login is not configured for this account');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return sendUnauthorized(res, 'Invalid credentials');
    }

    const token = generateToken(user._id, user.role);
    const userData = UserService.formatUser(user);

    return sendSuccess(res, 200, 'Login successful', { token, user: userData });
  } catch (error) {
    console.error('Login Error:', error);
    return sendError(res, 500, error.message || 'Login failed');
  }
});

// Update driver profile (unchanged)
const updateDriverProfile = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { ssn, vehicleTypes } = req.body;
    const licenseImage = req.files?.licenseImage?.[0];
    const vehicleImage = req.files?.vehicleImage?.[0];
    const updateData = {};

    if (ssn) updateData['driver.ssn'] = ssn;

    if (vehicleTypes) {
      const mongoose = require('mongoose');
      updateData['driver.vehicleTypes'] = Array.isArray(vehicleTypes)
        ? vehicleTypes.map((v) => new mongoose.Types.ObjectId(v))
        : [new mongoose.Types.ObjectId(vehicleTypes)];
    }

    if (licenseImage) {
      updateData['driver.licenseImage'] = `/uploads/${licenseImage.filename}`;
    }

    if (vehicleImage) {
      updateData['driver.vehicleImage'] = `/uploads/${vehicleImage.filename}`;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    );

    if (!user) return sendNotFound(res, 'User not found');

    return sendSuccess(res, 200, 'Driver profile updated successfully', user);
  } catch (error) {
    console.error('Update Profile Error:', error);
    return sendError(res, 500, error.message || 'Profile update failed');
  }
});

// Get profile (unchanged)
const getProfile = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return sendNotFound(res, 'User not found');
    return sendSuccess(res, 200, 'Profile retrieved successfully', user);
  } catch (error) {
    console.error('Get Profile Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve profile');
  }
});

module.exports = {
  signupStart,
  signupVerify,
  signupPasscode,
  signupComplete,
  forgotPassword,
  resetPassword,
  loginUser,
  updateDriverProfile,
  getProfile,
  checkUser,
};
