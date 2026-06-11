// src/services/availabilityService.js
// ---------------------------------------------------------------------------
// Same-day availability engine.
//
// Same-day booking for a region is ON only when:
//
//     AQD - RB - CL >= MCT
//
//   AQD = Active Qualified Drivers  — approved Diamond + approved Pro who
//                                     serve the region AND are currently
//                                     online (active socket connection,
//                                     lastSeenAt within the last 5 min)
//   RB  = Reserved Buffer          — 25% of AQD, rounded up, minimum 2
//   CL  = Committed Load           — distinct drivers already assigned to
//                                     active bookings whose trip window
//                                     OVERLAPS the window being evaluated. A
//                                     driver only counts as committed for the
//                                     time their trip actually occupies, so a
//                                     driver with a non-overlapping trip stays
//                                     available for other slots that day.
//   MCT = Minimum Coverage Threshold — 2 (1 primary + 1 backup)
//
// An admin can also force a region OFF via Region.sameDayManualBlock.
// ---------------------------------------------------------------------------

const User = require('../models/User');
const Booking = require('../models/Booking');
const Region = require('../models/Region');
const TierSettings = require('../models/TierSettings');

const SAME_DAY_WINDOW_MS = 24 * 60 * 60 * 1000; // pickup within 24h = same-day
const PRESENCE_FRESHNESS_MS = 5 * 60 * 1000;    // driver lastSeenAt must be within 5 min

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
// AQD = approved Diamond/Pro drivers serving this region AND currently
// online (socket connected, lastSeenAt within PRESENCE_FRESHNESS_MS).
// Region binding is default-open: a driver serves everywhere unless
// serveAllRegions is explicitly false with a restricted regions list.
function qualifiedDriverFilter(regionId) {
  return {
    role: 'driver',
    'driver.status': 'approved',
    'driver.tier': { $in: ['Diamond', 'Pro'] },
    'driver.isOnline': true,
    'driver.lastSeenAt': { $gte: new Date(Date.now() - PRESENCE_FRESHNESS_MS) },
    $or: [
      { 'driver.serveAllRegions': { $ne: false } },
      { 'driver.regions': regionId },
    ],
  };
}

/**
 * Compute the same-day availability breakdown for a region document.
 *
 * Committed Load (CL) is measured against a time window. When evaluating a
 * specific booking request, pass its trip window via opts so a driver is only
 * counted as committed when their existing trip actually overlaps it — a driver
 * busy at 8am does not block a 6pm slot. With no window supplied (the generic
 * region-status views), CL falls back to the rolling next-24h window.
 *
 * @param {object} region  A Region mongoose doc (or lean object).
 * @param {object} [opts]
 * @param {Date|string|number} [opts.windowStart]  Requested trip start (pickup).
 * @param {Date|string|number} [opts.windowEnd]    Requested trip end (dropoff).
 * @returns {Promise<{aqd,rb,cl,mct,formulaPass,manualBlock,available,reason,message}>}
 */
async function computeSameDayStatus(region, opts = {}) {
  const regionId = region._id;

  // Window the committed drivers are measured against. Default: rolling 24h.
  const now = new Date();
  const windowStart = opts.windowStart ? new Date(opts.windowStart) : now;
  const windowEnd = opts.windowEnd
    ? new Date(opts.windowEnd)
    : new Date(now.getTime() + SAME_DAY_WINDOW_MS);

  const [aqd, committedDrivers, cfg] = await Promise.all([
    User.countDocuments(qualifiedDriverFilter(regionId)),
    Booking.distinct('assignedDriver', {
      region: regionId,
      status: { $in: ['Confirmed', 'In Progress'] },
      assignedDriver: { $ne: null },
      // Time-window overlap: existing trip starts before the requested window
      // ends AND finishes after it starts. Non-overlapping trips don't count.
      'dates.startDate': { $lt: windowEnd },
      'dates.endDate': { $gt: windowStart },
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

/**
 * Same-day status for one region by id. Returns null if the region is gone.
 * @param {string} regionId
 * @param {object} [opts]  Forwarded to computeSameDayStatus (windowStart/windowEnd).
 */
async function getRegionSameDayStatus(regionId, opts = {}) {
  const region = await Region.findById(regionId);
  if (!region) return null;
  return computeSameDayStatus(region, opts);
}

module.exports = {
  computeSameDayStatus,
  getRegionSameDayStatus,
  SAME_DAY_WINDOW_MS,
};
