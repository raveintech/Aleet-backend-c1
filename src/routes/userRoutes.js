const express = require('express');
const {
  updateDriverProfile,
  updateDriverContactInfo,
  getProfile,
  submitRevision,
  deleteAccount,
  updateMyRegions,
} = require('../controllers/userController');
const { uploadDriverDocuments, uploadAvatar, handleUploadError } = require('../utils/multer');
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
router.patch('/contact-info', authenticateJWT, uploadAvatar, handleUploadError, updateDriverContactInfo);
router.post('/submit-revision', authenticateJWT, submitRevision);
router.delete('/delete-account', authenticateJWT, deleteAccount);

// Driver self-service: update the regions this driver is willing to serve.
// Default-open semantics: empty regions + serveAllRegions=true means everywhere.
router.put('/me/regions', authenticateJWT, updateMyRegions);


module.exports = router;
