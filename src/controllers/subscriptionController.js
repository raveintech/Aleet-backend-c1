const asyncHandler = require('express-async-handler');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const MonthlyHours = require('../models/MonthlyHours');
const {
  sendSuccess,
  sendError,
  sendValidationError,
  sendNotFound,
  sendUnauthorized,
} = require('../utils/responseHelper');

const CURRENCY = 'usd'
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';

// ===== SUBSCRIPTION MANAGEMENT ===== //

// Create Stripe Checkout Session for Subscription
const createSubscriptionCheckout = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) return sendNotFound(res, 'User not found');

    if (user.subscriptionStatus === 'subscriber') {
      return sendValidationError(res, 'User is already subscribed');
    }

    // Create Stripe Checkout Session for quarterly subscription ($1,347)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      ...(user?.email ? { customer_email: user.email } : {}),
      metadata: {
        userId: userId.toString(),
        type: 'subscription',
        plan: 'quarterly'
      },
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            product_data: {
              name: 'Aleet Membership',
              description: 'Membership billed quarterly. Includes 5 prepaid driving hours per month at a locked $89/hr (any vehicle type).'
            },
            unit_amount: 134700, // $1,347 in cents
          },
          quantity: 1,
        }
      ],
      success_url: `${APP_BASE_URL}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/subscription-cancelled`,
    });

    return sendSuccess(res, 200, 'Checkout session created successfully', {
      url: session.url,
      sessionId: session.id,
      message: 'Redirect to Stripe checkout to complete subscription'
    });
  } catch (error) {
    console.error('Subscription Checkout Error:', error);
    return sendError(res, 500, error.message || 'Failed to create subscription checkout');
  }
});

// Process successful subscription payment (called from webhook)
const processSubscriptionPayment = asyncHandler(async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return sendValidationError(res, 'Session ID is required');
    }

    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return sendValidationError(res, 'Payment not completed');
    }

    const userId = session.metadata?.userId;
    if (!userId) {
      return sendValidationError(res, 'User ID not found in session');
    }

    const user = await User.findById(userId);
    if (!user) return sendNotFound(res, 'User not found');

    // Update user subscription status
    const subscriptionDetails = {
      plan: 'monthly',
      price: 449,
      billingCycle: 'quarterly',
      startDate: new Date(),
      nextBillingDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
      paymentMethodId: session.payment_intent?.id || null,
      isActive: true,
      monthlyHoursIncluded: 5,
      stripeSessionId: sessionId,
      stripePaymentIntentId: session.payment_intent?.id || null
    };

    await User.findByIdAndUpdate(userId, {
      subscriptionStatus: 'subscriber',
      subscriptionDetails: subscriptionDetails
    });

    const updatedUser = await User.findById(userId).select('-password');

    return sendSuccess(res, 200, 'Successfully subscribed to monthly plan', {
      user: updatedUser,
      subscription: subscriptionDetails,
      message: 'Welcome to Aleet Membership! You now have 5 prepaid hours per month at a locked $89/hr on any vehicle type.'
    });
  } catch (error) {
    console.error('Process Subscription Payment Error:', error);
    return sendError(res, 500, error.message || 'Failed to process subscription payment');
  }
});

// Get Subscription Status
const getSubscriptionStatus = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select('-password');
    if (!user) return sendNotFound(res, 'User not found');

    // Get current month's usage
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const monthlyHours = await MonthlyHours.findOne({ user: userId, yearMonth: currentMonth });

    const subscriptionInfo = {
      status: user.subscriptionStatus,
      isSubscriber: user.subscriptionStatus === 'subscriber',
      subscriptionDetails: user.subscriptionDetails || null,
      currentMonthUsage: {
        yearMonth: currentMonth,
        hoursUsed: monthlyHours?.totalHoursUsed || 0,
        hoursRemaining: user.subscriptionStatus === 'subscriber' ? Math.max(0, 5 - (monthlyHours?.totalHoursUsed || 0)) : 0,
        nextBillingDate: user.subscriptionDetails?.nextBillingDate || null
      }
    };

    return sendSuccess(res, 200, 'Subscription status retrieved', subscriptionInfo);
  } catch (error) {
    console.error('Get Subscription Status Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve subscription status');
  }
});

