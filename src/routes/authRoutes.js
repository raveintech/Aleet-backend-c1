const express = require('express');
const {
  signupStart,
  signupVerify,
  signupPasscode,
  signupComplete,
  forgotPassword,
  resetPassword,
  loginUser,
  checkUser,
} = require('../controllers/userController');
const { uploadDriverDocuments, handleUploadError } = require('../utils/multer');

const router = express.Router();

router.post('/signup/start', signupStart);        // 1. Enter phone/email → send OTP
router.post('/signup/verify', signupVerify);      // 2. Enter OTP code → get signupToken
router.post('/signup/passcode', signupPasscode);  // 3. Set password → get tempToken
router.post('/signup/complete', uploadDriverDocuments, handleUploadError, signupComplete); // 4. Name + email → JWT

router.post('/password/forgot', forgotPassword);
router.post('/password/reset', resetPassword);

router.post('/login', loginUser);
router.post('/check-user', checkUser);

module.exports = router;
