const express = require('express');
const {
  registerUser,
  signupStart,
  signupVerify,
  signupComplete,
  forgotPassword,
  resetPassword,
  loginUser,
  sendOTPForAuth,
  verifyOTPAndAuth,
  loginWithPhone,
} = require('../controllers/userController');
const { uploadDriverDocuments, handleUploadError } = require('../utils/multer');

const router = express.Router();

// Legacy signup endpoint (kept for backward compatibility)
router.post('/signup', uploadDriverDocuments, handleUploadError, registerUser);

// New phase-1 auth flow
router.post('/signup/start', signupStart);
router.post('/signup/verify', signupVerify);
router.post('/signup/complete', uploadDriverDocuments, handleUploadError, signupComplete);

router.post('/password/forgot', forgotPassword);
router.post('/password/reset', resetPassword);

// Login endpoints
router.post('/login', loginUser);

// Legacy OTP endpoints (kept for backward compatibility)
router.post('/send-otp', sendOTPForAuth);
router.post('/verify-otp', verifyOTPAndAuth);
router.post('/login-phone', loginWithPhone);

module.exports = router;
