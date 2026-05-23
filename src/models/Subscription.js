/**
 * Subscription — prepaid-hour ledger (T-2.3.4).
 *
 * Per P0 B5: one document per active subscription cycle per user. No proration
 * of unused hours on plan change (close current doc, open new). No refund of
 * unused hours on cancellation (doc remains active until cycleEnd, then
 * transitions to cancelled).
 *
 * Backwards compatibility: User.subscriptionDetails still tracks the active
 * plan summary, but the per-cycle balance lives here so reporting and audit
 * can replay cycle-by-cycle without rebuilding from booking history.
 */

const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: String, required: true }, // e.g. 'Membership', 'Founder 30'
    cycleStart: { type: Date, required: true },
    cycleEnd: { type: Date, required: true },
    hoursIncluded: { type: Number, required: true, default: 0 },
    hoursUsed: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ['active', 'cancelled', 'expired'],
      default: 'active',
      index: true,
    },
    priceCents: { type: Number, default: 0 },
    stripeSubscriptionId: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, status: 1, cycleEnd: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
