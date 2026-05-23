const express = require('express');
const {
  getDashboardStats,
  getTripHistory,
  getUpcomingTrips,
  getActiveTrips,
  getDriverDashboard,
  getDriverTrips,
  getDriverEarnings,
  getDriverAvailability,
} = require('../controllers/dashboardController');
const authenticateJWT = require('../middleware/authMiddleware');
const { requireActiveDriver } = require('../middleware/authMiddleware');
const router = express.Router();

// ===== CUSTOMER DASHBOARD ===== //
router.get('/stats', authenticateJWT, getDashboardStats);
router.get('/trips/history', authenticateJWT, getTripHistory);
router.get('/trips/upcoming', authenticateJWT, getUpcomingTrips);
router.get('/trips/active', authenticateJWT, getActiveTrips);

// ===== DRIVER DASHBOARD ===== //
router.get('/driver', authenticateJWT, requireActiveDriver, getDriverDashboard);
router.get('/driver/trips', authenticateJWT, requireActiveDriver, getDriverTrips);
router.get('/driver/earnings', authenticateJWT, requireActiveDriver, getDriverEarnings);
// T-2.4.5 — availability surface emits `unavailable` and `committed` for
// non-approved drivers, so the route can NOT be gated on requireActiveDriver
// (which 403s those exact users). The controller does its own role check.
router.get('/driver/availability', authenticateJWT, getDriverAvailability);

module.exports = router;
