const express = require('express');
const { toggleDriverStatus, assignDriverToBooking, getEligibleDriversForBooking, autoAssignDriverToBooking, redispatchBooking, unassignDriverFromBooking, getAllDrivers, approveDriver, requestRevision, uploadAleetLicense, updateDriverRegions, getDriverLicensing, getSidebarStats, getAdminDashboard } = require('../controllers/adminController');
const { getDriverTierPerformance, getTierSettings, updateTierSettings } = require('../controllers/tierController');
const authenticateJWT = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/requireAdmin');
const { requirePermission } = require('../middleware/requireAdmin');
const { uploadSingleForHireLicense, handleUploadError } = require('../utils/multer');
const router = express.Router();

// Driver status & assignment
router.patch('/toggleDriverStatus', requireAdmin, requirePermission('manage-users'), toggleDriverStatus);
router.patch('/assignDriver', requireAdmin, requirePermission('manage-bookings'), assignDriverToBooking);
router.get('/bookings/:id/eligible-drivers', requireAdmin, requirePermission('manage-bookings'), getEligibleDriversForBooking);
router.post('/bookings/:id/auto-assign', requireAdmin, requirePermission('manage-bookings'), autoAssignDriverToBooking);
router.post('/bookings/:id/redispatch', requireAdmin, requirePermission('manage-bookings'), redispatchBooking);
router.patch('/bookings/:id/unassign', requireAdmin, requirePermission('manage-bookings'), unassignDriverFromBooking);

// Driver listing & licensing
router.get('/drivers', requireAdmin, requirePermission('manage-users'), getAllDrivers);
router.get('/drivers/licensing', requireAdmin, requirePermission('manage-users'), getDriverLicensing);

// Driver approval actions
router.patch('/drivers/approve', requireAdmin, requirePermission('manage-users'), approveDriver);
router.patch('/drivers/request-revision', requireAdmin, requirePermission('manage-users'), requestRevision);

// Aleet license upload (authenticated user — driver uploads their own)
router.post('/drivers/:id/aleet-license', authenticateJWT, uploadSingleForHireLicense, handleUploadError, uploadAleetLicense);

// Update a driver's service regions
router.put('/drivers/:id/regions', requireAdmin, requirePermission('manage-users'), updateDriverRegions);

// Sidebar stats
router.get('/sidebar-stats', requireAdmin, requirePermission('view-reports'), getSidebarStats);

// Admin dashboard
router.get('/dashboard', requireAdmin, requirePermission('view-reports'), getAdminDashboard);

// Tier performance & settings
router.get('/tiers/performance', requireAdmin, requirePermission('view-reports'), getDriverTierPerformance);
router.get('/tiers/settings', requireAdmin, requirePermission('view-reports'), getTierSettings);
router.patch('/tiers/settings', requireAdmin, requirePermission('manage-users'), updateTierSettings);

module.exports = router;
