/**
 * Same-day engine — capacity + dispatch (T-2.4.2, T-2.4.6, T-2.4.7).
 *
 * Spec: `AQD - RB - CL >= MCT` with
 *   AQD = active Diamond + approved Pro (per P0 B1: status === 'approved')
 *   RB  = max(MCTMin, AQD * RBPercent)
 *   CL  = drivers with an active accepted booking right now
 *   MCT = MCTMin
 *
 * Capacity is city/region-level (cacheable per region). Per-booking eligibility
 * adds the 3-hour notice rule on top.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Region = require('../models/Region');
const { getConfig } = require('./platformConfigService');

const objectId = (v) => (mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : null);

/**
 * Active Qualified Drivers in a region — approved drivers whose tier is Diamond
 * OR Pro, who serve this region (`serveAllRegions !== false` OR region in
 * `regions[]`).
 */
const computeAQD = async (regionId) => {
  const id = objectId(regionId);
  if (!id) return 0;
  return User.countDocuments({
    role: 'driver',
    'driver.status': 'approved',
    'driver.tier': { $in: ['Pro', 'Diamond'] },
    $or: [
      { 'driver.serveAllRegions': { $ne: false } },
      { 'driver.regions': id },
    ],
  });
};

/**
 * Committed Load — drivers in this region currently assigned to a non-terminal
 * booking that overlaps the current instant.
 */
const computeCL = async (regionId) => {
  const id = objectId(regionId);
  if (!id) return 0;
  const now = new Date();
  return Booking.countDocuments({
    region: id,
    status: { $in: ['Confirmed', 'In Progress'] },
    'dates.startDate': { $lte: now },
    'dates.endDate': { $gte: now },
    assignedDriver: { $ne: null },
  });
};

const computeRB = (AQD, params) => {
  const min = Number(params?.RBMin ?? 2);
  const pct = Number(params?.RBPercent ?? 0.225);
  return Math.max(min, Math.ceil(AQD * pct));
};

const computeMCT = (params) => Number(params?.MCTMin ?? 2);

/**
 * Region-level capacity. Cached per region for 30 seconds to avoid hammering
 * Mongo on every same-day booking attempt.
 */
const capacityCache = new Map();
const CAPACITY_TTL_MS = 30 * 1000;

const isSameDayCapacityOn = async (regionId, { force = false } = {}) => {
  const key = String(regionId);
  const cached = capacityCache.get(key);
  if (!force && cached && Date.now() - cached.at < CAPACITY_TTL_MS) return cached.value;

  const [region, config] = await Promise.all([
    Region.findById(regionId).lean(),
    getConfig(),
  ]);
  if (!region) return { on: false, reason: 'REGION_NOT_FOUND' };
  if (region.sameDayBlock) {
    const value = { on: false, reason: 'SAME_DAY_BLOCKED', AQD: 0, RB: 0, CL: 0, MCT: 0 };
    capacityCache.set(key, { at: Date.now(), value });
    return value;
  }

  const params = config.sameDayParams || {};
  const [AQD, CL] = await Promise.all([computeAQD(regionId), computeCL(regionId)]);
  const RB = computeRB(AQD, params);
  const MCT = computeMCT(params);
  const capacityOk = (AQD - RB - CL) >= MCT;

  const value = {
    on: capacityOk,
    reason: capacityOk ? 'OK' : 'SAME_DAY_OUT_OF_CAPACITY',
    AQD, RB, CL, MCT,
  };
  capacityCache.set(key, { at: Date.now(), value });
  return value;
};

const invalidateCapacityCache = (regionId = null) => {
  if (regionId) capacityCache.delete(String(regionId));
  else capacityCache.clear();
};

/**
 * Per-booking eligibility: capacity is on AND the booking gives enough notice.
 */
