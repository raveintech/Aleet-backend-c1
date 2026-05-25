const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const OTPVerification = require("../models/OTPVerification");
const UserService = require("./userService");
const { normalizePhone } = UserService;
const Checkr = require("./checkrService");
const { generateOTP, sendOTP } = require("./twilioService");
const {
  sendPasswordResetEmail,
  sendVerificationCodeEmail,
} = require("./emailService");

const { fileUrl } = require("../utils/multer");
const { resolveDriverTier } = require("./driverTierService");
const { validateSSN } = require("../utils/ssnValidator");

const PhoneOTP = require("../models/PhoneOTP");
// const { generateOTP, sendOTP } = require('./twilioService');

class AuthServiceError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "AuthServiceError";
    this.statusCode = statusCode;
  }
}

const parseArrayInput = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
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
  const role = body.role || "customer";

  if (role === "driver") {
    const vehicleTypes = parseArrayInput(body.vehicleTypes).filter(Boolean);
    if (!vehicleTypes.length) {
      throw new AuthServiceError(
        "At least one vehicle type must be selected for drivers",
        400,
      );
    }
  }
};

const normalizeRegistrationError = (error) => {
  const message = error?.message || "Registration failed";
  if (
    message.includes("already exists") ||
    message.includes("E11000") ||
    message.includes("duplicate key")
  ) {
    return new AuthServiceError(message, 409);
  }
  if (message.includes("required")) {
    return new AuthServiceError(message, 400);
  }
  return error;
};

const autoInviteDriverToCheckr = async (userId) => {
  const fullUser = await User.findById(userId);
  if (!fullUser) {
    throw new AuthServiceError("User not found after registration", 404);
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
    status: "invited",
    lastEvent: "invitation.created",
    lastEventAt: new Date(),
  };

  const dash =
    process.env.CHECKR_DASHBOARD_BASE || "https://dashboard.checkr.com";
  fullUser.driver.checkr.dashboardUrl = inv.report_id
    ? `${dash}/reports/${inv.report_id}`
    : `${dash}/candidates/${candidateId}`;

  fullUser.driver.status = "background_pending";

  await fullUser.save();
};

const registerUser = async (body, files) => {
  try {
    validateRegistrationInput(body);
    const user = await UserService.register(body, files);

    if (user.role !== "driver" || !user.email) {
      return user;
    }

    try {
      await autoInviteDriverToCheckr(user._id);
    } catch (error) {
      console.error(
        "Checkr auto-invite failed:",
        error?.response?.data || error.message,
      );
    }

    return user;
  } catch (error) {
    throw normalizeRegistrationError(error);
  }
};

const isValidEmail = (email) =>
  typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();

const startSignup = async ({ identifier, name, role = "customer" }) => {
  const raw = String(identifier || "").trim();
  if (!raw) {
    throw new AuthServiceError("Phone number or email is required", 400);
  }

  const normalizedRole = role || "customer";
  const isEmail = raw.includes("@");

  if (isEmail) {
    // ── EMAIL FLOW ──────────────────────────────────────────────────────────
    const normalizedEmail = normalizeEmail(raw);
    if (!isValidEmail(normalizedEmail)) {
      throw new AuthServiceError("Invalid email address", 400);
    }

    const existingUser = await User.findOne({
      email: normalizedEmail,
      role: normalizedRole,
    }).lean();
    if (existingUser) {
      throw new AuthServiceError(
        "An account with this email already exists",
        409,
      );
    }

    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OTPVerification.deleteMany({
      email: normalizedEmail,
      purpose: "signup",
    });
    await OTPVerification.create({
      purpose: "signup",
      email: normalizedEmail,
      code: otpCode,
      expiresAt,
      attempts: 0,
      verified: false,
      payload: { name: name || null, role: normalizedRole },
    });

    try {
      await sendVerificationCodeEmail(normalizedEmail, otpCode);
    } catch (error) {
      await OTPVerification.deleteMany({
        email: normalizedEmail,
        purpose: "signup",
      });
      throw new AuthServiceError(
        error.message || "Failed to send verification code",
        502,
      );
    }

    return {
      identifier: normalizedEmail,
      identifierType: "email",
      expiresIn: "10 minutes",
    };
  } else {
    // ── PHONE FLOW ───────────────────────────────────────────────────────────
    const normalizedPhone = normalizePhone(raw);
    if (!normalizedPhone) {
      throw new AuthServiceError("Invalid phone number", 400);
    }

    const existingUser = await User.findOne({
      phone: normalizedPhone,
      role: normalizedRole,
    }).lean();
    if (existingUser) {
      throw new AuthServiceError(
        "An account with this phone number already exists",
        409,
      );
    }

    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await OTPVerification.deleteMany({
      phone: normalizedPhone,
      purpose: "signup",
    });
    await OTPVerification.create({
      purpose: "signup",
      phone: normalizedPhone,
      code: otpCode,
      expiresAt,
      attempts: 0,
      verified: false,
      payload: { name: name || null, role: normalizedRole },
    });

    try {
      await sendOTP(normalizedPhone, otpCode);
    } catch (error) {
      await OTPVerification.deleteMany({
        phone: normalizedPhone,
        purpose: "signup",
      });
      throw new AuthServiceError(error.message || "Failed to send OTP", 502);
    }

    return {
      identifier: normalizedPhone,
      identifierType: "phone",
      expiresIn: "5 minutes",
    };
  }
};

