const express = require('express');
const { toggleDriverStatus, assignDriverToBooking, getAllDrivers, approveDriver, requestRevision, uploadAleetLicense, getDriverLicensing, getSidebarStats } = require('../controllers/adminController');
const { getDriverTierPerformance, getTierSettings, updateTierSettings } = require('../controllers/tierController');
const authenticateJWT = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/requireAdmin');
const { requirePermission } = require('../middleware/requireAdmin');
const { uploadSingleForHireLicense, handleUploadError } = require('../utils/multer');
const router = express.Router();

// Driver status & assignment
router.patch('/toggleDriverStatus', requireAdmin, requirePermission('manage-users'), toggleDriverStatus);
router.patch('/assignDriver', requireAdmin, requirePermission('manage-bookings'), assignDriverToBooking);

// Driver listing & licensing
router.get('/drivers', requireAdmin, requirePermission('manage-users'), getAllDrivers);
router.get('/drivers/licensing', requireAdmin, requirePermission('manage-users'), getDriverLicensing);

// Driver approval actions
router.patch('/drivers/approve', requireAdmin, requirePermission('manage-users'), approveDriver);
router.patch('/drivers/request-revision', requireAdmin, requirePermission('manage-users'), requestRevision);

// Aleet license upload (authenticated user — driver uploads their own)
router.post('/drivers/:id/aleet-license', authenticateJWT, uploadSingleForHireLicense, handleUploadError, uploadAleetLicense);

// Sidebar stats
router.get('/sidebar-stats', requireAdmin, requirePermission('view-reports'), getSidebarStats);

// Tier performance & settings
router.get('/tiers/performance', requireAdmin, requirePermission('view-reports'), getDriverTierPerformance);
router.get('/tiers/settings', requireAdmin, requirePermission('view-reports'), getTierSettings);
router.patch('/tiers/settings', requireAdmin, requirePermission('manage-users'), updateTierSettings);

module.exports = router;
