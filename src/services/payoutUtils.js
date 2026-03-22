// services/payoutUtils.js

/**
 * 🧮 Compute how much should be paid out to the driver
 * For simplicity, let's assume:
 * - booking.totalAmount is in dollars
 * - Driver gets 80% payout
 * - Stripe amount must be in cents
 */
const computePayoutCents = (booking) => {
  if (!booking?.totalAmount) return 0;

  const driverShare = 0.8; // 80% — you can make this dynamic later
  const amount = booking.totalAmount * driverShare;
  return Math.round(amount * 100); // Convert dollars → cents
};

module.exports = {
  computePayoutCents,
};
