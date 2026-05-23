/**
 * Admin audit log — append-only record of mutations that affect payout,
 * roles, finances, regions, or platform config.
 *
 * Immutability mechanism: capped collection (Mongo enforces append-only by
 * construction — no doc updates or deletes). Size cap is 64 MB which gives
 * ~640k entries at ~100 bytes/doc; tune `capSizeBytes` and `capMaxDocs` in
 * production if retention requirements (P2 #17) demand more.
 *
 * Categories: payout | role | financial | region | config | system
 */

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorEmail: { type: String, default: null },
    actorRole: { type: String, default: null },
    category: {
      type: String,
      enum: ['payout', 'role', 'financial', 'region', 'config', 'system'],
      required: true,
    },
    action: { type: String, required: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    requestId: { type: String, default: null },
    at: { type: Date, default: Date.now, index: true },
  },
  {
    capped: { size: 64 * 1024 * 1024, max: 640000 },
    versionKey: false,
  }
);

// Block updates and deletes at the application layer as defence-in-depth.
// Mongo enforces append-only via the capped flag; this catches accidental code.
auditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function () {
  throw new Error('AuditLog is append-only; updates are not permitted');
});
auditLogSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw new Error('AuditLog is append-only; deletes are not permitted');
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
