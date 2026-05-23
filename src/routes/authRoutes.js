const express = require("express");
const {
  signupStart,
  signupVerify,
  signupPasscode,
  signupComplete,
  forgotPassword,
  resetPassword,
  loginUser,
  checkUser,
} = require("../controllers/userController");
const {
  driverSignupStart,
  driverSignupDocuments,
  driverSignupComplete,
  verifyDriverSignupOTPController,
} = require("../controllers/driverAuthController");
const {
  uploadDriverDocuments,
  uploadDriverComplete,
  handleUploadError,
  uploadNone,
} = require("../utils/multer");
const {
  otpStartLimiter,
  authAttemptLimiter,
  generalAuthLimiter,
} = require("../middleware/rateLimiters");

const router = express.Router();

// ── Customer signup flow ──────────────────────────────────────────────────────
router.post("/signup/start", otpStartLimiter, signupStart); // 1. Enter phone/email → send OTP
router.post("/signup/verify", authAttemptLimiter, signupVerify); // 2. Enter OTP code → get signupToken (or driverToken)
router.post("/signup/passcode", generalAuthLimiter, signupPasscode); // 3. Set password → get tempToken
router.post(
  "/signup/complete",
  generalAuthLimiter,
  uploadDriverDocuments,
  handleUploadError,
  signupComplete,
); // 4. Name + email → JWT

// ── Driver signup flow ────────────────────────────────────────────────────────
router.post("/driver/signup/start", otpStartLimiter, driverSignupStart); // 1. name + phone + email + password → OTP
// Step 2 is shared: POST /signup/verify (returns driverToken for driver_signup purpose)
router.post(
  "/driver/signup/documents",
  generalAuthLimiter,
  uploadDriverDocuments,
  handleUploadError,
  driverSignupDocuments,
); // 3. ssn + vehicleTypes + images → docsToken
router.post(
  "/driver/signup/complete",
  generalAuthLimiter,
  uploadDriverComplete,
  handleUploadError,
  driverSignupComplete,
); // 4. license consent → JWT

router.post(
  "/driver/signup/verify-otp",
  authAttemptLimiter,
  verifyDriverSignupOTPController,
);

// ── Common ────────────────────────────────────────────────────────────────────
router.post("/password/forgot", otpStartLimiter, forgotPassword);
router.post("/password/reset", authAttemptLimiter, resetPassword);
router.post("/login", authAttemptLimiter, loginUser);
router.post("/check-user", generalAuthLimiter, checkUser);

module.exports = router;
