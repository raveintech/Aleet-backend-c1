/**
 * Feature-flag wrapper — env-var-backed, single boolean per feature.
 *
 * Hard scope cap (per execution plan T-2.7.1):
 *   - No admin UI
 *   - No SDK
 *   - No per-user / per-cohort targeting
 *   - Every flag is a single env-var boolean
 *
 * To add a flag: add a row to FLAG_NAMES and read it via `isEnabled('NAME')`.
 * All new same-day, payout, and pricing behaviours ship OFF by default.
 */

const FLAG_NAMES = [
  // Payout / pricing
  'PAYOUT_S_TIER_DEDUCTION',       // T-2.3.2 — apply −$50 vehicle deduction to S-Tier payouts
  'PAYOUT_EXCLUDE_ADDONS',         // T-2.3.7 — subtract add-on revenue from tier-percentage base
  'PRICING_LATE_NIGHT_OVERRIDE',   // T-2.3.1 — 12 AM–9 AM city-local → standard pricing for members
  'PRICING_OVERAGE',               // T-2.3.5 — bill hours above prepaid allowance at member overage rate

  // Same-day engine
  'SAME_DAY_ENGINE',               // T-2.4.x — master switch for same-day capacity + dispatch
  'SAME_DAY_DISPATCH',             // T-2.4.6 — auto-dispatch (separately from capacity calc)
];

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

const isEnabled = (name) => {
  if (!FLAG_NAMES.includes(name)) {
    // Fail closed — a typo at a decision site should not crash the request.
    // Log once so the typo surfaces in logs instead of as a 500.
    if (!warnedUnknownFlags.has(name)) {
      warnedUnknownFlags.add(name);
      try {
        require('../utils/logger').warn({ name }, 'Unknown feature flag (returning false)');
      } catch (_err) { /* logger may not be ready during boot */ }
    }
    return false;
  }
  return truthy(process.env[`FEATURE_${name}`]);
};

const warnedUnknownFlags = new Set();

const snapshot = () => Object.fromEntries(FLAG_NAMES.map((n) => [n, isEnabled(n)]));

module.exports = { isEnabled, snapshot, FLAG_NAMES };
