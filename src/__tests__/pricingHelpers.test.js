/**
 * Spec-conformance tests for `services/pricingHelpers.js`.
 *
 * Covers late-night override (city-local [00, 09)) and overage rate lookup.
 */

const {
  PLAN_OVERAGE_RATES,
  cityLocalHour,
  countLateNightHours,
  getOverageRate,
} = require('../services/pricingHelpers');

describe('getOverageRate', () => {
  test('Membership returns $89/hr', () => expect(getOverageRate('Membership')).toBe(89));
  test('Founder 30 returns $69/hr', () => expect(getOverageRate('Founder 30')).toBe(69));
  test('Unknown plan returns null', () => expect(getOverageRate('Free')).toBeNull());
  test('Null plan returns null', () => expect(getOverageRate(null)).toBeNull());

  test('PLAN_OVERAGE_RATES carries exactly the two MVP plans', () => {
    expect(Object.keys(PLAN_OVERAGE_RATES).sort()).toEqual(['Founder 30', 'Membership']);
  });
});

describe('cityLocalHour — IANA timezone handling', () => {
  test('Falls back to UTC when no timezone supplied', () => {
    expect(cityLocalHour('2026-06-15T03:00:00Z')).toBe(3);
  });

  test('America/New_York is UTC-4 in summer (EDT)', () => {
    // 2026-06-15T05:00:00Z → 01:00 EDT
    expect(cityLocalHour('2026-06-15T05:00:00Z', 'America/New_York')).toBe(1);
  });

  test('America/New_York is UTC-5 in winter (EST)', () => {
    // 2026-01-15T05:00:00Z → 00:00 EST
    expect(cityLocalHour('2026-01-15T05:00:00Z', 'America/New_York')).toBe(0);
  });

  test('Invalid timezone falls back to UTC, does not throw', () => {
    expect(cityLocalHour('2026-06-15T03:00:00Z', 'Bogus/Zone')).toBe(3);
  });
});

describe('countLateNightHours — [00, 09) city-local', () => {
  test('Trip wholly in late-night window counts every hour', () => {
    // 2026-06-15 00:00 EDT → 04:00 EDT = 4 hours, all late-night
    const n = countLateNightHours('2026-06-15T04:00:00Z', '2026-06-15T08:00:00Z', 'America/New_York');
    expect(n).toBe(4);
  });

  test('Trip wholly outside the window returns 0', () => {
    // 2026-06-15 14:00 EDT → 18:00 EDT
    const n = countLateNightHours('2026-06-15T18:00:00Z', '2026-06-15T22:00:00Z', 'America/New_York');
    expect(n).toBe(0);
  });

  test('Crossing the 9 AM boundary counts only the in-window hours', () => {
    // 07:00 EDT → 11:00 EDT: 07, 08 in window (2), 09, 10 out (0). Total = 2.
    const n = countLateNightHours('2026-06-15T11:00:00Z', '2026-06-15T15:00:00Z', 'America/New_York');
    expect(n).toBe(2);
  });

  test('Crossing the midnight boundary works in either direction', () => {
    // 23:00 EDT prior day → 02:00 EDT = 3h, with hour 23 out, 00 + 01 in. Total 2.
    const n = countLateNightHours('2026-06-15T03:00:00Z', '2026-06-15T06:00:00Z', 'America/New_York');
    expect(n).toBe(2);
  });

  test('Empty / invalid ranges return 0 without throwing', () => {
    expect(countLateNightHours(null, null)).toBe(0);
    expect(countLateNightHours('2026-06-15T10:00:00Z', '2026-06-15T10:00:00Z')).toBe(0);
    expect(countLateNightHours('2026-06-15T11:00:00Z', '2026-06-15T10:00:00Z')).toBe(0);
  });
});
