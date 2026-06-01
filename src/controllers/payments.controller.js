require('dotenv').config();               // <-- load env FIRST

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const Booking = require('../models/Booking');
const User = require('../models/User');

const CURRENCY = 'usd';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';

// Convert to minor units (USD -> cents). If you switch to a zero-decimal currency, adjust.
function toMinorUnits(amount) {
  return Math.round(Number(amount || 0) * 100);
}

exports.createCheckoutSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId, tip = 0 } = req.body;

    // 1) Validate booking ownership + unpaid
    const booking = await Booking.findById(bookingId).populate('vehicleType', 'name');
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.user.toString() !== userId.toString())
      return res.status(403).json({ success: false, message: 'Not your booking' });
    if (booking.paymentStatus === 'Paid')
      return res.status(400).json({ success: false, message: 'Already paid' });
    if (booking.status === 'Cancelled')
      return res.status(400).json({ success: false, message: 'Booking is cancelled' });

    // 2) Compute final server-side amount
    const baseAmount = Number(booking.finalPrice || 0);
    const tipAmount = Math.max(0, Number(tip || 0));
    const totalAmount = baseAmount + tipAmount;
    if (totalAmount <= 0)
      return res.status(400).json({ success: false, message: 'Invalid amount' });

    // 3) Get user email (optional)
    const user = await User.findById(userId);

    // 4) Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      ...(user?.email ? { customer_email: user.email } : {}),
      metadata: {
        bookingId: booking._id.toString(),
        userId: userId.toString(),
      },
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            product_data: {
              name: `Booking: ${booking.vehicleType?.name || 'Vehicle'} x ${booking.quantity}`,
              description: `Region: ${booking.region} | ${new Date(booking.dates.startDate).toLocaleString()} → ${new Date(booking.dates.endDate).toLocaleString()}`
            },
            unit_amount: toMinorUnits(baseAmount),
          },
          quantity: 1,
        },
        ...(tipAmount > 0 ? [{
          price_data: {
            currency: CURRENCY,
            product_data: { name: 'Tip' },
            unit_amount: toMinorUnits(tipAmount),
          },
          quantity: 1,
        }] : [])
      ],
      success_url: `${APP_BASE_URL}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/booking-cancelled?booking_id=${booking._id}`,
    });

    // 5) Save session id to booking
    booking.stripeSessionId = session.id;
    booking.tip = tipAmount; // optional
    await booking.save();

    return res.status(200).json({
      success: true,
      url: session.url,
      sessionId: session.id
    });
  } catch (err) {
    console.error('Stripe createCheckoutSession error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create checkout session' });
  }
};

// Stripe webhook (set in Stripe Dashboard or via Stripe CLI)
exports.webhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️  Webhook verify failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('✅ Webhook received:', event.type);

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, { expand: ['payment_intent'] });
      console.log('Session ID:', fullSession.id, 'payment_status:', fullSession.payment_status, 'metadata:', fullSession.metadata);

      const bookingId = fullSession.metadata?.bookingId;
      const userId = fullSession.metadata?.userId;
      const type = fullSession.metadata?.type;

      // Handle booking payments
      if (bookingId && type !== 'subscription') {
        const booking = await Booking.findById(bookingId);
        if (!booking) {
          console.error('Booking not found:', bookingId);
        } else {
          booking.paymentStatus = 'Paid';
          booking.paidAt = new Date();
          booking.stripePaymentIntentId = fullSession.payment_intent?.id || null;
          await booking.save();
          console.log('💾 Booking marked Paid:', bookingId);
        }
      }

      // Handle subscription payments
      if (type === 'subscription' && userId) {
        const User = require('../models/User');
        const user = await User.findById(userId);
        if (!user) {
          console.error('User not found for subscription:', userId);
        } else {
          // Update user subscription status
          const subscriptionDetails = {
            plan: 'monthly',
            price: 449,
            billingCycle: 'quarterly',
            startDate: new Date(),
            nextBillingDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
            paymentMethodId: fullSession.payment_intent?.id || null,
            stripeCustomerId: fullSession.customer || null,
            stripeSessionId: fullSession.id,
            stripePaymentIntentId: fullSession.payment_intent?.id || null,
            isActive: true,
            monthlyHoursIncluded: 5
          };

          await User.findByIdAndUpdate(userId, {
            subscriptionStatus: 'subscriber',
            subscriptionDetails: subscriptionDetails
          });
          console.log('💾 User subscription activated:', userId);
        }
      }
    }

    // ── Stripe Connect: driver bank account onboarding completed ─────────────
    if (event.type === 'account.updated') {
      const account = event.data.object;
      const stripeAccountId = account.id;

      if (account.payouts_enabled && account.details_submitted) {
        const BankAccount = require('../models/BankAccount');
        await BankAccount.findOneAndUpdate(
          { stripeAccountId },
          { $set: { stripeOnboardingComplete: true } }
        );
        console.log('✅ Stripe Connect onboarding complete for:', stripeAccountId);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).send('Webhook handler failed');
  }
};


// Optional helper to verify a session from success page
// controllers/payments.controller.js
exports.getSessionStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
    const bookingId = session.metadata?.bookingId;
    const booking = bookingId ? await Booking.findById(bookingId) : null;

    // 🔧 Reconcile if webhook didn't run yet
    if (session.payment_status === 'paid' && booking && booking.paymentStatus !== 'Paid') {
      booking.paymentStatus = 'Paid';
      booking.paidAt = new Date();
      booking.stripePaymentIntentId = session.payment_intent?.id || null;
      await booking.save();
    }

    return res.status(200).json({
      success: true,
      session: {
        id: session.id,
        payment_status: session.payment_status,
        status: session.status,
      },
      booking: booking ? {
        id: booking._id,
        paymentStatus: booking.paymentStatus,
        finalPrice: booking.finalPrice,
        tip: booking.tip,
        status: booking.status
      } : null
    });
  } catch (err) {
    console.error('getSessionStatus error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load session status' });
  }
};
