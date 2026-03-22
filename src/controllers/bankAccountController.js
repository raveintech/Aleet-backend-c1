require('dotenv').config();               // <-- load env FIRST

const asyncHandler = require("express-async-handler");
const BankAccount = require("../models/BankAccount.js");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const addBankAccount = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  let existing = await BankAccount.findOne({ driverId: userId });

  let stripeAccountId;

  if (!existing) {
    const account = await stripe.accounts.create({
      type: "express",
      capabilities: {
        transfers: { requested: true },
      },
    });

    stripeAccountId = account.id;

    existing = await BankAccount.create({
      driverId: userId,
      stripeAccountId
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



const checkBankAccount = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // 1️⃣ Check in DB if bank account exists
  const existing = await BankAccount.findOne({ driverId: userId });

  if (!existing) {
    return res.status(200).json({
      hasBankAccount: false,
      message: "Driver has not added a bank account",
    });
  }

  try {
    // 2️⃣ Retrieve account details from Stripe
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
      message: isFullyOnboarded
        ? "Driver's bank account is fully connected"
        : "Driver started onboarding but hasn't completed it yet",
    });
    // return res.status(200).json({
    //   hasBankAccount: isFullyOnboarded,
    //   stripeAccountId: existing.stripeAccountId,
    //   status: {
    //     details_submitted: account.details_submitted,
    //     payouts_enabled: account.payouts_enabled,
    //     charges_enabled: account.charges_enabled,
    //     requirements: account.requirements,
    //   },
    //   message: isFullyOnboarded
    //     ? "Driver's bank account is fully connected"
    //     : "Driver started onboarding but hasn't completed it yet",
    // });

  } catch (error) {
    console.error("Stripe account retrieve error:", error);
    return res.status(500).json({
      hasBankAccount: false,
      message: "Failed to verify bank account with Stripe",
      error: error.message,
    });
  }
});



const getBankAccountStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const existing = await BankAccount.findOne({ driverId: userId });

  if (!existing) {
    return res.status(200).json({
      hasBankAccount: false,
      message: "Driver has not started bank account setup",
    });
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
    message: isFullyOnboarded
      ? "Bank account fully connected"
      : "Bank account onboarding not completed yet",
  });
});


module.exports = {
  addBankAccount,
  checkBankAccount,
  getBankAccountStatus
};