const verifySignupOtp = async ({ identifier, code }) => {
  const raw = String(identifier || "").trim();
  const normalizedCode = String(code || "").trim();

  if (!raw || !normalizedCode) {
    throw new AuthServiceError("Identifier and OTP code are required", 400);
  }

  const isEmail = raw.includes("@");
  const lookupField = isEmail
    ? { email: normalizeEmail(raw) }
    : { phone: normalizePhone(raw) };

  const otpRecord = await OTPVerification.findOne({
    ...lookupField,
    purpose: { $in: ["signup", "driver_signup"] },
    verified: false,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!otpRecord) {
    throw new AuthServiceError("Invalid or expired OTP", 401);
  }

  if (otpRecord.attempts >= 3) {
    await OTPVerification.deleteOne({ _id: otpRecord._id });
    throw new AuthServiceError(
      "Too many failed attempts. Please request a new OTP.",
      401,
    );
  }

  if (otpRecord.code !== normalizedCode) {
    otpRecord.attempts += 1;
    await otpRecord.save();
    throw new AuthServiceError("Invalid or expired OTP", 401);
  }

  otpRecord.verified = true;
  await otpRecord.save();

  const isDriverFlow = otpRecord.purpose === "driver_signup";

  if (isDriverFlow) {
    // Driver flow — embed all data into a short-lived token for step 3
    const driverToken = jwt.sign(
      {
        type: "driver_signup_verified",
        phone: lookupField.phone,
        email: otpRecord.payload?.email || null,
        name: otpRecord.payload?.name || null,
        hashedPassword: otpRecord.payload?.hashedPassword || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30m" },
    );
    return { driverToken, identifierType: "phone" };
  }

  const signupToken = jwt.sign(
    {
      type: "signup_complete",
      identifierType: isEmail ? "email" : "phone",
      phone: isEmail ? null : lookupField.phone,
      email: isEmail ? lookupField.email : otpRecord.payload?.email || null,
      name: otpRecord.payload?.name || null,
      role: otpRecord.payload?.role || "customer",
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );

  return { signupToken, identifierType: isEmail ? "email" : "phone" };
};

const setPasscode = async ({ signupToken, password }) => {
  if (!signupToken) {
    throw new AuthServiceError("signupToken is required", 400);
  }
  if (!password || String(password).length < 6) {
    throw new AuthServiceError("Password must be at least 6 characters", 400);
  }

  let decoded;
  try {
    decoded = jwt.verify(signupToken, process.env.JWT_SECRET);
  } catch {
    throw new AuthServiceError("Invalid or expired signup token", 401);
  }

  if (decoded.type !== "signup_complete") {
    throw new AuthServiceError("Invalid token type", 401);
  }

  // Embed hashed password into the next-step token so we never store plaintext
  const bcrypt = require("bcryptjs");
  const hashedPassword = await bcrypt.hash(password, 10);

  const tempToken = jwt.sign(
    {
      type: "signup_passcode_set",
      identifierType: decoded.identifierType,
      phone: decoded.phone || null,
      email: decoded.email || null,
      role: decoded.role || "customer",
      hashedPassword,
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );

  return { tempToken };
};

const completeSignup = async ({ tempToken, name, email, profile = {} }) => {
  if (!tempToken) {
    throw new AuthServiceError("tempToken is required", 400);
  }

  let decoded;
  try {
    decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
  } catch {
    throw new AuthServiceError("Invalid or expired token", 401);
  }

  if (decoded.type !== "signup_passcode_set") {
    throw new AuthServiceError("Invalid token type", 401);
  }

  // Phone-flow: email is required for account recovery
  let resolvedEmail = decoded.email;
  if (decoded.identifierType === "phone") {
    const normalizedEmail = normalizeEmail(email || "");
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      throw new AuthServiceError("Valid email is required", 400);
    }
    const conflict = await User.findOne({
      email: normalizedEmail,
      role: decoded.role || "customer",
    }).lean();
    if (conflict) {
      throw new AuthServiceError(
        "An account with this email already exists",
        409,
      );
    }
    resolvedEmail = normalizedEmail;
  }

  const resolvedName = String(name || "").trim();
  if (!resolvedName) {
    throw new AuthServiceError("Name is required", 400);
  }

  const body = {
    name: resolvedName,
    email: resolvedEmail,
    phone: decoded.phone,
    password: null,
    role: decoded.role || "customer",
    vehicleTypes: profile.vehicleTypes,
    permissions: profile.permissions,
    ssn: profile.ssn,
  };

  validateRegistrationInput(body);

  let user = await registerUser(body, profile.files);

  await User.findByIdAndUpdate(user._id, {
    $set: {
      password: decoded.hashedPassword,
      isPhoneVerified: decoded.identifierType === "phone",
      isEmailVerified: decoded.identifierType === "email",
    },
  });

  user = await User.findById(user._id);
  return UserService.formatUser(user);
};

const forgotPassword = async ({ email, role, resetBaseUrl }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    throw new AuthServiceError("Valid email is required", 400);
  }

  const query = { email: normalizedEmail };
  if (role) query.role = role;
  const user = await User.findOne(query);

  if (!user) {
    return {
      message: "If this email exists, a password reset link has been sent.",
    };
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = expiresAt;
  await user.save();

  const baseUrl = resetBaseUrl;
  const resetLink = baseUrl
    ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}token=${rawToken}`
    : `reset-token://${rawToken}`;

  await sendPasswordResetEmail(user.email, resetLink);

  return {
    message: "If this email exists, a password reset link has been sent.",
  };
};

const resetPassword = async ({ token, password }) => {
  if (!token) {
    throw new AuthServiceError("Reset token is required", 400);
  }
  if (!password || String(password).length < 8) {
    throw new AuthServiceError("Password must be at least 8 characters", 400);
  }

  const hashedToken = crypto
    .createHash("sha256")
    .update(String(token))
    .digest("hex");
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  });

  if (!user) {
    throw new AuthServiceError("Invalid or expired reset token", 401);
  }

  user.password = password;
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  await user.save();

  return { message: "Password reset successful" };
};

