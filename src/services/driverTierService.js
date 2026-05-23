// src/services/driverTierService.js

/**
 * Determine driver tier from onboarding fields:
 * S-Level = no own vehicle
 * Pro     = has own vehicle
 * Diamond = has own vehicle + has for-hire license
 *
 * Tier is structural, not performance-based — see phase2_notes.docx.
 * `resolveDriverTier` is the only legitimate writer of `driver.tier`.
 */
const resolveDriverTier = ({ hasOwnVehicle, hasForHireLicense }) => {
  if (hasOwnVehicle && hasForHireLicense) return 'Diamond';
  if (hasOwnVehicle) return 'Pro';
  return 'S-Level';
};

module.exports = { resolveDriverTier };
