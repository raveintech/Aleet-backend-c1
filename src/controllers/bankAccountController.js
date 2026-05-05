require('dotenv').config();

const asyncHandler = require("express-async-handler");
const BankAccount = require("../models/BankAccount.js");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────
const formatMethod = (doc) => ({
  id: doc._id,
  type: doc.type,
  label: doc.label,
  paypalEmail: doc.paypalEmail,
  isPrimary: doc.isPrimary,
  createdAt: doc.createdAt,
});

// ── GET /api/bank-accounts ─────────────────────────────────────────────────────
const getPayoutMethods = asyncHandler(async (req, res) => {
  const methods = await BankAccount.find({ driverId: req.user.id }).sort({ createdAt: 1 });
  return res.status(200).json({
    success: true,
    data: methods.map(formatMethod),
  });
});

// ── POST /api/bank-accounts ────────────────────────────────────────────────────
// Add a payout method manually (bank_account or paypal).
// Stripe onboarding is triggered separately via /api/bank-accounts/stripe-onboarding.
const addPayoutMethod = asyncHandler(async (req, res) => {
  const { label, paypalEmail } = req.body;

  if (!paypalEmail) {
    return res.status(400).json({ success: false, message: 'paypalEmail is required' });
  }

  // Check if this is the first method — make it primary automatically
  const existingCount = await BankAccount.countDocuments({ driverId: req.user.id });

  const method = await BankAccount.create({
    driverId: req.user.id,
    type: 'paypal',
    label: label || null,
    paypalEmail,
    isPrimary: existingCount === 0,
  });

  return res.status(201).json({ success: true, data: formatMethod(method) });
});

// ── PATCH /api/bank-accounts/:id/set-primary ───────────────────────────────────
const setPrimary = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const method = await BankAccount.findOne({ _id: id, driverId: req.user.id });
  if (!method) return res.status(404).json({ success: false, message: 'Payout method not found' });

  // Unset all, then set the selected one
  await BankAccount.updateMany({ driverId: req.user.id }, { isPrimary: false });
  method.isPrimary = true;
  await method.save();

  return res.status(200).json({ success: true, data: formatMethod(method) });
});

// ── DELETE /api/bank-accounts/:id ──────────────────────────────────────────────
const deletePayoutMethod = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const method = await BankAccount.findOneAndDelete({ _id: id, driverId: req.user.id });
  if (!method) return res.status(404).json({ success: false, message: 'Payout method not found' });

  // If the deleted method was primary, promote the oldest remaining one
  if (method.isPrimary) {
    const next = await BankAccount.findOne({ driverId: req.user.id }).sort({ createdAt: 1 });
    if (next) { next.isPrimary = true; await next.save(); }
  }

  return res.status(200).json({ success: true, message: 'Payout method removed' });
});

// ── POST /api/bank-accounts/stripe-onboarding ──────────────────────────────────
// Legacy Stripe Connect onboarding (kept as-is)
const addBankAccount = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let existing = await BankAccount.findOne({ driverId: userId, stripeAccountId: { $ne: null } });

  let stripeAccountId;

  if (!existing) {
    const account = await stripe.accounts.create({
      type: "express",
      capabilities: { transfers: { requested: true } },
    });
    stripeAccountId = account.id;
    existing = await BankAccount.create({
      driverId: userId,
      type: 'bank_account',
      stripeAccountId,
      isPrimary: (await BankAccount.countDocuments({ driverId: userId })) === 0,
    });
  } else {
    stripeAccountId = existing.stripeAccountId;
  }

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: 'https://dashboard.stripe.com/workbench/blueprints/learn-accounts-v1-platform/create-account-step?confirmation-redirect=createAccountLink',
    return_url: 'https://dashboard.stripe.com/workbench/blueprints/learn-accounts-v1-platform/create-account-step?confirmation-redirect=createAccountLink',
    type: 'account_onboarding',
  });

  res.status(201).json({
    message: "Bank account setup started",
    stripeAccountId,
    onboardingUrl: accountLink.url,
  });
});

