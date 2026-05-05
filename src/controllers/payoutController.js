require('dotenv').config();
const asyncHandler = require('express-async-handler');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

const Booking = require('../models/Booking');
const BankAccount = require('../models/BankAccount');

const CURRENCY = 'usd'
const MODE = (process.env.PAYOUT_MODE || 'BUSINESS').toUpperCase(); // BUSINESS | FULL_FINAL

// --- helpers ---
const toCents = (num) => Math.max(0, Math.round((Number(num) || 0) * 100));

/**
 * Decide if a booking is subscription-priced.
 * Priority: booking.pricingModel, else infer from prices.
 */
function isSubscriptionBooking(booking) {
  if (booking.pricingModel) return booking.pricingModel === 'subscription';
  // infer: if subscriptionPrice is set and finalPrice ~= subscriptionPrice
  if (booking.subscriptionPrice != null) {
    const diff = Math.abs(Number(booking.finalPrice) - Number(booking.subscriptionPrice));
    return diff < 0.5; // within $0.50
  }
  return false;
}

/**
 * Compute driver payout amount in cents for BUSINESS mode.
 * - 30% of base for regular; 40% of base for subscription
 * - + 100% tips
 * - add-ons assumed platform-only (not included here)
 * NOTE: If your finalPrice includes add-ons, consider storing base separately.
 */
function computeBusinessPayoutCents(booking) {
  const sub = isSubscriptionBooking(booking);
  const pct = sub ? 0.40 : 0.30;

  // If you have a separate "baseTotal" without add-ons, use that instead of finalPrice.
  const baseAmount = Number(booking.finalPrice) || 0; // <-- replace with booking.baseAmount if you track it
  const tipAmount = Number(booking.tip) || 0;

  const driverBase = baseAmount * pct;
  const driverTips = tipAmount;

  return toCents(driverBase + driverTips);
}

/**
 * Compute driver payout amount in cents for FULL_FINAL mode (your demo ask).
 * Sends finalPrice + tip to the driver.
 */
function computeFullFinalPayoutCents(booking) {
  const total = (Number(booking.finalPrice) || 0) + (Number(booking.tip) || 0);
  return toCents(total);
}

/**
 * Public calculator used by the endpoints.
 */
function computePayoutCents(booking) {
  if (MODE === 'FULL_FINAL') return computeFullFinalPayoutCents(booking);
  return computeBusinessPayoutCents(booking);
}

// --- validations for eligibility ---
function assertEligibleForPayout(booking) {
  if (!booking) throw new Error('Booking not found.');
  if (!booking.assignedDriver) throw new Error('No driver assigned to this booking.');
  if (booking.PaidToDriver) throw new Error('Booking already paid to driver.');
  if (!['Paid'].includes(booking.paymentStatus)) {
    throw new Error(`Booking paymentStatus must be 'Paid'; got '${booking.paymentStatus}'.`);
  }
  if (!booking.finalPrice || Number(booking.finalPrice) <= 0) {
    throw new Error('Invalid finalPrice; cannot payout.');
  }
}

// --- STRIPE transfer ---
async function createTransfer({ amountCents, destinationAccount, transferGroup }) {
  if (amountCents <= 0) throw new Error('Payout amount must be > 0 cents.');
  return stripe.transfers.create(
    {
      amount: amountCents,
      currency: CURRENCY,
      destination: destinationAccount,
      transfer_group: transferGroup,
    },
    {
      // defensive idempotency (transfer_group + amount)
      idempotencyKey: `${transferGroup}:${amountCents}`,
    }
  );
}

// --- Single booking payout ---
const payoutSingleBooking = asyncHandler(async (req, res) => {
  const bookingId = req.params.id;

  const booking = await Booking.findById(bookingId).lean();
  assertEligibleForPayout(booking);

  const bank = await BankAccount.findOne({ driverId: booking.assignedDriver }).lean();
  if (!bank || !bank.stripeAccountId) {
    throw new Error('Driver is not connected to Stripe (no stripeAccountId).');
  }

  const amountCents = computePayoutCents(booking);
  if (amountCents <= 0) throw new Error('Computed payout is zero; skip.');

  const transferGroup = `booking:${booking._id.toString()}`;

  const transfer = await createTransfer({
    amountCents,
    destinationAccount: bank.stripeAccountId,
    transferGroup,
  });

  // Mark booking paid (and store transfer id)
  await Booking.updateOne(
    { _id: booking._id, PaidToDriver: false },
    { $set: { PaidToDriver: true, payoutTransferId: transfer.id } }
  );

  res.status(200).json({
    ok: true,
    mode: MODE,
    bookingId: booking._id,
    amountCents,
    currency: CURRENCY,
    transferId: transfer.id,
  });
});

// --- Bulk payout for all eligible bookings ---
const payoutEligibleBookings = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  // Eligible = Paid, not yet PaidToDriver, has assigned driver
  const eligible = await Booking.find({
    paymentStatus: 'Paid',
    PaidToDriver: false,
    assignedDriver: { $ne: null },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  const results = [];
  for (const b of eligible) {
    try {
      const bank = await BankAccount.findOne({ driverId: b.assignedDriver }).lean();
      if (!bank?.stripeAccountId) {
        results.push({ bookingId: b._id, ok: false, error: 'Driver missing stripeAccountId' });
        continue;
      }

      const amountCents = computePayoutCents(b);
      if (amountCents <= 0) {
        results.push({ bookingId: b._id, ok: false, error: 'Zero payout' });
        continue;
      }

      const transferGroup = `booking:${b._id.toString()}`;
      const transfer = await createTransfer({
        amountCents,
        destinationAccount: bank.stripeAccountId,
        transferGroup,
      });

      await Booking.updateOne(
        { _id: b._id, PaidToDriver: false, status: "Completed" },
        { $set: { PaidToDriver: true, payoutTransferId: transfer.id } }
      );

      results.push({
        bookingId: b._id,
        ok: true,
        amountCents,
        currency: CURRENCY,
        transferId: transfer.id,
      });
    } catch (e) {
      results.push({ bookingId: b._id, ok: false, error: e.message });
    }
  }

  res.status(200).json({
    ok: true,
    mode: MODE,
    processed: results.length,
    results,
  });
});



const payoutToAccount = asyncHandler(async (req, res) => {
  const { accountId, amount } = req.body;

  if (!accountId) {
    throw new Error('stripeAccountId is required.');
  }
  if (!amount || Number(amount) <= 0) {
    throw new Error('Valid amount (in dollars) is required.');
  }

  // convert dollars to cents
  const amountCents = Math.round(Number(amount) * 100);

  // ✅ 1. Make sure transfers capability is requested/enabled
  const account = await stripe.accounts.retrieve(accountId);

  if (
    !account.capabilities?.transfers ||
    account.capabilities.transfers !== 'active'
  ) {
    await stripe.accounts.update(accountId, {
      capabilities: { transfers: { requested: true } },
    });
  }

  // ✅ 2. Now create transfer
  const transferGroup = `manual:${Date.now()}`;

  const transfer = await stripe.transfers.create({
    amount: amountCents,
    currency: CURRENCY, // e.g. 'usd'
    destination: accountId,
    transfer_group: transferGroup,
  });

  res.status(200).json({
    ok: true,
    accountId,
    amountCents,
    currency: CURRENCY,
    transferId: transfer.id,
  });
});




module.exports = {
  payoutSingleBooking,
  payoutEligibleBookings,
  payoutToAccount
};
