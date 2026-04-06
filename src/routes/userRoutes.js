const express = require('express');
const {
  updateDriverProfile,
  getProfile,
} = require('../controllers/userController');
const { uploadDriverDocuments, handleUploadError } = require('../utils/multer');
const authenticateJWT = require('../middleware/authMiddleware');
const router = express.Router();

// -------------------- PROTECTED ROUTES --------------------

router.put(
  '/update-profile',
  authenticateJWT,
  uploadDriverDocuments,
  handleUploadError,
  updateDriverProfile
);

router.get("/profile", authenticateJWT, getProfile);


module.exports = router;
