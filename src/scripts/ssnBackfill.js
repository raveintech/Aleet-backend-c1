/**
 * Deploy 1b — re-encrypt existing plaintext SSN rows (T-1.1.1).
 *
 * Run AFTER Deploy 1a is live (new writes already encrypt). Iterates every
 * driver doc, decides whether `driver.ssn` is plaintext or encrypted via the
 * `enc:v1:` envelope prefix, re-encrypts plaintext rows in place, and skips
 * encrypted rows (idempotent — safe to re-run).
 *
 * Rows that fail to encrypt or save are surfaced to the admin queue
 * (`AuditLog` with category=`system`, action=`ssn.backfill.failed`) so
 * on-call eng can investigate without blocking the batch.
 *
 * Per the plan's Deploy 1b spec: failures are flagged, not dropped, and the
 * 1c read-side cutover (`STRICT_DECRYPT_ONLY=true`) must NOT be flipped
 * until this script's admin queue is empty.
 *
 * Usage:
 *   node src/scripts/ssnBackfill.js              # do the work
 *   node src/scripts/ssnBackfill.js --dry-run    # report only, no writes
 *   node src/scripts/ssnBackfill.js --json       # JSON summary on stdout
 *
 * Exit codes:
 *   0  — every plaintext row encrypted successfully
 *   1  — one or more rows failed to encrypt (admin queue populated)
 *   2  — script-level error
 */

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const logger = require('../utils/logger');
const cryptoService = require('../services/cryptoService');
const { recordAudit } = require('../services/auditLogService');

const dryRun = process.argv.includes('--dry-run');
const jsonMode = process.argv.includes('--json');

(async () => {
  let exitCode = 0;
  let scanned = 0;
  let alreadyEncrypted = 0;
  let encrypted = 0;
  let nullOrEmpty = 0;
  let failed = 0;
  const failures = [];

  try {
    await connectDB();

    // Boot-time SSN_ENCRYPTION_KEY check (cryptoService throws in production
    // if absent). In dev / test envs the user can still set it via .env.
    if (!process.env.SSN_ENCRYPTION_KEY) {
      throw new Error('SSN_ENCRYPTION_KEY is not set — refuse to run backfill');
    }

    // `+driver.ssn` overrides the schema's `select: false`. The cursor avoids
    // loading every driver into memory.
    const cursor = User.find({ role: 'driver' })
      .select('+driver.ssn')
      .cursor();

    for await (const doc of cursor) {
      scanned++;
      const current = doc.driver?.ssn;

      if (!current) {
        nullOrEmpty++;
        continue;
      }
      if (cryptoService.isEncrypted(current)) {
        alreadyEncrypted++;
        continue;
      }

      // Plaintext row — re-encrypt. We bypass the schema setter and call
      // cryptoService.encrypt directly so we can capture per-row failures
      // instead of letting one bad row crash the batch.
      try {
        const ciphertext = cryptoService.encrypt(current);

        if (!dryRun) {
          // $set bypasses the schema setter — exactly what we want here:
          // the value is already the ciphertext envelope, and going through
          // the setter would no-op via the idempotency guard. $set is also
          // cheaper than .save() since it skips full doc validation.
          await User.updateOne(
            { _id: doc._id },
            { $set: { 'driver.ssn': ciphertext } }
          );
        }
        encrypted++;
      } catch (err) {
        failed++;
        const failureRow = {
          driverId: String(doc._id),
          email: doc.email,
          error: err.message,
        };
        failures.push(failureRow);
        if (!dryRun) {
          await recordAudit({
            category: 'system',
            action: 'ssn.backfill.failed',
            targetType: 'User',
            targetId: doc._id,
            metadata: { email: doc.email, error: err.message, source: 'ssnBackfill' },
          });
        }
      }
    }

    const summary = { scanned, alreadyEncrypted, encrypted, nullOrEmpty, failed, dryRun };

    if (jsonMode) {
      process.stdout.write(JSON.stringify({ ...summary, failures }, null, 2) + '\n');
    } else {
      logger.info(summary, 'SSN backfill complete');
      for (const f of failures) {
        logger.error(f, 'SSN backfill failure');
      }
    }

    // Also write a single audit-log entry summarizing the batch so ops has a
    // queryable record of every run (regardless of failure count).
    if (!dryRun) {
      await recordAudit({
        category: 'system',
        action: 'ssn.backfill.batch_complete',
        targetType: 'User',
        targetId: null,
        metadata: summary,
      });
    }

    exitCode = failed > 0 ? 1 : 0;
  } catch (err) {
    logger.error({ err }, 'ssnBackfill failed at script level');
    exitCode = 2;
  } finally {
    try { await mongoose.disconnect(); } catch (_e) { /* ignore */ }
    process.exit(exitCode);
  }
})();