const driverSignupStart = async ({ name, phone, email, password }) => {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);

  const [phoneConflict, emailConflict] = await Promise.all([
    User.findOne({ phone: normalizedPhone, role: "driver" }).lean(),
    User.findOne({ email: normalizedEmail, role: "driver" }).lean(),
  ]);
  if (phoneConflict)
    throw new AuthServiceError(
      "An account with this phone already exists",
      409,
    );
  if (emailConflict) {
    throw new AuthServiceError(
      "An account with this email already exists",
      409,
    );
  }

  const hashedPassword = await bcrypt.hash(String(password), 10);

  // Drivers are verified through document review + background check, not SMS.
  // Issue the driverToken directly so the next step is the documents upload.
  const driverToken = jwt.sign(
    {
      type: "driver_signup_verified",
      phone: normalizedPhone,
      email: normalizedEmail,
      name: String(name).trim(),
      hashedPassword,
    },
    process.env.JWT_SECRET,
    { expiresIn: "30m" },
  );

  return { driverToken };
};

const driverSignupDocuments = async ({
  driverToken,
  ssn,
  vehicleTypes,
  hasOwnVehicle,
  hasForHireLicense,
  files,
}) => {
  if (!driverToken) throw new AuthServiceError("driverToken is required", 400);

  const ownVehicle = hasOwnVehicle === true || hasOwnVehicle === "true";
  const forHireLicense =
    hasForHireLicense === true || hasForHireLicense === "true";

  // SSN required only if no for-hire license
  if (!forHireLicense && !ssn) {
    throw new AuthServiceError(
      "SSN is required when you do not have a for-hire license",
      400,
    );
  }
  if (ssn) {
    const v = validateSSN(ssn);
    if (!v.valid) throw new AuthServiceError(v.error, 400);
  }

  // vehicleTypes required only if driver has own vehicle
  let parsedVehicleTypes = [];
  if (ownVehicle) {
    parsedVehicleTypes = parseArrayInput(vehicleTypes).filter(Boolean);
    if (!parsedVehicleTypes.length) {
      throw new AuthServiceError(
        "At least one vehicle type is required when you have your own vehicle",
        400,
      );
    }
  }

  let decoded;
  try {
    decoded = jwt.verify(driverToken, process.env.JWT_SECRET);
  } catch {
    throw new AuthServiceError("Invalid or expired token", 401);
  }
  if (decoded.type !== "driver_signup_verified") {
    throw new AuthServiceError("Invalid token type", 401);
  }

  const licenseImage = files?.licenseImage?.[0];
  const vehicleImage = files?.vehicleImage?.[0];
  const forHireLicenseImage = files?.forHireLicenseImage?.[0];

  if (!licenseImage)
    throw new AuthServiceError("License image is required", 400);

  // vehicleImage required only if has own vehicle
  if (ownVehicle && !vehicleImage) {
    throw new AuthServiceError(
      "Vehicle image is required when you have your own vehicle",
      400,
    );
  }

  // forHireLicenseImage required only if has for-hire license
  if (forHireLicense && !forHireLicenseImage) {
    throw new AuthServiceError(
      "For-hire license image is required when you have a for-hire license",
      400,
    );
  }

  const docsToken = jwt.sign(
    {
      type: "driver_signup_docs",
      phone: decoded.phone,
      email: decoded.email,
      name: decoded.name,
      hashedPassword: decoded.hashedPassword,
      ssn: forHireLicense ? null : ssn,
      vehicleTypes: parsedVehicleTypes,
      hasOwnVehicle: ownVehicle,
      hasForHireLicense: forHireLicense,
      licenseImage: fileUrl(licenseImage.filename),
      ...(vehicleImage && { vehicleImage: fileUrl(vehicleImage.filename) }),
      ...(forHireLicenseImage && {
        forHireLicenseImage: fileUrl(forHireLicenseImage.filename),
      }),
    },
    process.env.JWT_SECRET,
    { expiresIn: "30m" },
  );

  return { docsToken };
};

