// src/services/availabilityService.js
// ---------------------------------------------------------------------------
// Same-day availability engine.
//
// Same-day booking for a region is ON only when:
//
//     AQD - RB - CL >= MCT
//
//   AQD = Active Qualified Drivers  — approved Diamond + approved Pro who
//                                     serve the region
//   RB  = Reserved Buffer          — 25% of AQD, rounded up, minimum 2
//   CL  = Committed Load           — distinct drivers already assigned to
//                                     active bookings with a same-day pickup
//   MCT = Minimum Coverage Threshold — 2 (1 primary + 1 backup)
//
// An admin can also force a region OFF via Region.sameDayManualBlock.
// ---------------------------------------------------------------------------

const User = require('../models/User');
const Booking = require('../models/Booking');
const Region = require('../models/Region');

const RB_RATIO = 0.25;                          // Reserved Buffer = 25% of AQD
const MIN_RB = 2;
const MCT = 2;                                  // 1 primary + 1 backup
const SAME_DAY_WINDOW_MS = 24 * 60 * 60 * 1000; // pickup within 24h = same-day

// Mongo filter for Active Qualified Drivers serving a region.
// Region binding is default-open: a driver serves everywhere unless
// serveAllRegions is explicitly false with a restricted regions list.
function qualifiedDriverFilter(regionId) {
  return {
    role: 'driver',
    'driver.status': 'approved',
    'driver.tier': { $in: ['Diamond', 'Pro'] },
    $or: [
      { 'driver.serveAllRegions': { $ne: false } },
      { 'driver.regions': regionId },
    ],
  };
}

/**
 * Compute the same-day availability breakdown for a region document.
 * @param {object} region  A Region mongoose doc (or lean object).
 * @returns {Promise<{aqd,rb,cl,mct,formulaPass,manualBlock,available}>}
 */
async function computeSameDayStatus(region) {
  const regionId = region._id;

  const [aqd, committedDrivers] = await Promise.all([
    User.countDocuments(qualifiedDriverFilter(regionId)),
    Booking.distinct('assignedDriver', {
      region: regionId,
      status: { $in: ['Confirmed', 'In Progress'] },
      assignedDriver: { $ne: null },
      'dates.startDate': {
        $gte: new Date(),
        $lte: new Date(Date.now() + SAME_DAY_WINDOW_MS),
      },
    }),
  ]);

  const cl = committedDrivers.length;
  const rb = Math.max(MIN_RB, Math.ceil(aqd * RB_RATIO));
  const mct = MCT;
  const formulaPass = aqd - rb - cl >= mct;
  const manualBlock = region.sameDayManualBlock === true;
  const available = region.isActive !== false && !manualBlock && formulaPass;

  return { aqd, rb, cl, mct, formulaPass, manualBlock, available };
}

/** Same-day status for one region by id. Returns null if the region is gone. */
async function getRegionSameDayStatus(regionId) {
  const region = await Region.findById(regionId);
  if (!region) return null;
  return computeSameDayStatus(region);
}

module.exports = {
  computeSameDayStatus,
  getRegionSameDayStatus,
  SAME_DAY_WINDOW_MS,
};
