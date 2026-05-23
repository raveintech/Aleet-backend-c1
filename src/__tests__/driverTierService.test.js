/**
 * Spec-conformance tests for `services/driverTierService.js`.
 *
 * Tier is STRUCTURAL, not performance-based (phase2_notes.docx). The matrix
 * of (hasOwnVehicle, hasForHireLicense) → tier is the only contract.
 */

const { resolveDriverTier } = require('../services/driverTierService');

describe('resolveDriverTier — structural tier matrix', () => {
  test('(true, true) → Diamond', () => {
    expect(resolveDriverTier({ hasOwnVehicle: true, hasForHireLicense: true })).toBe('Diamond');
  });

  test('(true, false) → Pro', () => {
    expect(resolveDriverTier({ hasOwnVehicle: true, hasForHireLicense: false })).toBe('Pro');
  });

  test('(false, true) → S-Level (no vehicle, license irrelevant)', () => {
    expect(resolveDriverTier({ hasOwnVehicle: false, hasForHireLicense: true })).toBe('S-Level');
  });

  test('(false, false) → S-Level', () => {
    expect(resolveDriverTier({ hasOwnVehicle: false, hasForHireLicense: false })).toBe('S-Level');
  });

  test('Missing fields default to S-Level', () => {
    expect(resolveDriverTier({})).toBe('S-Level');
  });
});
