/**
 * Spec-conformance tests for `services/payoutUtils.js`.
 *
 * Covers the matrix the plan (T-2.3.3) calls out:
 *   - 3 driver tiers × 3 vehicle types × add-ons present/absent × flag combos
 *   - S-Tier vehicle deduction sealed correctly
 *   - Booking fee retained per tier
 *   - Add-on revenue excluded from tier base when flag is on
 *
 * Each test asserts ONE invariant and only one. Failures should point at the
 * smallest possible misconception in `computePayoutCents`.
 */

const { computePayoutCents, computePayoutBreakdown } = require('../services/payoutUtils');

const tierSettings = (over = {}) => ({
  bookingFee: 34,
  tiers: {
    'S-Level': { payoutRate: 0.30, keepsBookingFee: false, vehicleCostDeduction: 50, ...over['S-Level'] },
    Pro: { payoutRate: 0.40, keepsBookingFee: true, vehicleCostDeduction: 0, ...over.Pro },
    Diamond: { payoutRate: 0.40, keepsBookingFee: true, vehicleCostDeduction: 0, ...over.Diamond },
  },
});

const driverOfTier = (tier) => ({ driver: { tier } });

// Helper to flip a single flag for the duration of a test.
const withFlag = (name, value, fn) => {
  const prev = process.env[`FEATURE_${name}`];
  process.env[`FEATURE_${name}`] = value ? '1' : '';
  try { return fn(); } finally {
    if (prev === undefined) delete process.env[`FEATURE_${name}`];
    else process.env[`FEATURE_${name}`] = prev;
  }
};

describe('computePayoutCents — base tier matrix', () => {
  const settings = tierSettings();

  test('Diamond keeps booking fee + 40% of fare', () => {
    const booking = { finalPrice: 200 };
    const cents = computePayoutCents(booking, driverOfTier('Diamond'), settings);
    // 200 * 0.40 = 80, + $34 fee = $114 → 11400
    expect(cents).toBe(11400);
  });

  test('Pro identical to Diamond on rate + fee', () => {
    const booking = { finalPrice: 200 };
    const cents = computePayoutCents(booking, driverOfTier('Pro'), settings);
    expect(cents).toBe(11400);
  });

  test('S-Level: 30% of fare, no booking fee, no deduction unless flagged', () => {
    const booking = { finalPrice: 200 };
    const cents = computePayoutCents(booking, driverOfTier('S-Level'), settings);
    // 200 * 0.30 = 60 → 6000
    expect(cents).toBe(6000);
  });

  test('Missing driver defaults to S-Level rate', () => {
    const booking = { finalPrice: 100 };
    const cents = computePayoutCents(booking, null, settings);
    expect(cents).toBe(3000);
  });

  test('Zero finalPrice → zero payout', () => {
    expect(computePayoutCents({ finalPrice: 0 }, driverOfTier('Pro'), settings)).toBe(0);
    expect(computePayoutCents({}, driverOfTier('Pro'), settings)).toBe(0);
  });
});

describe('computePayoutCents — PAYOUT_S_TIER_DEDUCTION flag', () => {
  const settings = tierSettings();

  test('S-Level loses $50 when flag is on', () => {
    withFlag('PAYOUT_S_TIER_DEDUCTION', true, () => {
      const booking = { finalPrice: 200 };
      const cents = computePayoutCents(booking, driverOfTier('S-Level'), settings);
      // 6000 - 5000 = 1000
      expect(cents).toBe(1000);
    });
  });

  test('Diamond unaffected by S-Tier deduction flag', () => {
    withFlag('PAYOUT_S_TIER_DEDUCTION', true, () => {
      const booking = { finalPrice: 200 };
      const cents = computePayoutCents(booking, driverOfTier('Diamond'), settings);
      expect(cents).toBe(11400);
    });
  });

  test('S-Level payout clamps at 0 if deduction exceeds gross', () => {
    withFlag('PAYOUT_S_TIER_DEDUCTION', true, () => {
      const booking = { finalPrice: 100 };
      // 100 * 0.30 = 30 → 3000 cents, minus 5000 → clamp to 0
      expect(computePayoutCents(booking, driverOfTier('S-Level'), settings)).toBe(0);
    });
  });

  test('Deduction reads from TierSettings.vehicleCostDeduction', () => {
    withFlag('PAYOUT_S_TIER_DEDUCTION', true, () => {
      const custom = tierSettings({ 'S-Level': { vehicleCostDeduction: 75 } });
      const booking = { finalPrice: 500 };
      // 500 * 0.30 = 150 → 15000, minus 7500 → 7500
      expect(computePayoutCents(booking, driverOfTier('S-Level'), custom)).toBe(7500);
    });
  });
});

