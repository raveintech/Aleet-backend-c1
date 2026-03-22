// controllers/userController.js (snippet: ONLY registerUser shown updated)

const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const UserService = require('../services/userService');
const AuthService = require('../services/authService');
const generateToken = require('../utils/generateToken');
const User = require('../models/User');
const OTPVerification = require('../models/OTPVerification');
const { generateOTP, sendOTP, sendWelcomeSMS } = require('../services/twilioService');
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


// -------------------- (your existing functions stay unchanged) --------------------

// Login (unchanged)
const loginUser = asyncHandler(async (req, res) => {
  try {
    const { email, phone, identifier, password } = req.body;
    const loginIdentifier = identifier || email || phone;

    if (!loginIdentifier || !password) {
      return sendValidationError(res, 'Identifier (email or phone) and password are required');
    }

    const isPhoneLogin = /^\+?\d[\d\s\-()]{6,}$/.test(String(loginIdentifier));
    const user = isPhoneLogin
      ? await UserService.findByPhone(String(loginIdentifier).trim())
      : await UserService.findByEmail(String(loginIdentifier).trim().toLowerCase());

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

// -------------------- PHONE-BASED AUTHENTICATION --------------------

// Send OTP for signup/login
const sendOTPForAuth = asyncHandler(async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return sendValidationError(res, 'Phone number is required');
    }

    // Generate 6-digit OTP
    const otpCode = generateOTP();
    
    // Set expiration time (5 minutes from now)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Delete any existing OTP for this phone number
    await OTPVerification.deleteMany({ phone });

    // Save new OTP
    const otpVerification = new OTPVerification({
      phone,
      code: otpCode,
      expiresAt
    });

    await otpVerification.save();

    // Send OTP via SMS
    await sendOTP(phone, otpCode);

    return sendSuccess(res, 200, 'OTP sent successfully', {
      phone,
      expiresIn: '5 minutes'
    });
  } catch (error) {
    console.error('Send OTP Error:', error);
    return sendError(res, 500, error.message || 'Failed to send OTP');
  }
});

// Verify OTP and complete signup/login
const verifyOTPAndAuth = asyncHandler(async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return sendValidationError(res, 'Phone number and OTP code are required');
    }

    // Find the OTP verification record
    const otpRecord = await OTPVerification.findOne({
      phone,
      code,
      verified: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpRecord) {
      return sendUnauthorized(res, 'Invalid or expired OTP');
    }

    // Check attempt limit (max 3 attempts)
    if (otpRecord.attempts >= 3) {
      await OTPVerification.deleteOne({ _id: otpRecord._id });
      return sendUnauthorized(res, 'Too many failed attempts. Please request a new OTP.');
    }

    // Increment attempts
    otpRecord.attempts += 1;
    await otpRecord.save();

    // Check if user exists
    let user = await UserService.findByPhone(phone);
    let isNewUser = false;

    if (!user) {
      // Create new user
      isNewUser = true;
      const newUserData = {
        phone,
        role: 'customer', // Default role
        isPhoneVerified: true
      };

      user = await UserService.register(newUserData);
      
      // Send welcome SMS for new users
      try {
        await sendWelcomeSMS(phone, user.name || 'User');
      } catch (welcomeError) {
        console.error('Welcome SMS failed:', welcomeError);
        // Don't fail the registration for welcome SMS error
      }
    } else {
      // Update existing user's phone verification status
      await UserService.updatePhoneVerification(phone, true);
    }

    // Mark OTP as verified
    otpRecord.verified = true;
    await otpRecord.save();

    // Generate JWT token
    const token = generateToken(user._id, user.role);
    const userData = UserService.formatUser(user);

    return sendSuccess(res, 200, isNewUser ? 'Account created and verified successfully' : 'Login successful', {
      token,
      user: userData,
      isNewUser
    });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    return sendError(res, 500, error.message || 'OTP verification failed');
  }
});

// Add email to existing account (optional)
const addEmailToAccount = asyncHandler(async (req, res) => {
  try {
    const { email } = req.body;
    const userId = req.user.id;

    if (!email) {
      return sendValidationError(res, 'Email is required');
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email, _id: { $ne: userId } });
    if (existingUser) {
      return sendError(res, 400, 'Email already exists');
    }

    // Update user with email
    const user = await User.findByIdAndUpdate(
      userId,
      { email },
      { new: true }
    );

    if (!user) {
      return sendNotFound(res, 'User not found');
    }

    const userData = UserService.formatUser(user);
    return sendSuccess(res, 200, 'Email added successfully', userData);
  } catch (error) {
    console.error('Add Email Error:', error);
    return sendError(res, 500, error.message || 'Failed to add email');
  }
});

// Phone-based login (alternative to OTP verification)
const loginWithPhone = asyncHandler(async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return sendValidationError(res, 'Phone number and password are required');
    }

    const user = await UserService.findByPhone(phone);
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

    // Generate JWT token
    const token = generateToken(user._id, user.role);
    const userData = UserService.formatUser(user);

    return sendSuccess(res, 200, 'Login successful', {
      token,
      user: userData
    });
  } catch (error) {
    console.error('Phone Login Error:', error);
    return sendError(res, 500, error.message || 'Login failed');
  }
});

module.exports = {
  registerUser,
  loginUser,
  updateDriverProfile,
  getProfile,
  sendOTPForAuth,
  verifyOTPAndAuth,
  addEmailToAccount,
  loginWithPhone,
};
