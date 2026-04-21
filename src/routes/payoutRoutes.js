const express = require('express');
const router = express.Router();
const { payoutSingleBooking, payoutEligibleBookings, payoutToAccount } = require('../controllers/payoutController');
const authenticateJWT = require('../middleware/authMiddleware');
const { requireActiveDriver } = require('../middleware/authMiddleware');

router.post('/booking/:id', authenticateJWT, requireActiveDriver, payoutSingleBooking);
router.post('/run', authenticateJWT, requireActiveDriver, payoutEligibleBookings);
router.post('/payoutToAccount', payoutToAccount);

module.exports = router;
