const express = require('express');
const router = express.Router();
const authenticateJWT = require('../middleware/authMiddleware');  // Use JWT middleware for protection

const PaymentsController = require('../controllers/payments.controller');

// Create Checkout Session
router.post('/checkout-session', authenticateJWT, PaymentsController.createCheckoutSession);

// (Optional) verify a session from frontend success page
router.get('/session/:sessionId',  PaymentsController.getSessionStatus);

module.exports = router;
