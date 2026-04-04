const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OTPVerification = require('../models/OTPVerification');
const UserService = require('./userService');
const Checkr = require('./checkrService');
const { generateOTP, sendOTP } = require('./twilioService');
const { sendPasswordResetEmail } = require('./emailService');

class AuthServiceError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AuthServiceError';
    this.statusCode = statusCode;
  }
}

const parseArrayInput = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [value];
    }
  }
  return [];
};

const validateRegistrationInput = (body = {}) => {
  const role = body.role || 'customer';

  if (role === 'driver') {
    const vehicleTypes = parseArrayInput(body.vehicleTypes).filter(Boolean);
    if (!vehicleTypes.length) {
      throw new AuthServiceError(
        'At least one vehicle type must be selected for drivers',
        400
      );
    }
  }
};

const normalizeRegistrationError = (error) => {
  const message = error?.message || 'Registration failed';
  if (
    message.includes('already exists') ||
    message.includes('E11000') ||
    message.includes('duplicate key')
  ) {
    return new AuthServiceError(message, 409);
  }
  if (message.includes('required')) {
    return new AuthServiceError(message, 400);
  }
  return error;
};

const autoInviteDriverToCheckr = async (userId) => {
  const fullUser = await User.findById(userId);
  if (!fullUser) {
    throw new AuthServiceError('User not found after registration', 404);
  }

  let candidateId = fullUser.driver?.checkr?.candidateId;
  if (!candidateId) {
    const candidate = await Checkr.createCandidate(fullUser);
    candidateId = candidate.id;
    fullUser.driver.checkr = {
      ...(fullUser.driver?.checkr || {}),
      candidateId,
    };
  }

  const inv = await Checkr.createInvitation({
    candidateId,
    pkg: process.env.CHECKR_DEFAULT_PACKAGE,
    nodeId: process.env.CHECKR_NODE_ID,
    work: null,
  });

  fullUser.driver.checkr = {
    ...(fullUser.driver?.checkr || {}),
    invitationId: inv.id,
    reportId: inv.report_id || fullUser.driver?.checkr?.reportId || null,
    status: 'invited',
    lastEvent: 'invitation.created',
    lastEventAt: new Date(),
  };

  const dash = process.env.CHECKR_DASHBOARD_BASE || 'https://dashboard.checkr.com';
  fullUser.driver.checkr.dashboardUrl = inv.report_id
    ? `${dash}/reports/${inv.report_id}`
    : `${dash}/candidates/${candidateId}`;

  await fullUser.save();
};

const registerUser = async (body, files) => {
  try {
    validateRegistrationInput(body);
    const user = await UserService.register(body, files);

    if (user.role !== 'driver' || !user.email) {
      return user;
    }

    try {
      await autoInviteDriverToCheckr(user._id);
    } catch (error) {
      console.error('Checkr auto-invite failed:', error?.response?.data || error.message);
    }

    return user;
  } catch (error) {
    throw normalizeRegistrationError(error);
  }
};

const isValidEmail = (email) =>
  typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const normalizePhone = (phone) => String(phone || '').trim();
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const startSignup = async ({ phone, email, name, role = 'customer' }) => {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = role || 'customer';

  if (!normalizedPhone) {
    throw new AuthServiceError('Phone number is required', 400);
  }
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new AuthServiceError('Valid email is required', 400);
  }

  const existingUser = await User.findOne({
    $or: [{ phone: normalizedPhone }, { email: normalizedEmail }],
  }).lean();
  if (existingUser) {
    throw new AuthServiceError('User with this phone or email already exists', 409);
  }

  const otpCode = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await OTPVerification.deleteMany({ phone: normalizedPhone, purpose: 'signup' });
  await OTPVerification.create({
    purpose: 'signup',
    phone: normalizedPhone,
    code: otpCode,
    expiresAt,
    attempts: 0,
    verified: false,
    payload: {
      email: normalizedEmail,
      name: name || null,
      role: normalizedRole,
    },
  });

  try {
    await sendOTP(normalizedPhone, otpCode);
  } catch (error) {
    await OTPVerification.deleteMany({ phone: normalizedPhone, purpose: 'signup' });
    throw new AuthServiceError(error.message || 'Failed to send OTP', 502);
  }

  return {
    phone: normalizedPhone,
    expiresIn: '5 minutes',
  };
};

