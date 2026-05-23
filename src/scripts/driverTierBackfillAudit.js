/**
 * T-2.1.3 — Driver-tier backfill audit script.
 *
 * Scans every driver and reports rows where the stored `driver.tier` does not
 * match the structural answer from `resolveDriverTier(hasOwnVehicle, hasForHireLicense)`.
 *
 * Policy per P0 B6 (admin-review queue): the script DOES NOT auto-correct.
 * It prints a report and writes an `AuditLog` entry per drift row so admins
 * can review and accept/reject each correction manually.
 *
 * Usage:
 *   node src/scripts/driverTierBackfillAudit.js           # report only
 *   node src/scripts/driverTierBackfillAudit.js --json    # JSON output
 *
 * Exit codes:
 *   0 — no drift
 *   1 — drift found (one or more rows need admin review)
 *   2 — script error
 */

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const logger = require('../utils/logger');
const { resolveDriverTier } = require('../services/driverTierService');
const { recordAudit } = require('../services/auditLogService');

const jsonMode = process.argv.includes('--json');

(async () => {
  let exitCode = 0;
  try {
    await connectDB();

    // Stream via cursor so the script does not OOM on a 100k+ driver table.
    const cursor = User.find({ role: 'driver' })
      .select('_id name email driver.tier driver.hasOwnVehicle driver.hasForHireLicense driver.status')
      .lean()
      .cursor();

    let totalDrivers = 0;
    const drift = [];

    for await (const d of cursor) {
      totalDrivers++;
      const expected = resolveDriverTier({
        hasOwnVehicle: d.driver?.hasOwnVehicle,
        hasForHireLicense: d.driver?.hasForHireLicense,
      });
      const stored = d.driver?.tier;
      if (stored !== expected) {
        drift.push({
          driverId: String(d._id),
          name: d.name,
          email: d.email,
          status: d.driver?.status,
          storedTier: stored,
          expectedTier: expected,
          hasOwnVehicle: !!d.driver?.hasOwnVehicle,
          hasForHireLicense: !!d.driver?.hasForHireLicense,
        });
      }
    }

    if (jsonMode) {
      process.stdout.write(JSON.stringify({ totalDrivers, driftCount: drift.length, drift }, null, 2) + '\n');
    } else {
      logger.info({ totalDrivers, driftCount: drift.length }, 'Driver-tier backfill audit complete');
      for (const row of drift) {
        logger.warn(row, 'Driver tier drift detected — admin review required');
      }
    }

    // Surface the drift to the audit log so the review-queue UI can read it
    // without re-running the script. Awaited so we don't disconnect mid-write.
    for (const row of drift) {
      await recordAudit({
        category: 'role',
        action: 'driver.tier.drift_detected',
        targetType: 'User',
        targetId: row.driverId,
        before: { tier: row.storedTier },
        after: { tier: row.expectedTier },
        metadata: {
          hasOwnVehicle: row.hasOwnVehicle,
          hasForHireLicense: row.hasForHireLicense,
          status: row.status,
          source: 'driverTierBackfillAudit',
        },
      });
    }

    exitCode = drift.length > 0 ? 1 : 0;
  } catch (err) {
    logger.error({ err }, 'driverTierBackfillAudit failed');
    exitCode = 2;
  } finally {
    // Always await disconnect — process.exit() alone can sever pending writes.
    try { await mongoose.disconnect(); } catch (_e) { /* ignore */ }
    process.exit(exitCode);
  }
})();
