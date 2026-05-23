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
const subscriptionLedger = require('../services/subscriptionLedgerService');
const logger = require('../utils/logger');
const { MEMBERSHIP_PLAN } = require('../config/membership');

/**
 * Normalize a Stripe Subscription reference into its string ID.
 *
 * Stripe returns `session.subscription` as a string when the session was
 * retrieved without `expand: ['subscription']`, and as the full Subscription
 * object when it was. Persisting the object directly would let Mongoose
 * coerce it to "[object Object]" — keep the helper at the controller boundary
 * so every write site stays defensive.
 */
function extractStripeSubscriptionId(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object' && typeof ref.id === 'string') return ref.id;
  return null;
}

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

    // Recurring Stripe Price ID is the only configuration that lets Stripe
    // run quarterly renewal automatically. Without it, the platform is
    // collecting a one-shot $1,347 with no re-charge — a real billing bug.
    // We fall back to payment mode for dev / staging so the local flow works,
    // but we warn loudly so prod env without the var stands out in logs.
    const usingSubscriptionMode = Boolean(MEMBERSHIP_PLAN.stripePriceId);
    if (!usingSubscriptionMode) {
      (req.log || logger).warn(
        { userId: userId.toString(), env: process.env.NODE_ENV },
        'STRIPE_MEMBERSHIP_PRICE_ID is not set — falling back to one-shot payment mode. ' +
        'Stripe will NOT renew this subscription quarterly. Configure a recurring Price in Stripe and set the env var.'
      );
    }

    const sessionParams = {
      payment_method_types: ['card'],
      ...(user?.email ? { customer_email: user.email } : {}),
      metadata: {
        userId: userId.toString(),
        type: 'subscription',
        plan: MEMBERSHIP_PLAN.name,
      },
      success_url: `${APP_BASE_URL}/subscription-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/subscription-cancelled`,
    };

    if (usingSubscriptionMode) {
      sessionParams.mode = 'subscription';
      sessionParams.line_items = [{ price: MEMBERSHIP_PLAN.stripePriceId, quantity: 1 }];
      // Stripe needs the subscription metadata to propagate to invoices for
      // reconciliation; the checkout-session metadata is not carried forward.
      sessionParams.subscription_data = {
        metadata: { userId: userId.toString(), plan: MEMBERSHIP_PLAN.name },
      };
    } else {
      sessionParams.mode = 'payment';
      sessionParams.line_items = [{
        price_data: {
          currency: CURRENCY,
          product_data: {
            name: 'Aleet Premium Subscription',
            description: `Quarterly subscription: $${(MEMBERSHIP_PLAN.monthlyDisplayCents / 100).toFixed(0)}/month billed quarterly at $${(MEMBERSHIP_PLAN.priceCents / 100).toFixed(0)}. Includes ${MEMBERSHIP_PLAN.hoursIncluded} free hours per month.`,
          },
          unit_amount: MEMBERSHIP_PLAN.priceCents,
        },
        quantity: 1,
      }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return sendSuccess(res, 200, 'Checkout session created successfully', {
      url: session.url,
      sessionId: session.id,
      mode: sessionParams.mode,
      message: 'Redirect to Stripe checkout to complete subscription',
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Subscription Checkout Error');
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

    // Update user subscription status. Plan-included hours and price live on
    // the user's `subscriptionDetails`; the prepaid ledger (T-2.3.4) reads
    // these on every drawdown.
    const planHoursIncluded = MEMBERSHIP_PLAN.hoursIncluded;
    const planPriceCents = MEMBERSHIP_PLAN.priceCents;
    const cycleMs = MEMBERSHIP_PLAN.cycleDays * 24 * 60 * 60 * 1000;
    const subscriptionDetails = {
      plan: MEMBERSHIP_PLAN.name,
      price: planPriceCents / 100,
      billingCycle: MEMBERSHIP_PLAN.billingCycle,
      startDate: new Date(),
      nextBillingDate: new Date(Date.now() + cycleMs),
      paymentMethodId: session.payment_intent?.id || null,
      isActive: true,
      monthlyHoursIncluded: planHoursIncluded,
      discountRate: MEMBERSHIP_PLAN.discountRate,
      stripeSessionId: sessionId,
      stripePaymentIntentId: session.payment_intent?.id || null,
      // `session.subscription` is a string ID when the session was retrieved
      // without expansion, and a full Subscription object when it was. Both
      // shapes are passed through this normalizer so we always persist the
      // string ID (Mongoose would otherwise coerce the object to "[object Object]").
      stripeSubscriptionId: extractStripeSubscriptionId(session.subscription),
    };

    await User.findByIdAndUpdate(userId, {
      subscriptionStatus: 'subscriber',
      subscriptionDetails: subscriptionDetails
    });

    // T-2.3.4 — open a Subscription cycle doc so the prepaid-hour ledger has a
    // place to draw down from when PRICING_OVERAGE is enabled.
    try {
      await subscriptionLedger.openCycle({
        userId,
        plan: MEMBERSHIP_PLAN.name,
        hoursIncluded: planHoursIncluded,
        priceCents: planPriceCents,
        // Stripe subscription ID (not session ID) so quarterly reconciliation
        // against the Stripe API can find this cycle.
        stripeSubscriptionId: extractStripeSubscriptionId(session.subscription),
        cycleStart: subscriptionDetails.startDate,
        cycleEnd: subscriptionDetails.nextBillingDate,
      });
    } catch (err) {
      (req.log || logger).error({ err, userId }, 'Failed to open subscription cycle');
    }

    const updatedUser = await User.findById(userId).select('-password');

    return sendSuccess(res, 200, 'Successfully subscribed to monthly plan', {
      user: updatedUser,
      subscription: subscriptionDetails,
      message: `Welcome to Swift Haven Premium! You now have ${planHoursIncluded} free hours per month and 10% discount on all bookings.`
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Process Subscription Payment Error');
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

    const planIncluded = Number(user.subscriptionDetails?.monthlyHoursIncluded) || 0;
    const subscriptionInfo = {
      status: user.subscriptionStatus,
      isSubscriber: user.subscriptionStatus === 'subscriber',
      subscriptionDetails: user.subscriptionDetails || null,
      currentMonthUsage: {
        yearMonth: currentMonth,
        hoursUsed: monthlyHours?.totalHoursUsed || 0,
        hoursRemaining: user.subscriptionStatus === 'subscriber' ? Math.max(0, planIncluded - (monthlyHours?.totalHoursUsed || 0)) : 0,
        nextBillingDate: user.subscriptionDetails?.nextBillingDate || null
      }
    };

    return sendSuccess(res, 200, 'Subscription status retrieved', subscriptionInfo);
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Get Subscription Status Error');
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

    // Record the cancellation intent on the Subscription ledger doc. Per
    // P0 B5, the doc stays `status: 'active'` until `cycleEnd`; this call
    // stamps `cancelledAt` + `cancellationReason` so the (still-deferred)
    // cycle-sweep job can find it and transition to `cancelled` then.
    try {
      await subscriptionLedger.cancel({ userId, reason: reason || 'User requested cancellation' });
    } catch (err) {
      (req.log || logger).error({ err, userId }, 'Failed to record cancellation on subscription ledger');
    }

    const updatedUser = await User.findById(userId).select('-password');

    return sendSuccess(res, 200, 'Subscription cancelled successfully', {
      user: updatedUser,
      message: 'Your subscription has been cancelled. You will retain access until your current billing period ends.'
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Cancel Subscription Error');
    return sendError(res, 500, error.message || 'Failed to cancel subscription');
  }
});

// Get Subscription Benefits
const getSubscriptionBenefits = asyncHandler(async (req, res) => {
  try {
    const monthlyDollars = MEMBERSHIP_PLAN.monthlyDisplayCents / 100;
    const quarterlyDollars = MEMBERSHIP_PLAN.priceCents / 100;
    const benefits = {
      monthlyPlan: {
        price: monthlyDollars,
        billingCycle: MEMBERSHIP_PLAN.billingCycle,
        totalQuarterly: quarterlyDollars,
        benefits: [
          `${MEMBERSHIP_PLAN.hoursIncluded} free hours per month`,
          '10% discount on all bookings',
          'Priority customer support',
          'Free VIP add-ons',
          'No distance surcharge up to 20 miles',
          'Flexible booking changes',
        ],
      },
      comparison: {
        regularPrice: 'Full price for all bookings',
        subscriptionPrice: `$${monthlyDollars.toFixed(0)}/month (billed quarterly at $${quarterlyDollars.toFixed(0)})`,
        savings: 'Average savings of $200-500 per month for frequent users',
      },
    };

    return sendSuccess(res, 200, 'Subscription benefits retrieved', benefits);
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Get Benefits Error');
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

    // Stripe's billing-portal API requires a Customer ID (cus_*). Falling back
    // to email would 400 from Stripe. If we never captured the customer ID at
    // subscription time, surface a clear error rather than masking it.
    const stripeCustomerId = user.subscriptionDetails?.stripeCustomerId;
    if (!stripeCustomerId) {
      return sendValidationError(
        res,
        'No Stripe customer is associated with this subscription. Please contact support.',
        { reason: 'STRIPE_CUSTOMER_MISSING' }
      );
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${APP_BASE_URL}/subscription-settings`,
    });

    return sendSuccess(res, 200, 'Payment method portal created successfully', {
      url: portalSession.url,
      message: 'Redirect to Stripe portal to update payment method'
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Update Payment Method Error');
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
    (req.log || logger).error({ err: error }, 'Create Stripe Customer Error');
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
