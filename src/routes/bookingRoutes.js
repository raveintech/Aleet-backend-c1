const express = require('express');
const {
    startBooking,
    confirmBooking,
    acceptBooking,
    getOpenTrips,
    driverCancelBooking,
    getAllBookings,
    getAdminBookingStats,
    getMyBookings,
    getBookingById,
    previewBooking,
    completeBooking
} = require('../controllers/bookingController.js');
const authenticateJWT = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/requireAdmin');
const { requirePermission } = require('../middleware/requireAdmin');
const router = express.Router();

// Price preview (no persist)
router.post('/preview', authenticateJWT, previewBooking);

// Create booking
router.post('/start', authenticateJWT, startBooking);

// My bookings (authenticated user)
router.get('/my', authenticateJWT, getMyBookings);

// Driver — open trip offers matching the driver's tier + eligibility
router.get('/open-trips', authenticateJWT, getOpenTrips);

// Driver — cancel a booking they previously accepted (back to Pending)
router.post('/driver-cancel', authenticateJWT, driverCancelBooking);

// Admin — stats for top cards
router.get('/stats', requireAdmin, requirePermission('view-reports'), getAdminBookingStats);

// Admin — all bookings
router.get('/', requireAdmin, requirePermission('manage-bookings'), getAllBookings);

// Single booking (owner or admin)
router.get('/:id', authenticateJWT, getBookingById);

// Confirm booking (admin assigns driver, or driver self-assigns)
router.post('/confirm', authenticateJWT, confirmBooking);

// Driver accepts or declines
router.post('/accept', authenticateJWT, acceptBooking);

// Complete booking
router.patch('/:id/complete', authenticateJWT, completeBooking);

module.exports = router;