// Cancel Subscription
const cancelSubscription = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { reason } = req.body;

    const user = await User.findById(userId);
    if (!user) return sendNotFound(res, 'User not found');

    if (user.subscriptionStatus !== 'subscriber') {
      return sendValidationError(res, 'User is not currently subscribed');
    }

    // Update user subscription status
    await User.findByIdAndUpdate(userId, {
      subscriptionStatus: 'cancelled',
      subscriptionDetails: {
        ...user.subscriptionDetails,
        isActive: false,
        cancelledAt: new Date(),
        cancellationReason: reason || 'User requested cancellation'
      }
    });

    const updatedUser = await User.findById(userId).select('-password');

    return sendSuccess(res, 200, 'Subscription cancelled successfully', {
      user: updatedUser,
      message: 'Your subscription has been cancelled. You will retain access until your current billing period ends.'
    });
  } catch (error) {
    console.error('Cancel Subscription Error:', error);
    return sendError(res, 500, error.message || 'Failed to cancel subscription');
  }
});

// Get Subscription Benefits
const getSubscriptionBenefits = asyncHandler(async (req, res) => {
  try {
    const benefits = {
      monthlyPlan: {
        price: 449,
        billingCycle: 'quarterly',
        totalQuarterly: 1347,
        benefits: [
          '5 prepaid hours per month',
          'Locked $89/hr on any vehicle type',
          'Priority customer support',
          'Free VIP add-ons',
          'No distance surcharge up to 20 miles',
          'Flexible booking changes'
        ]
      },
      comparison: {
        regularPrice: 'Full price for all bookings',
        subscriptionPrice: '$449/month (billed quarterly at $1,347)',
        savings: 'Average savings of $200-500 per month for frequent users'
      }
    };

    return sendSuccess(res, 200, 'Subscription benefits retrieved', benefits);
  } catch (error) {
    console.error('Get Benefits Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve subscription benefits');
  }
});

// Update Payment Method via Stripe
const updatePaymentMethod = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) return sendNotFound(res, 'User not found');

    if (user.subscriptionStatus !== 'subscriber') {
      return sendValidationError(res, 'User is not currently subscribed');
    }

    // Create Stripe Customer Portal session for payment method management
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.subscriptionDetails?.stripeCustomerId || user.email, // Use email as fallback
      return_url: `${APP_BASE_URL}/subscription-settings`,
    });

    return sendSuccess(res, 200, 'Payment method portal created successfully', {
      url: portalSession.url,
      message: 'Redirect to Stripe portal to update payment method'
    });
  } catch (error) {
    console.error('Update Payment Method Error:', error);
    return sendError(res, 500, error.message || 'Failed to create payment method portal');
  }
});

// Create Stripe Customer for subscription management
const createStripeCustomer = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) return sendNotFound(res, 'User not found');

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email: user.email,
      phone: user.phone,
      name: user.name,
      metadata: {
        userId: userId.toString()
      }
    });

    // Update user with Stripe customer ID
    await User.findByIdAndUpdate(userId, {
      'subscriptionDetails.stripeCustomerId': customer.id
    });

    return sendSuccess(res, 200, 'Stripe customer created successfully', {
      customerId: customer.id,
      message: 'Customer profile created for subscription management'
    });
  } catch (error) {
    console.error('Create Stripe Customer Error:', error);
    return sendError(res, 500, error.message || 'Failed to create Stripe customer');
  }
});

module.exports = {
  createSubscriptionCheckout,
  processSubscriptionPayment,
  getSubscriptionStatus,
  cancelSubscription,
  getSubscriptionBenefits,
  updatePaymentMethod,
  createStripeCustomer,
};
