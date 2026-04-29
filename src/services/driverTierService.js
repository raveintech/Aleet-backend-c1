// src/services/driverTierService.js
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

// Only connect when running as a standalone script
if (require.main === module) {
  connectDB();
}

const upgradeDriverTiers = async () => {
  console.log('🚀 Running Driver Tier Upgrade Service...');

  try {
    // ✅ Find all active drivers
    const drivers = await User.find({ role: 'driver', 'driver.status': 'approved' });

    console.log(`🧾 Found ${drivers.length} active drivers.`);

    for (const driver of drivers) {
      const d = driver.driver;
      let newTier = d.tier; // current tier

      // --- S-Level → Pro ---
      if (
        d.tier === 'S-Level' &&
        d.chauffeurLicenseNumber &&
        d.etiquetteTrainingCompleted
      ) {
        newTier = 'Pro';
      }

      // --- Pro → Diamond ---
      if (
        d.tier === 'Pro' &&
        d.completedTrips >= 100 &&
        d.noComplaints &&
        d.luxuryVehicleApproved &&
        d.diamondTrainingCompleted
      ) {
        newTier = 'Diamond';
      }

      // ✅ Update if tier has changed
      if (newTier !== d.tier) {
        console.log(`🔸 Upgrading driver ${driver._id} from ${d.tier} → ${newTier}`);
        d.tier = newTier;
        await driver.save();
      } else {
        console.log(`✅ Driver ${driver._id} already at correct tier: ${d.tier}`);
      }
    }

    console.log('✅ Driver Tier Upgrade Service completed.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error running Driver Tier Upgrade Service:', error);
    process.exit(1);
  }
};

// ✅ Run the service if this file is executed directly
if (require.main === module) {
  (async () => {
    await upgradeDriverTiers();
  })();
}

/**
 * Determine driver tier from onboarding fields:
 * S-Level = no own vehicle
 * Pro     = has own vehicle
 * Diamond = has own vehicle + has for-hire license
 */
const resolveDriverTier = ({ hasOwnVehicle, hasForHireLicense }) => {
  if (hasOwnVehicle && hasForHireLicense) return 'Diamond';
  if (hasOwnVehicle) return 'Pro';
  return 'S-Level';
};

module.exports = { upgradeDriverTiers, resolveDriverTier };
