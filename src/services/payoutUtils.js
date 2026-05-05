// services/payoutUtils.js

const TIER_PAYOUT_RATES = {
  'Diamond': 0.40,
  'Pro': 0.40,
  'S-Level': 0.30
};

const computePayoutCents = (booking, driver = null, settings = null) => {
  if (!booking?.finalPrice) return 0;

  const tier = driver?.driver?.tier || 'S-Level';
  const payoutRate = settings?.tiers?.[tier]?.payoutRate ?? TIER_PAYOUT_RATES[tier] ?? 0.30;
  const keepsBookingFee = settings?.tiers?.[tier]?.keepsBookingFee ?? (tier !== 'S-Level');
  const bookingFee = settings?.bookingFee ?? 34;

  const earningsFromFare = booking.finalPrice * payoutRate;
  const earningsFromFee = keepsBookingFee ? bookingFee : 0;

  return Math.round((earningsFromFare + earningsFromFee) * 100);
};

module.exports = { computePayoutCents };