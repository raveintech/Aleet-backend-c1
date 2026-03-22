const express = require('express');
const {
  createSubscriptionCheckout,
  processSubscriptionPayment,
  getSubscriptionStatus,
  cancelSubscription,
  getSubscriptionBenefits,
  updatePaymentMethod,
  createStripeCustomer,
} = require('../controllers/subscriptionController');
const authenticateJWT = require('../middleware/authMiddleware');
const router = express.Router();

// ===== SUBSCRIPTION ROUTES ===== //

// Create Stripe checkout session for subscription ($449/month billed quarterly)
router.post('/checkout',authenticateJWT, createSubscriptionCheckout);

// Process successful subscription payment (called after Stripe checkout)
router.post('/process-payment', authenticateJWT, processSubscriptionPayment);

// Create Stripe customer for subscription management
router.post('/create-customer', authenticateJWT, createStripeCustomer);

// Get current subscription status and usage
router.get('/status', authenticateJWT, getSubscriptionStatus);

// Cancel subscription
router.post('/cancel', authenticateJWT, cancelSubscription);

// Get subscription benefits and pricing info
router.get('/benefits', getSubscriptionBenefits);

// Update payment method via Stripe portal
router.put('/payment-method', authenticateJWT, updatePaymentMethod);

module.exports = router;
