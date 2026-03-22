const express = require('express');
const { toggleDriverStatus,assignDriverToBooking, getAllDrivers } = require('../controllers/adminController');
const authenticateJWT = require('../middleware/authMiddleware');  // Import the JWT authentication middleware
const router = express.Router();

// Route to toggle driver active status (admin only)
router.patch('/toggleDriverStatus', authenticateJWT, toggleDriverStatus);
router.patch('/assignDriver', authenticateJWT, assignDriverToBooking);
router.get('/drivers',authenticateJWT, getAllDrivers); // ✅ new route

module.exports = router;