// ── GET /api/bank-accounts/check ───────────────────────────────────────────────
const checkBankAccount = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const existing = await BankAccount.findOne({ driverId: userId, stripeAccountId: { $ne: null } });

  if (!existing) {
    return res.status(200).json({ hasBankAccount: false, message: "Driver has not added a bank account" });
  }

  try {
    const account = await stripe.accounts.retrieve(existing.stripeAccountId);
    const isFullyOnboarded = account.details_submitted && account.payouts_enabled;
    return res.status(200).json({
      hasBankAccount: true,
      stripeAccountId: true,
      status: {
        details_submitted: true,
        payouts_enabled: true,
        charges_enabled: true,
        requirements: true,
      },
      message: isFullyOnboarded ? "Driver's bank account is fully connected" : "Driver started onboarding but hasn't completed it yet",
    });
  } catch (error) {
    console.error("Stripe account retrieve error:", error);
    return res.status(500).json({ hasBankAccount: false, message: "Failed to verify bank account with Stripe", error: error.message });
  }
});

// ── GET /api/bank-accounts/stripe/status ─────────────────────────────────────
const getStripeStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const existing = await BankAccount.findOne({ driverId: userId, type: 'stripe_connect' });

  if (!existing || !existing.stripeAccountId) {
    return res.status(200).json({
      success: true,
      connected: false,
      status: 'not_started',
      message: 'No Stripe account connected. Start onboarding to receive payouts.',
    });
  }

  try {
    const account = await stripe.accounts.retrieve(existing.stripeAccountId);
    const fullyOnboarded = account.details_submitted && account.payouts_enabled;

    return res.status(200).json({
      success: true,
      connected: fullyOnboarded,
      status: fullyOnboarded ? 'active' : 'pending',
      stripeAccountId: existing.stripeAccountId,
      details: {
        details_submitted: account.details_submitted,
        payouts_enabled: account.payouts_enabled,
        charges_enabled: account.charges_enabled,
        requirements_due: account.requirements?.currently_due ?? [],
        eventually_due: account.requirements?.eventually_due ?? [],
        disabled_reason: account.requirements?.disabled_reason ?? null,
      },
      message: fullyOnboarded
        ? 'Bank account active and ready'
        : 'Onboarding started — please complete your Stripe setup',
    });
  } catch (error) {
    console.error('Stripe status error:', error);
    return res.status(502).json({
      success: false,
      connected: false,
      status: 'error',
      message: 'Could not retrieve account status from Stripe',
    });
  }
});

// ── POST /api/bank-accounts/stripe/connect ─────────────────────────────────────
const startStripeOnboarding = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  let existing = await BankAccount.findOne({ driverId: userId, type: 'stripe_connect' });
  let stripeAccountId;

  if (!existing) {
    const account = await stripe.accounts.create({
      type: 'express',
      capabilities: { transfers: { requested: true } },
    });
    stripeAccountId = account.id;
    existing = await BankAccount.create({
      driverId: userId,
      type: 'stripe_connect',
      stripeAccountId,
      isPrimary: false,
    });
  } else {
    stripeAccountId = existing.stripeAccountId;
  }

  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${baseUrl}/driver/bank-account?stripe=refresh`,
    return_url: `${baseUrl}/driver/bank-account?stripe=success`,
    type: 'account_onboarding',
  });

  return res.status(200).json({
    success: true,
    onboardingUrl: accountLink.url,
    stripeAccountId,
  });
});

const getBankAccountStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const existing = await BankAccount.findOne({ driverId: userId, stripeAccountId: { $ne: null } });

  if (!existing) {
    return res.status(200).json({ hasBankAccount: false, message: "Driver has not started bank account setup" });
  }

  const account = await stripe.accounts.retrieve(existing.stripeAccountId);
  const isFullyOnboarded = account.details_submitted && account.payouts_enabled;

  return res.status(200).json({
    hasBankAccount: isFullyOnboarded,
    stripeAccountId: existing.stripeAccountId,
    status: {
      details_submitted: account.details_submitted,
      payouts_enabled: account.payouts_enabled,
      charges_enabled: account.charges_enabled,
      requirements: account.requirements,
    },
    message: isFullyOnboarded ? "Bank account fully connected" : "Bank account onboarding not completed yet",
  });
});

module.exports = {
  getPayoutMethods,
  addPayoutMethod,
  setPrimary,
  deletePayoutMethod,
  addBankAccount,
  checkBankAccount,
  getBankAccountStatus,
  getStripeStatus,
  startStripeOnboarding,
};
