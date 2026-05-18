// controllers/userController.js (snippet: ONLY registerUser shown updated)

const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const UserService = require('../services/userService');
const { resolveDriverTier } = require('../services/driverTierService');
const { normalizePhone } = require('../services/userService');
const AuthService = require('../services/authService');
const generateToken = require('../utils/generateToken');
const User = require('../models/User');
const { fileUrl } = require('../utils/multer');
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
    const { email, role, resetBaseUrl } = req.body;
    const data = await AuthService.forgotPassword({ email, role, resetBaseUrl });
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
    const { role } = req.body;
    const lookupRole = role || undefined;

    let user;
    if (isEmail) {
      user = await UserService.findByEmail(raw.toLowerCase(), lookupRole);
    } else {
      const normalizedPhone = normalizePhone(raw);
      if (!normalizedPhone) {
        return sendValidationError(res, 'Invalid phone number format');
      }
      user = await UserService.findByPhone(normalizedPhone, lookupRole);
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
    const { identifier, email, phone, password, expectedRole } = req.body;

    // Accept identifier, or legacy email/phone fields
    const raw = (identifier || email || phone || '').toString().trim();

    if (!raw || !password) {
      return sendValidationError(res, 'Identifier (email or phone) and password are required');
    }

    // Detect type: if it contains @ → email, otherwise treat as phone
    const isEmail = raw.includes('@');
    const lookupRole = expectedRole === 'driver' ? 'driver' : 'customer';

    let user;
    if (isEmail) {
      user = await UserService.findByEmail(raw.toLowerCase(), lookupRole);
      // driver login page is shared with admin — fallback to admin lookup
      if (!user && expectedRole === 'driver') {
        user = await UserService.findByEmail(raw.toLowerCase(), 'admin');
      }
    } else {
      const normalizedPhone = normalizePhone(raw);
      if (!normalizedPhone) {
        return sendValidationError(res, 'Invalid phone number format');
      }
      user = await UserService.findByPhone(normalizedPhone, lookupRole);
      if (!user && expectedRole === 'driver') {
        user = await UserService.findByPhone(normalizedPhone, 'admin');
      }
    }

    if (!user) {
      return sendUnauthorized(res, 'Invalid credentials');
    }

    // allowedRoles kept for safety, but lookup is already role-scoped
    const allowedRoles = expectedRole === 'driver' ? ['driver', 'admin'] : ['customer'];
    if (!allowedRoles.includes(user.role)) {
      const message = user.role === 'driver'
        ? 'This account is registered as a driver. Please use the driver app to sign in.'
        : expectedRole === 'driver'
          ? 'This account is not registered as a driver'
          : 'Invalid credentials';
      return sendUnauthorized(res, message);
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

    const driver = await User.findById(userId);
    if (!driver || driver.role !== 'driver') return sendNotFound(res, 'Driver not found');

    // Only allow updates in these statuses
    const editableStatuses = ['submitted', 'background_pending', 'background_completed', 'approved', 'needs_revision'];
    if (!editableStatuses.includes(driver.driver?.status)) {
      return sendError(res, 403, 'Profile editing is not available at your current onboarding stage');
    }

    const { ssn, vehicleTypes, hasForHireLicense, hasOwnVehicle } = req.body;
    const licenseImage = req.files?.licenseImage?.[0];
    const vehicleImage = req.files?.vehicleImage?.[0];
    const forHireLicenseImage = req.files?.forHireLicenseImage?.[0];
    const updateData = {};

    if (ssn) {
      const { validateSSN } = require('../utils/ssnValidator');
      const v = validateSSN(ssn);
      if (!v.valid) return sendValidationError(res, v.error);
      updateData['driver.ssn'] = ssn;
    }

    if (vehicleTypes) {
      const mongoose = require('mongoose');
      updateData['driver.vehicleTypes'] = Array.isArray(vehicleTypes)
        ? vehicleTypes.map((v) => new mongoose.Types.ObjectId(v))
        : [new mongoose.Types.ObjectId(vehicleTypes)];
    }

    if (hasForHireLicense !== undefined) {
      const parsedHasForHireLicense = hasForHireLicense === true || hasForHireLicense === 'true';
      updateData['driver.hasForHireLicense'] = parsedHasForHireLicense;
      // Clear license image when driver no longer has a For-Hire license
      if (!parsedHasForHireLicense) {
        updateData['driver.forHireLicenseImage'] = null;
      }
    }

    if (hasOwnVehicle !== undefined) {
      updateData['driver.hasOwnVehicle'] = hasOwnVehicle === true || hasOwnVehicle === 'true';
    }

    if (licenseImage) updateData['driver.licenseImage'] = fileUrl(licenseImage.filename);
    if (vehicleImage) updateData['driver.vehicleImage'] = fileUrl(vehicleImage.filename);
    if (forHireLicenseImage) updateData['driver.forHireLicenseImage'] = fileUrl(forHireLicenseImage.filename);

    // Recalculate tier based on effective vehicle/license values
    const effectiveHasOwnVehicle = 'driver.hasOwnVehicle' in updateData
      ? updateData['driver.hasOwnVehicle']
      : driver.driver?.hasOwnVehicle;
    const effectiveHasForHireLicense = 'driver.hasForHireLicense' in updateData
      ? updateData['driver.hasForHireLicense']
      : driver.driver?.hasForHireLicense;
    updateData['driver.tier'] = resolveDriverTier({ hasOwnVehicle: effectiveHasOwnVehicle, hasForHireLicense: effectiveHasForHireLicense });

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    );

    if (!user) return sendNotFound(res, 'User not found');

    return sendSuccess(res, 200, 'Driver profile updated successfully', UserService.formatUser(user));
  } catch (error) {
    // Log only message — request body can contain SSN
    console.error('Update Profile Error:', error?.message || 'unknown error');
    return sendError(res, 500, error.message || 'Profile update failed');
  }
});

