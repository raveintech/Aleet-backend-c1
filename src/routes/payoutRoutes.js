const express = require('express');
const router = express.Router();
const { payoutSingleBooking, payoutEligibleBookings, payoutToAccount } = require('../controllers/payoutController');
const authenticateJWT = require('../middleware/authMiddleware');

// Optional: add auth middleware and admin guards
// const { requireAdmin } = require('../middleware/auth');

router.post('/booking/:id', authenticateJWT, payoutSingleBooking);
router.post('/run',  authenticateJWT, payoutEligibleBookings);
router.post('/payoutToAccount', payoutToAccount);

module.exports = router;
