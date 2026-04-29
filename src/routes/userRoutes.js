const express = require('express');
const {
  updateDriverProfile,
  updateDriverContactInfo,
  getProfile,
  submitRevision,
  deleteAccount,
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
router.patch('/contact-info', authenticateJWT, updateDriverContactInfo);
router.post('/submit-revision', authenticateJWT, submitRevision);
router.delete('/delete-account', authenticateJWT, deleteAccount);


module.exports = router;
