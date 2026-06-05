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
const TierSettings = require('../models/TierSettings');

const SAME_DAY_WINDOW_MS = 24 * 60 * 60 * 1000; // pickup within 24h = same-day

/** Load same-day formula config from TierSettings, with safe defaults. */
async function loadSameDayConfig() {
  const s = await TierSettings.findOne().lean();
  return {
    mct:     (s && typeof s.sameDayMCT     === 'number') ? s.sameDayMCT     : 2,
    minRB:   (s && typeof s.sameDayMinRB   === 'number') ? s.sameDayMinRB   : 2,
    rbRatio: (s && typeof s.sameDayRBRatio === 'number') ? s.sameDayRBRatio : 0.25,
  };
}

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
 * @returns {Promise<{aqd,rb,cl,mct,formulaPass,manualBlock,available,reason,message}>}
 */
async function computeSameDayStatus(region) {
  const regionId = region._id;

  const [aqd, committedDrivers, cfg] = await Promise.all([
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
    loadSameDayConfig(),
  ]);

  const { mct, minRB, rbRatio } = cfg;
  const cl = committedDrivers.length;
  const rb = Math.max(minRB, Math.ceil(aqd * rbRatio));
  const formulaPass = aqd - rb - cl >= mct;
  const manualBlock = region.sameDayManualBlock === true;
  const regionInactive = region.isActive === false;
  const available = !regionInactive && !manualBlock && formulaPass;

  // Guest-facing eligibility messaging — a reason code the frontend can map to
  // styled UI, plus a ready-to-show human-readable message.
  let reason = null;
  let message = 'Same-day booking is available for this region.';
  if (regionInactive) {
    reason = 'region_inactive';
    message = 'This region is not currently available for bookings.';
  } else if (manualBlock) {
    reason = 'manual_block';
    message = 'Same-day booking has been temporarily turned off for this region.';
  } else if (!formulaPass) {
    reason = 'insufficient_coverage';
    message =
      'Same-day booking is unavailable right now — not enough drivers are free ' +
      'in this region. Please choose a later pickup time.';
  }

  return { aqd, rb, rbRatio, minRB, cl, mct, formulaPass, manualBlock, available, reason, message };
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