const driverSignupComplete = async ({
  docsToken,
  authorizeBackgroundCheck,
  files,
}) => {
  if (!docsToken) {
    throw new AuthServiceError("docsToken is required", 400);
  }

  let decoded;

  try {
    decoded = jwt.verify(docsToken, process.env.JWT_SECRET);
  } catch (err) {
    throw new AuthServiceError("Invalid or expired token", 401);
  }

  if (!decoded || decoded.type !== "driver_signup_docs") {
    throw new AuthServiceError("Invalid token type", 401);
  }

  // 🧠 SAFE FALLBACKS (IMPORTANT FIX)
  const hasOwnVehicle = !!decoded.hasOwnVehicle;
  const hasForHireLicense = !!decoded.hasForHireLicense;

  const mongoose = require("mongoose");

  const vehicleTypeIds = (decoded.vehicleTypes || []).map(
    (v) => new mongoose.Types.ObjectId(v),
  );

  const user = new User({
    name: decoded.name,
    email: decoded.email,
    phone: decoded.phone,
    password: null,
    role: "driver",
    isPhoneVerified: true,
    driver: {
      ssn: decoded.ssn || null,
      vehicleTypes: vehicleTypeIds,
      licenseImage: decoded.licenseImage,
      vehicleImage: decoded.vehicleImage || null,
      hasForHireLicense,
      hasOwnVehicle,
      forHireLicenseImage: decoded.forHireLicenseImage || null,
      authorizeBackgroundCheck: Boolean(authorizeBackgroundCheck),
      status: "submitted",
      tier: resolveDriverTier({
        hasOwnVehicle,
        hasForHireLicense,
      }),
    },
  });

  const saved = await user.save();

  await User.findByIdAndUpdate(saved._id, {
    $set: { password: decoded.hashedPassword },
  });

  const savedUser = await User.findById(saved._id);

  autoInviteDriverToCheckr(savedUser._id).catch((err) =>
    console.error("Checkr auto-invite failed:", err?.message),
  );

  const UserService = require("./userService");
  return UserService.formatUser(savedUser);
};

module.exports = {
  registerUser,
  AuthServiceError,
  startSignup,
  verifySignupOtp,
  setPasscode,
  completeSignup,
  forgotPassword,
  resetPassword,
  driverSignupStart,
  driverSignupDocuments,
  driverSignupComplete,
};
