const express = require('express');
const {
  updateDriverProfile,
  getProfile,
  addEmailToAccount
} = require('../controllers/userController');
const { uploadDriverDocuments, handleUploadError } = require('../utils/multer');  // Import the Multer configuration
const authenticateJWT = require('../middleware/authMiddleware');
const router = express.Router();

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
