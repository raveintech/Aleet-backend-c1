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

const router = express.Router();

// ── Customer signup flow ──────────────────────────────────────────────────────
router.post("/signup/start", signupStart); // 1. Enter phone/email → send OTP
router.post("/signup/verify", signupVerify); // 2. Enter OTP code → get signupToken (or driverToken)
router.post("/signup/passcode", signupPasscode); // 3. Set password → get tempToken
router.post(
  "/signup/complete",
  uploadDriverDocuments,
  handleUploadError,
  signupComplete,
); // 4. Name + email → JWT

// ── Driver signup flow ────────────────────────────────────────────────────────
router.post("/driver/signup/start", driverSignupStart); // 1. name + phone + email + password → OTP
// Step 2 is shared: POST /signup/verify (returns driverToken for driver_signup purpose)
router.post(
  "/driver/signup/documents",
  uploadDriverDocuments,
  handleUploadError,
  driverSignupDocuments,
); // 3. ssn + vehicleTypes + images → docsToken
router.post(
  "/driver/signup/complete",
  uploadDriverComplete,
  handleUploadError,
  driverSignupComplete,
); // 4. license consent → JWT

router.post(
  "/driver/signup/verify-otp",
  verifyDriverSignupOTPController,
);

// ── Common ────────────────────────────────────────────────────────────────────
router.post("/password/forgot", forgotPassword);
router.post("/password/reset", resetPassword);
router.post("/login", loginUser);
router.post("/check-user", checkUser);

module.exports = router;
