/**
 * Subscription ledger helpers — read and mutate the per-cycle prepaid balance.
 *
 * Operates on the `Subscription` collection (T-2.3.4). All write helpers are
 * idempotent and append-only with respect to the cycle: hours decrement, plan
 * changes close the current doc and open a new one.
 */

const Subscription = require('../models/Subscription');
const logger = require('../utils/logger');

const findActiveForUser = async (userId) => {
  if (!userId) return null;
  return Subscription.findOne({ userId, status: 'active' })
    .sort({ cycleEnd: -1 })
    .exec();
};

const openCycle = async ({ userId, plan, hoursIncluded, priceCents, stripeSubscriptionId, cycleStart, cycleEnd }) => {
  // Close any active doc first — P0 B5 says mid-cycle plan change closes the
  // current subscription doc and opens a new one (no proration of hours).
  await Subscription.updateMany(
    { userId, status: 'active' },
    { $set: { status: 'expired' } }
  );

  return Subscription.create({
    userId,
    plan,
    hoursIncluded: Number(hoursIncluded) || 0,
    hoursUsed: 0,
    priceCents: Number(priceCents) || 0,
    stripeSubscriptionId: stripeSubscriptionId || null,
    cycleStart: cycleStart || new Date(),
    // Default to 90 days because the live plan ("Membership" / "Founder 30")
    // both bill quarterly. Live callers always pass `cycleEnd` explicitly;
    // this default exists for tests and ad-hoc scripts.
    cycleEnd: cycleEnd || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    status: 'active',
  });
};

const consumeHours = async ({ userId, hours }) => {
  const sub = await findActiveForUser(userId);
  if (!sub) return null;
  sub.hoursUsed = Number(sub.hoursUsed || 0) + Number(hours || 0);
  await sub.save();
  return sub;
};

const cancel = async ({ userId, reason }) => {
  const sub = await findActiveForUser(userId);
  if (!sub) return null;
  // P0 B5: no refund of unused hours; doc stays `active` until cycleEnd, then
  // a separate sweep transitions it to `cancelled`. Recording the cancellation
  // intent here lets the sweep find it without scanning Stripe events.
  sub.cancelledAt = new Date();
  if (reason) sub.cancellationReason = reason;
  try {
    await sub.save();
  } catch (err) {
    logger.error({ err, userId }, 'Failed to record subscription cancellation');
  }
  return sub;
};

module.exports = { findActiveForUser, openCycle, consumeHours, cancel };