const verifySignupOtp = async ({ phone, code }) => {
  const normalizedPhone = normalizePhone(phone);
  const normalizedCode = String(code || '').trim();

  if (!normalizedPhone || !normalizedCode) {
    throw new AuthServiceError('Phone number and OTP code are required', 400);
  }

  const otpRecord = await OTPVerification.findOne({
    phone: normalizedPhone,
    purpose: 'signup',
    verified: false,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!otpRecord) {
    throw new AuthServiceError('Invalid or expired OTP', 401);
  }

  if (otpRecord.attempts >= 3) {
    await OTPVerification.deleteOne({ _id: otpRecord._id });
    throw new AuthServiceError('Too many failed attempts. Please request a new OTP.', 401);
  }

  if (otpRecord.code !== normalizedCode) {
    otpRecord.attempts += 1;
    await otpRecord.save();
    throw new AuthServiceError('Invalid or expired OTP', 401);
  }

  otpRecord.verified = true;
  await otpRecord.save();

  const signupToken = jwt.sign(
    {
      type: 'signup_complete',
      phone: otpRecord.phone,
      email: otpRecord.payload?.email || null,
      name: otpRecord.payload?.name || null,
      role: otpRecord.payload?.role || 'customer',
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  return { signupToken };
};

const completeSignup = async ({ signupToken, password, profile = {} }) => {
  if (!signupToken) {
    throw new AuthServiceError('signupToken is required', 400);
  }
  if (!password || String(password).length < 8) {
    throw new AuthServiceError('Password must be at least 8 characters', 400);
  }

  let decoded;
  try {
    decoded = jwt.verify(signupToken, process.env.JWT_SECRET);
  } catch {
    throw new AuthServiceError('Invalid or expired signup token', 401);
  }

  if (decoded.type !== 'signup_complete') {
    throw new AuthServiceError('Invalid signup token type', 401);
  }

  const body = {
    name: profile.name || decoded.name || '',
    email: decoded.email,
    phone: decoded.phone,
    password,
    role: profile.role || decoded.role || 'customer',
    vehicleTypes: profile.vehicleTypes,
    permissions: profile.permissions,
    ssn: profile.ssn,
  };

  validateRegistrationInput(body);

  let user = await registerUser(body, profile.files);
  await User.findByIdAndUpdate(user._id, { $set: { isPhoneVerified: true } });
  user = await User.findById(user._id);

  return UserService.formatUser(user);
};

const forgotPassword = async ({ email, resetBaseUrl }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new AuthServiceError('Valid email is required', 400);
  }

  const user = await User.findOne({ email: normalizedEmail });

  // Don't leak whether email exists
  if (!user) {
    return { message: 'If this email exists, a password reset link has been sent.' };
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = expiresAt;
  await user.save();

  const baseUrl = resetBaseUrl
  const resetLink = baseUrl
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}token=${rawToken}`
    : `reset-token://${rawToken}`;

  await sendPasswordResetEmail(user.email, resetLink);

  return { message: 'If this email exists, a password reset link has been sent.' };
};

const resetPassword = async ({ token, password }) => {
  if (!token) {
    throw new AuthServiceError('Reset token is required', 400);
  }
  if (!password || String(password).length < 8) {
    throw new AuthServiceError('Password must be at least 8 characters', 400);
  }

  const hashedToken = crypto.createHash('sha256').update(String(token)).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  });

  if (!user) {
    throw new AuthServiceError('Invalid or expired reset token', 401);
  }

  user.password = password;
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  await user.save();

  return { message: 'Password reset successful' };
};

module.exports = {
  registerUser,
  AuthServiceError,
  startSignup,
  verifySignupOtp,
  completeSignup,
  forgotPassword,
  resetPassword,
};
