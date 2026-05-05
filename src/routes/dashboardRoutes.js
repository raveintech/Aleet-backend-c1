const express = require('express');
const {
  getDashboardStats,
  getTripHistory,
  getUpcomingTrips,
  getActiveTrips,
  getDriverDashboard,
  getDriverTrips,
  getDriverEarnings,
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

module.exports = router;
