const express = require('express');
const { toggleDriverStatus, assignDriverToBooking, getAllDrivers, approveDriver, requestRevision, uploadAleetLicense } = require('../controllers/adminController');
const authenticateJWT = require('../middleware/authMiddleware');
const { uploadSingleForHireLicense, handleUploadError } = require('../utils/multer');
const router = express.Router();

router.patch('/toggleDriverStatus', authenticateJWT, toggleDriverStatus);
router.patch('/assignDriver', authenticateJWT, assignDriverToBooking);
router.get('/drivers', authenticateJWT, getAllDrivers);
router.patch('/drivers/approve', authenticateJWT, approveDriver);
router.patch('/drivers/request-revision', authenticateJWT, requestRevision);
router.post('/drivers/:id/aleet-license', authenticateJWT, uploadSingleForHireLicense, handleUploadError, uploadAleetLicense);

module.exports = router;
