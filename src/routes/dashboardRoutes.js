const express = require('express');
const {
  getDashboardStats,
  getTripHistory,
  getUpcomingTrips,
  getActiveTrips,
} = require('../controllers/dashboardController');
const authenticateJWT = require('../middleware/authMiddleware');
const router = express.Router();

// ===== DASHBOARD ROUTES ===== //

// Get customer dashboard statistics (Upcoming Trips, Active Trips, Total Trips)
router.get('/stats', authenticateJWT, getDashboardStats);

// Get trip history with filtering and pagination
router.get('/trips/history', authenticateJWT, getTripHistory);

// Get upcoming trips only
router.get('/trips/upcoming', authenticateJWT, getUpcomingTrips);

// Get active trips only
router.get('/trips/active', authenticateJWT, getActiveTrips);

module.exports = router;
