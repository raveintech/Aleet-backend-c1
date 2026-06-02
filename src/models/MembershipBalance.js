const mongoose = require('mongoose');

/**
 * MembershipBalance
 * ---------------------------------------------------------------------------
 * Quarterly prepaid driving-hour pool for members.
 *
 * Membership = prepaid hours (NOT a discount). A member prepays a quarter of
 * hours (5 hrs/month × 3 = 15 by default); those hours are consumed as rides
 * occur. Hours within the pool cost $0 at checkout; hours beyond the pool are
 * overage, billed at the locked member rate ($89 / $69).
 *
 * Lives ALONGSIDE the legacy MonthlyHours model (which is retained for
 * month-level reporting) — this is the authoritative prepaid balance.
 */
const membershipBalanceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  year: { type: Number, required: true },                 // e.g. 2026
  quarter: { type: Number, required: true, min: 1, max: 4 }, // 1–4
  hoursIncluded: { type: Number, default: 15 },           // prepaid hours for the quarter
  hoursUsed: { type: Number, default: 0 },                // prepaid hours consumed so far
}, { timestamps: true });

// One pool per user per quarter.
membershipBalanceSchema.index({ user: 1, year: 1, quarter: 1 }, { unique: true });

/**
 * Map a date to its calendar quarter.
 * @param {Date|string|number} date
 * @returns {{ year: number, quarter: number }}
 */
membershipBalanceSchema.statics.quarterOf = function (date) {
  const d = new Date(date);
  return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 };
};

module.exports = mongoose.model('MembershipBalance', membershipBalanceSchema);
