/**
 * Audit log helper — fire-and-forget writes for admin mutations.
 *
 * Writes never block the caller and never throw; they log structured errors
 * if the write fails so ops can investigate without affecting the mutation
 * that triggered the audit entry.
 *
 * Per-category payload contract:
 *   - `config`  / `region` / `role` (state-diff categories):
 *       MUST include both `before` and `after` so reviewers can reconstruct
 *       what changed and reverse it if needed.
 *   - `payout` / `financial` / `system` (event categories):
 *       `before` / `after` are typically null; the relevant context lives in
 *       `metadata` (transfer ID, amount cents, tier, etc.). The event is the
 *       record — there is no "previous state" to compare.
 *
 * Usage:
 *   await recordAudit({
 *     req, category: 'config', action: 'tier_settings.update',
 *     targetType: 'TierSettings', targetId: doc._id,
 *     before, after, metadata: { reason }
 *   });
 */

const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

const recordAudit = async ({
  req = null,
  actor = null,
  category,
  action,
  targetType = null,
  targetId = null,
  before = null,
  after = null,
  metadata = null,
}) => {
  try {
    const resolvedActor = actor || req?.user || null;
    await AuditLog.create({
      actorId: resolvedActor?._id || null,
      actorEmail: resolvedActor?.email || null,
      actorRole: resolvedActor?.role || null,
      category,
      action,
      targetType,
      targetId: targetId ? String(targetId) : null,
      before,
      after,
      metadata,
      requestId: req?.id || null,
    });
  } catch (err) {
    (req?.log || logger).error(
      { err, category, action, targetType, targetId },
      'Failed to write audit log entry',
    );
  }
};

module.exports = { recordAudit };
