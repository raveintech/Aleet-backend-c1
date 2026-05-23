// services/payoutUtils.js
//
// Driver payout computation. Pure function over (booking, driver, settings) so
// it can run at quote time, dashboard render, and final payout sealing without
// hitting the database.
//
// Two behaviours are gated behind feature flags so they can be rolled out
// independently of the code that introduces them (phase2_notes.docx §134-135):
//   - PAYOUT_EXCLUDE_ADDONS (T-2.3.7) — add-on revenue is 100% platform; the
//     tier rate applies only to fare hours, not to add-on dollars.
//   - PAYOUT_S_TIER_DEDUCTION (T-2.3.2) — S-Tier drivers absorb a per-trip
//     vehicle/equipment deduction; default $50 unless TierSettings overrides.

const { isEnabled } = require('../config/featureFlags');

const TIER_PAYOUT_RATES = {
  Diamond: 0.40,
  Pro: 0.40,
  'S-Level': 0.30,
};

const DEFAULT_BOOKING_FEE = 34;
const DEFAULT_S_TIER_DEDUCTION = 50;

const computePayoutCents = (booking, driver = null, settings = null) => {
  if (!booking?.finalPrice) return 0;

  const tier = driver?.driver?.tier || 'S-Level';
  const payoutRate = settings?.tiers?.[tier]?.payoutRate ?? TIER_PAYOUT_RATES[tier] ?? 0.30;
  const keepsBookingFee = settings?.tiers?.[tier]?.keepsBookingFee ?? (tier !== 'S-Level');
  const bookingFee = settings?.bookingFee ?? DEFAULT_BOOKING_FEE;

  const excludeAddons = isEnabled('PAYOUT_EXCLUDE_ADDONS');
  const addOnsCost = Number(booking.addOnsCost || 0);
  const tierRateBase = excludeAddons
    ? Math.max(0, Number(booking.finalPrice) - addOnsCost)
    : Number(booking.finalPrice);

  const earningsFromFare = tierRateBase * payoutRate;
  const earningsFromFee = keepsBookingFee ? bookingFee : 0;

  let deductionCents = 0;
  if (isEnabled('PAYOUT_S_TIER_DEDUCTION') && tier === 'S-Level') {
    const configured = settings?.tiers?.[tier]?.vehicleCostDeduction;
    const deduction = (typeof configured === 'number' && configured >= 0)
      ? configured
      : DEFAULT_S_TIER_DEDUCTION;
    deductionCents = Math.round(deduction * 100);
  }

  const grossCents = Math.round((earningsFromFare + earningsFromFee) * 100);
  return Math.max(0, grossCents - deductionCents);
};

const computePayoutBreakdown = (booking, driver = null, settings = null) => {
  const tier = driver?.driver?.tier || 'S-Level';
  const payoutRate = settings?.tiers?.[tier]?.payoutRate ?? TIER_PAYOUT_RATES[tier] ?? 0.30;
  const keepsBookingFee = settings?.tiers?.[tier]?.keepsBookingFee ?? (tier !== 'S-Level');
  const bookingFee = settings?.bookingFee ?? DEFAULT_BOOKING_FEE;
  const addOnsCost = Number(booking.addOnsCost || 0);
  const excludeAddons = isEnabled('PAYOUT_EXCLUDE_ADDONS');
  const tierRateBase = excludeAddons
    ? Math.max(0, Number(booking.finalPrice || 0) - addOnsCost)
    : Number(booking.finalPrice || 0);

  let deductionCents = 0;
  if (isEnabled('PAYOUT_S_TIER_DEDUCTION') && tier === 'S-Level') {
    const configured = settings?.tiers?.[tier]?.vehicleCostDeduction;
    const deduction = (typeof configured === 'number' && configured >= 0)
      ? configured
      : DEFAULT_S_TIER_DEDUCTION;
    deductionCents = Math.round(deduction * 100);
  }

  return {
    tier,
    payoutRate,
    keepsBookingFee,
    bookingFee,
    addOnsCost,
    excludeAddons,
    payoutBaseCents: Math.round(tierRateBase * 100),
    payoutDeductionCents: deductionCents,
    payoutCents: computePayoutCents(booking, driver, settings),
  };
};

module.exports = { computePayoutCents, computePayoutBreakdown };
