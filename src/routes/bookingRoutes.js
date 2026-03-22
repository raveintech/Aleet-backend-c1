const express = require('express');
const { startBooking, confirmBooking, acceptBooking, getAllBookings, previewBooking, completeBooking } = require('../controllers/bookingController');
const authenticateJWT = require('../middleware/authMiddleware');  // Use JWT middleware for protection
const router = express.Router();

// Route for starting a booking
router.post('/start', authenticateJWT, startBooking);

// Route for confirming a booking (driver or admin)
router.post('/confirm', authenticateJWT, confirmBooking);

// Route for driver accepting or declining the booking
router.post('/accept', authenticateJWT, acceptBooking);
router.get('/bookings', authenticateJWT, getAllBookings);
router.post('/preview', authenticateJWT, previewBooking);
router.post('/completeBooking', authenticateJWT, completeBooking);

module.exports = router;
