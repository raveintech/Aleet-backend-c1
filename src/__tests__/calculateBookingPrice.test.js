/**
 * Spec-conformance tests for `utils/bookingHelpers.calculateBookingPrice`.
 *
 * Covers the plan-named scenarios that the initial Wave D pass missed:
 *   - Vehicle-type axis (Luxury Sedan $120 / Black SUV $150 / Sprinter $220)
 *   - Prepaid drawdown happens BEFORE overage charging
 *   - DST fall-back day late-night accounting
 *
 * All cases pass empty `addOns` so the AddOn.find DB read short-circuits and
 * the test runs without a Mongo connection.
 */

const { calculateBookingPrice } = require('../utils/bookingHelpers');
const { countLateNightHours } = require('../services/pricingHelpers');

const withFlag = (name, value, fn) => {
  const prev = process.env[`FEATURE_${name}`];
  process.env[`FEATURE_${name}`] = value ? '1' : '';
  try { return fn(); } finally {
    if (prev === undefined) delete process.env[`FEATURE_${name}`];
    else process.env[`FEATURE_${name}`] = prev;
  }
};

const VEHICLE = {
  LUXURY_SEDAN: { _id: 'luxury', name: 'Luxury Sedan', hourlyPrice: 120 },
  BLACK_SUV: { _id: 'suv', name: 'Black SUV', hourlyPrice: 150 },
  SPRINTER: { _id: 'sprinter', name: 'Sprinter', hourlyPrice: 220 },
};

describe('calculateBookingPrice — vehicle-type axis (standard rate matrix)', () => {
  const base = { quantity: 1, addOns: [], stops: [], isSubscriber: false, usedHours: 0, bookingHours: 4 };

  test('Luxury Sedan: $120/hr × 4h = $480 regular', async () => {
    const out = await calculateBookingPrice({ ...base, vehicleType: VEHICLE.LUXURY_SEDAN });
    expect(out.regularPrice).toBe(480);
  });

  test('Black SUV: $150/hr × 4h = $600 regular', async () => {
    const out = await calculateBookingPrice({ ...base, vehicleType: VEHICLE.BLACK_SUV });
    expect(out.regularPrice).toBe(600);
  });

  test('Sprinter: $220/hr × 4h = $880 regular', async () => {
    const out = await calculateBookingPrice({ ...base, vehicleType: VEHICLE.SPRINTER });
    expect(out.regularPrice).toBe(880);
  });

  test('Quantity multiplier scales linearly per vehicle type', async () => {
    const out = await calculateBookingPrice({
      ...base,
      vehicleType: VEHICLE.SPRINTER,
      quantity: 3,
    });
    // 220 × 4h × 3 = 2640
    expect(out.regularPrice).toBe(2640);
  });
});

describe('calculateBookingPrice — prepaid drawdown precedes overage (T-2.3.4 / T-2.3.5 order)', () => {
  const baseSub = {
    vehicleType: VEHICLE.LUXURY_SEDAN, // $120/hr
    quantity: 1,
    addOns: [],
    stops: [],
    isSubscriber: true,
  };

  test('Drawdown-only: prepaid balance covers the booking entirely (0 overage)', async () => {
    withFlag('PRICING_OVERAGE', true, () => {});
    process.env.FEATURE_PRICING_OVERAGE = '1';
    try {
      const out = await calculateBookingPrice({
        ...baseSub,
        usedHours: 0,
        bookingHours: 3,
        plan: 'Membership',
        hoursIncluded: 5,
      });
      // 3h fully covered by 5 included hours → subscriberPrice for hours = $0,
      // breakdown should record overageHours = 0 and freeHoursUsed = 3.
      expect(out.breakdown.freeHoursUsed).toBe(3);
      expect(out.breakdown.overageHours).toBe(0);
      expect(out.subscriberPrice).toBe(0);
    } finally {
      delete process.env.FEATURE_PRICING_OVERAGE;
    }
  });

  test('Partial drawdown then overage: drawdown happens FIRST', async () => {
    process.env.FEATURE_PRICING_OVERAGE = '1';
    try {
      const out = await calculateBookingPrice({
        ...baseSub,
        usedHours: 3,         // already burned 3 of 5
        bookingHours: 4,      // booking 4h
        plan: 'Membership',   // $89/hr overage
        hoursIncluded: 2,     // 5 - 3 remaining
      });
      // First 2h come from prepaid (free); remaining 2h billed at $89.
      expect(out.breakdown.freeHoursUsed).toBe(2);
      expect(out.breakdown.overageHours).toBe(2);
      expect(out.subscriberPrice).toBe(2 * 89);
    } finally {
      delete process.env.FEATURE_PRICING_OVERAGE;
    }
  });

  test('Allowance exhausted: all hours at member overage rate', async () => {
    process.env.FEATURE_PRICING_OVERAGE = '1';
    try {
      const out = await calculateBookingPrice({
        ...baseSub,
        usedHours: 5,
        bookingHours: 3,
        plan: 'Founder 30',
        hoursIncluded: 0,
      });
      expect(out.breakdown.freeHoursUsed).toBe(0);
      expect(out.breakdown.overageHours).toBe(3);
      // Founder 30 = $69/hr × 3 = $207
      expect(out.subscriberPrice).toBe(3 * 69);
    } finally {
      delete process.env.FEATURE_PRICING_OVERAGE;
    }
  });

  test('Legacy path (flag OFF): preserves 10%-off behaviour', async () => {
    // Explicitly leave flag unset
    const out = await calculateBookingPrice({
      ...baseSub,
      usedHours: 0,
      bookingHours: 4,
    });
    // bookingHelpers legacy: free 5h then 10% off. 4h fits in free, subscriberPrice = 0.
    expect(out.subscriberPrice).toBe(0);
  });
});

describe('countLateNightHours — DST fall-back seam', () => {
  // US DST 2026 fall-back: Sunday 2026-11-01 at 02:00 local clocks → 01:00.
  // The 01:00–02:00 hour repeats. America/New_York goes from EDT (UTC-4)
  // → EST (UTC-5) at 06:00 UTC. The whole [00, 09) window stays in late-night.

  test('Trip spanning the EDT→EST transition still counts all hours as late-night', () => {
    // 04:00 UTC → 10:00 UTC on fall-back day.
    // - 04 UTC (EDT) = 00 local (late-night)
    // - 05 UTC (EDT) = 01 local (late-night)
    // - 06 UTC (EST) = 01 local again (still late-night)
    // - 07 UTC (EST) = 02 local (late-night)
    // - 08 UTC (EST) = 03 local (late-night)
    // - 09 UTC (EST) = 04 local (late-night)
    // 6 hours total, all in [00, 09) local.
    const n = countLateNightHours(
      '2026-11-01T04:00:00Z',
      '2026-11-01T10:00:00Z',
      'America/New_York'
    );
    expect(n).toBe(6);
  });

  test('Trip ending just past 9 AM EST on fall-back day clips the in-window hours', () => {
    // 12:00 UTC (07:00 EST) → 16:00 UTC (11:00 EST).
    // Hours: 07 in, 08 in, 09 out, 10 out → 2 late-night hours.
    const n = countLateNightHours(
      '2026-11-01T12:00:00Z',
      '2026-11-01T16:00:00Z',
      'America/New_York'
    );
    expect(n).toBe(2);
  });
});