// Get profile (unchanged)
const getProfile = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('+driver.ssn');
    if (!user) return sendNotFound(res, 'User not found');
    return sendSuccess(res, 200, 'Profile retrieved successfully', UserService.formatUser(user));
  } catch (error) {
    console.error('Get Profile Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve profile');
  }
});

const submitRevision = asyncHandler(async (req, res) => {
  try {
    const driver = await User.findById(req.user.id);
    if (!driver || driver.role !== 'driver') return sendNotFound(res, 'Driver not found');

    if (driver.driver?.status !== 'needs_revision') {
      return sendError(res, 403, 'Only drivers with needs_revision status can submit a revision');
    }

    driver.driver.status = 'revision_complete';
    driver.driver.revisionNotes = null;
    await driver.save();

    return sendSuccess(res, 200, 'Revision submitted successfully', UserService.formatUser(driver));
  } catch (error) {
    console.error('Submit Revision Error:', error);
    return sendError(res, 500, error.message || 'Failed to submit revision');
  }
});

const updateDriverContactInfo = asyncHandler(async (req, res) => {
  try {
    const driver = await User.findById(req.user.id);
    if (!driver || driver.role !== 'driver') return sendNotFound(res, 'Driver not found');

    const { name, email, phone } = req.body;
    const avatarFile = req.files?.avatar?.[0];

    if (!name && !email && !phone && !avatarFile) {
      return sendValidationError(res, 'Provide at least one field to update: name, email, phone, or avatar');
    }

    if (email && email !== driver.email) {
      const existing = await User.findOne({ email, role: 'driver', _id: { $ne: driver._id } });
      if (existing) return sendError(res, 409, 'Email is already in use by another driver');
      driver.email = email;
    }

    if (phone && phone !== driver.phone) {
      const normalizedPhone = normalizePhone(phone);
      const existing = await User.findOne({ phone: normalizedPhone, role: 'driver', _id: { $ne: driver._id } });
      if (existing) return sendError(res, 409, 'Phone number is already in use by another driver');
      driver.phone = normalizedPhone;
    }

    if (name) driver.name = name;
    if (avatarFile) driver.avatar = fileUrl(avatarFile.filename);

    await driver.save();

    return sendSuccess(res, 200, 'Contact info updated successfully', UserService.formatUser(driver));
  } catch (error) {
    console.error('Update Contact Info Error:', error);
    return sendError(res, 500, error.message || 'Failed to update contact info');
  }
});

const deleteAccount = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) return sendNotFound(res, 'User not found');

    // Drivers with active bookings should not be silently deleted
    if (user.role === 'driver' && user.driver?.status === 'approved') {
      const Booking = require('../models/Booking');
      const activeBooking = await Booking.findOne({
        assignedDriver: userId,
        status: { $in: ['Pending', 'Confirmed', 'In Progress'] },
      });
      if (activeBooking) {
        return sendError(res, 409, 'Cannot delete account while you have active bookings');
      }
    }

    await User.findByIdAndDelete(userId);

    return sendSuccess(res, 200, 'Account deleted successfully');
  } catch (error) {
    console.error('Delete Account Error:', error);
    return sendError(res, 500, error.message || 'Failed to delete account');
  }
});

// -------------------- DRIVER: UPDATE OWN SERVICE REGIONS --------------------
const mongooseLib = require('mongoose');
const updateMyRegions = asyncHandler(async (req, res) => {
  try {
    const { regions, serveAllRegions } = req.body;
    if (!Array.isArray(regions)) {
      return sendValidationError(res, '`regions` must be an array of region IDs');
    }
    const cleanIds = regions.filter((id) => mongooseLib.Types.ObjectId.isValid(id));
    const allFlag = serveAllRegions === undefined ? cleanIds.length === 0 : !!serveAllRegions;

    const user = await User.findById(req.user.id);
    if (!user) return sendNotFound(res, 'User not found');
    if (user.role !== 'driver') {
      return sendValidationError(res, 'Only drivers can set service regions');
    }

    user.driver = user.driver || {};
    user.driver.regions = cleanIds;
    user.driver.serveAllRegions = allFlag;
    await user.save();

    return sendSuccess(res, 200, 'Service regions updated', {
      regions: user.driver.regions,
      serveAllRegions: user.driver.serveAllRegions,
    });
  } catch (error) {
    console.error('Update My Regions Error:', error);
    return sendError(res, 500, error.message || 'Failed to update regions');
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
  updateDriverContactInfo,
  getProfile,
  submitRevision,
  checkUser,
  deleteAccount,
  updateMyRegions,
};
