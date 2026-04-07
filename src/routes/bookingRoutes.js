const express = require('express');
const {
    startBooking,
    confirmBooking,
    acceptBooking,
    getAllBookings,
    getMyBookings,
    getBookingById,
    previewBooking,
    completeBooking
} = require('../controllers/bookingController');
const authenticateJWT = require('../middleware/authMiddleware');
const router = express.Router();

// Price preview (no persist)
router.post('/preview', authenticateJWT, previewBooking);

// Create booking
router.post('/start', authenticateJWT, startBooking);

// My bookings (authenticated user)
router.get('/my', authenticateJWT, getMyBookings);

// Admin — all bookings
router.get('/', authenticateJWT, getAllBookings);

// Single booking (owner or admin)
router.get('/:id', authenticateJWT, getBookingById);

// Confirm booking (admin assigns driver, or driver self-assigns)
router.post('/confirm', authenticateJWT, confirmBooking);

// Driver accepts or declines
router.post('/accept', authenticateJWT, acceptBooking);

// Complete booking
router.patch('/:id/complete', authenticateJWT, completeBooking);

module.exports = router;