const isSameDayEligible = async (booking, { force = false } = {}) => {
  if (!booking?.region || !booking?.dates?.startDate) {
    return { eligible: false, reason: 'INVALID_BOOKING' };
  }
  const cap = await isSameDayCapacityOn(booking.region, { force });
  if (!cap.on) return { eligible: false, reason: cap.reason, capacity: cap };

  const config = await getConfig();
  const noticeHours = Number(config.sameDayParams?.noticeHours ?? 3);
  const noticeMs = noticeHours * 60 * 60 * 1000;
  const startMs = new Date(booking.dates.startDate).getTime();
  if (Number.isFinite(startMs) && startMs - Date.now() < noticeMs) {
    return { eligible: false, reason: 'SAME_DAY_NOTICE_TOO_SHORT', capacity: cap };
  }
  return { eligible: true, reason: 'OK', capacity: cap };
};

/**
 * Auto-dispatcher (T-2.4.6 / T-2.4.7). Returns the first driver to assign per
 * the spec's priority order, or a structured exhaustion reason.
 *
 * Built against an opaque `isSelectPro(driver)` so the same-day priority can be
 * resolved once P0 #1 (Select Pro definition) lands without rewriting the
 * engine.
 */
const isSelectPro = (driverDoc) => {
  // Default: admin-flagged via `driver.pro.isSelectPro`. If P0 #1 resolves to
  // rating-derived, swap this single function out.
  return Boolean(driverDoc?.driver?.pro?.isSelectPro);
};

const pickEligibleDriversForRegion = async (regionId) => {
  const id = objectId(regionId);
  if (!id) return [];
  return User.find({
    role: 'driver',
    'driver.status': 'approved',
    $or: [
      { 'driver.serveAllRegions': { $ne: false } },
      { 'driver.regions': id },
    ],
  })
    .select('driver name email')
    .lean();
};

const dispatch = async (booking) => {
  if (!booking?.region) return { ok: false, reason: 'INVALID_BOOKING' };
  const drivers = await pickEligibleDriversForRegion(booking.region);
  if (drivers.length === 0) return { ok: false, reason: 'NO_DRIVERS_IN_REGION' };

  // Exclude drivers already committed to overlapping trips.
  const now = new Date();
  const committedIds = new Set(
    (await Booking.find({
      status: { $in: ['Confirmed', 'In Progress'] },
      'dates.startDate': { $lte: now },
      'dates.endDate': { $gte: now },
      assignedDriver: { $ne: null },
    }).select('assignedDriver').lean()).map((b) => String(b.assignedDriver))
  );
  const available = drivers.filter((d) => !committedIds.has(String(d._id)));
  if (available.length === 0) return { ok: false, reason: 'ALL_DRIVERS_COMMITTED' };

  // Rating tiebreak within a priority class (T-2.6.2).
  const ratingDesc = (a, b) => Number(b.driver?.driverRating || 0) - Number(a.driver?.driverRating || 0);

  if (booking.sameDay) {
    const diamonds = available.filter((d) => d.driver?.tier === 'Diamond').sort(ratingDesc);
    if (diamonds.length) return { ok: true, driver: diamonds[0], priorityClass: 'same-day-diamond' };
    const selectPros = available.filter((d) => d.driver?.tier === 'Pro' && isSelectPro(d)).sort(ratingDesc);
    if (selectPros.length) return { ok: true, driver: selectPros[0], priorityClass: 'same-day-select-pro' };
    return { ok: false, reason: 'SAME_DAY_OUT_OF_CAPACITY' };
  }

  // Advance flow.
  const sLevels = available.filter((d) => d.driver?.tier === 'S-Level').sort(ratingDesc);
  if (sLevels.length) return { ok: true, driver: sLevels[0], priorityClass: 'advance-s-tier' };
  const proDiamond = available.filter((d) => ['Pro', 'Diamond'].includes(d.driver?.tier)).sort(ratingDesc);
  if (proDiamond.length) return { ok: true, driver: proDiamond[0], priorityClass: 'advance-pro-diamond' };
  return { ok: false, reason: 'NO_ELIGIBLE_DRIVER' };
};

module.exports = {
  computeAQD,
  computeCL,
  computeRB,
  computeMCT,
  isSameDayCapacityOn,
  isSameDayEligible,
  invalidateCapacityCache,
  dispatch,
  isSelectPro,
};
