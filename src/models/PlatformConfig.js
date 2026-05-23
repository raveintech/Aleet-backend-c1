/**
 * PlatformConfig — singleton bag for cross-cutting tunables that don't fit
 * elsewhere. Today holds same-day engine parameters; extend as more global
 * tunables surface.
 *
 * Access via the helper `services/platformConfigService.getConfig()` so
 * callers see a populated doc even on a fresh database.
 */

const mongoose = require('mongoose');

const platformConfigSchema = new mongoose.Schema(
  {
    sameDayParams: {
      // Reserved buffer as a fraction of AQD (P0 A2 default 0.225 = midpoint of
      // the 20-25% spec range).
      RBPercent: { type: Number, default: 0.225 },
      // Minimum reserved buffer; spec says "min 2".
      RBMin: { type: Number, default: 2 },
      // Minimum coverage threshold; spec says 2 (1 primary + 1 backup).
      MCTMin: { type: Number, default: 2 },
      // Same-day requires this many hours of notice.
      noticeHours: { type: Number, default: 3 },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PlatformConfig', platformConfigSchema);