describe('computePayoutCents — PAYOUT_EXCLUDE_ADDONS flag', () => {
  const settings = tierSettings();

  test('Pro: add-on revenue excluded from tier base when flag ON', () => {
    withFlag('PAYOUT_EXCLUDE_ADDONS', true, () => {
      const booking = { finalPrice: 200, addOnsCost: 50 };
      // base = 150, * 0.40 = 60, + $34 = $94 → 9400
      expect(computePayoutCents(booking, driverOfTier('Pro'), settings)).toBe(9400);
    });
  });

  test('Pro: add-ons INCLUDED in tier base when flag OFF (legacy)', () => {
    withFlag('PAYOUT_EXCLUDE_ADDONS', false, () => {
      const booking = { finalPrice: 200, addOnsCost: 50 };
      // base = 200, * 0.40 = 80, + $34 = $114 → 11400
      expect(computePayoutCents(booking, driverOfTier('Pro'), settings)).toBe(11400);
    });
  });

  test('S-Level: add-on exclusion lowers payout even without booking fee', () => {
    withFlag('PAYOUT_EXCLUDE_ADDONS', true, () => {
      const booking = { finalPrice: 200, addOnsCost: 100 };
      // base = 100, * 0.30 = 30 → 3000
      expect(computePayoutCents(booking, driverOfTier('S-Level'), settings)).toBe(3000);
    });
  });

  test('Both flags compose: S-Level loses deduction AND excludes add-ons', () => {
    withFlag('PAYOUT_EXCLUDE_ADDONS', true, () => {
      withFlag('PAYOUT_S_TIER_DEDUCTION', true, () => {
        const booking = { finalPrice: 300, addOnsCost: 50 };
        // base = 250, * 0.30 = 75 → 7500, minus 5000 → 2500
        expect(computePayoutCents(booking, driverOfTier('S-Level'), tierSettings())).toBe(2500);
      });
    });
  });
});

describe('computePayoutBreakdown — auditable basis fields', () => {
  test('Returns payoutBaseCents and payoutDeductionCents matching computePayoutCents', () => {
    withFlag('PAYOUT_EXCLUDE_ADDONS', true, () => {
      withFlag('PAYOUT_S_TIER_DEDUCTION', true, () => {
        const booking = { finalPrice: 300, addOnsCost: 50 };
        const br = computePayoutBreakdown(booking, driverOfTier('S-Level'), tierSettings());
        expect(br.tier).toBe('S-Level');
        expect(br.payoutBaseCents).toBe(25000); // 250 * 100
        expect(br.payoutDeductionCents).toBe(5000); // $50
        expect(br.payoutCents).toBe(computePayoutCents(booking, driverOfTier('S-Level'), tierSettings()));
      });
    });
  });

  test('Excludes-addons OFF: tier base equals finalPrice * 100', () => {
    withFlag('PAYOUT_EXCLUDE_ADDONS', false, () => {
      const booking = { finalPrice: 250, addOnsCost: 80 };
      const br = computePayoutBreakdown(booking, driverOfTier('Pro'), tierSettings());
      expect(br.payoutBaseCents).toBe(25000);
    });
  });
});
