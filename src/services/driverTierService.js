// src/services/driverTierService.js
// ---------------------------------------------------------------------------
// Driver tier is STRUCTURAL, not performance-based. A driver's tier is
// determined solely by what they bring to the platform:
//
//   S-Level = no personal vehicle (uses an Aleet-provided vehicle)
//   Pro     = owns an approved personal vehicle
//   Diamond = owns a vehicle + holds a valid for-hire license
//
// Tier never changes from ratings, trip counts, or training. The old
// performance-based upgrader was removed for this reason.
// ---------------------------------------------------------------------------

/**
 * Resolve a driver's tier from their onboarding attributes.
 * @param {{ hasOwnVehicle: boolean, hasForHireLicense: boolean }} attrs
 * @returns {'S-Level'|'Pro'|'Diamond'}
 */
const resolveDriverTier = ({ hasOwnVehicle, hasForHireLicense }) => {
  if (hasOwnVehicle && hasForHireLicense) return 'Diamond';
  if (hasOwnVehicle) return 'Pro';
  return 'S-Level';
};

module.exports = { resolveDriverTier };
