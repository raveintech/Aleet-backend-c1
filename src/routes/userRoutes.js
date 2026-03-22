const express = require('express');
const { 
  registerUser, 
  loginUser, 
  updateDriverProfile, 
  getProfile,
  sendOTPForAuth,
  verifyOTPAndAuth,
  addEmailToAccount,
  loginWithPhone
} = require('../controllers/userController');
const { uploadDriverDocuments, handleUploadError } = require('../utils/multer');  // Import the Multer configuration
const authenticateJWT = require('../middleware/authMiddleware');
const router = express.Router();

// Public Route for User Signup
router.post('/signup', uploadDriverDocuments, handleUploadError, registerUser);

// Public Route for User Login
router.post('/login', loginUser);

// -------------------- PHONE-BASED AUTHENTICATION ROUTES --------------------

// Send OTP for phone-based signup/login
router.post('/send-otp', sendOTPForAuth);

// Verify OTP and complete signup/login
router.post('/verify-otp', verifyOTPAndAuth);

// Phone-based login (for already verified users)
router.post('/login-phone', loginWithPhone);

// -------------------- PROTECTED ROUTES --------------------

// Add email to existing account (optional)
router.post('/add-email', authenticateJWT, addEmailToAccount);

router.put(
  '/update-profile',
  authenticateJWT,
  uploadDriverDocuments,
  handleUploadError,
  updateDriverProfile
);

router.get("/profile", authenticateJWT, getProfile);


module.exports = router;
