/**
 * Subscription cycle-sweep job.
 *
 * Transitions Subscription docs from `active → cancelled` when:
 *   - `cancelledAt` is set AND `cycleEnd` has passed (user cancelled mid-cycle;
 *     retains access until cycleEnd per P0 B5)
 *   - OR `cancelledAt` is null but `cycleEnd` has passed AND no successor
 *     subscription exists for the user (the recurring renewal never landed)
 *
 * Also transitions to `expired` when `cycleEnd` has passed but the user has a
 * new active cycle (mid-cycle plan change closed the old doc).
 *
 * Run on a cron (recommended: hourly). Designed to be idempotent and safe to
 * re-run.
 *
 * Usage:
 *   node src/scripts/subscriptionCycleSweep.js           # process and exit
 *   node src/scripts/subscriptionCycleSweep.js --dry-run # report only
 */

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Subscription = require('../models/Subscription');
const logger = require('../utils/logger');
const { recordAudit } = require('../services/auditLogService');

const dryRun = process.argv.includes('--dry-run');

(async () => {
  let exitCode = 0;
  try {
    await connectDB();

    const now = new Date();
    const expired = await Subscription.find({
      status: 'active',
      cycleEnd: { $lt: now },
    });

    let cancelledCount = 0;
    let expiredCount = 0;

    for (const sub of expired) {
      // Successor must be ACTIVE — a cancelled/expired successor doesn't
      // demonstrate a live plan change and so shouldn't push this doc to the
      // `expired` bucket. The two semantic cases this disambiguates:
      //   - user cancelled mid-cycle, no new plan → cancelled
      //   - renewal landed (new active cycle exists) → expired
      const hasActiveSuccessor = !!(await Subscription.findOne({
        userId: sub.userId,
        _id: { $ne: sub._id },
        status: 'active',
        cycleStart: { $gte: sub.cycleEnd },
      }));

      const userCancelled = !!sub.cancelledAt;
      const targetStatus = (userCancelled || !hasActiveSuccessor) ? 'cancelled' : 'expired';

      if (dryRun) {
        logger.info(
          { subscriptionId: String(sub._id), userId: String(sub.userId), targetStatus, cycleEnd: sub.cycleEnd, userCancelled, hasActiveSuccessor },
          'Cycle-sweep dry-run: would transition'
        );
      } else {
        const before = { status: sub.status };
        sub.status = targetStatus;
        await sub.save();
        await recordAudit({
          category: 'config',
          action: `subscription.cycle.${targetStatus}`,
          targetType: 'Subscription',
          targetId: sub._id,
          before,
          after: { status: targetStatus },
          metadata: {
            userId: String(sub.userId),
            cycleEnd: sub.cycleEnd,
            cancelledAt: sub.cancelledAt,
            hasActiveSuccessor,
            source: 'subscriptionCycleSweep',
          },
        });
      }

      if (targetStatus === 'cancelled') cancelledCount++;
      else expiredCount++;
    }

    logger.info(
      { totalExpired: expired.length, cancelledCount, expiredCount, dryRun },
      'Subscription cycle sweep complete'
    );
  } catch (err) {
    logger.error({ err }, 'subscriptionCycleSweep failed');
    exitCode = 1;
  } finally {
    try { await mongoose.disconnect(); } catch (_e) { /* ignore */ }
    process.exit(exitCode);
  }
})();
