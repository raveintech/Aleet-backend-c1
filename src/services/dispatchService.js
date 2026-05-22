// src/services/dispatchService.js
// ---------------------------------------------------------------------------
// Driver dispatch — eligibility evaluation + tier-priority ordering.
//
// Used by the admin "assign driver" flow:
//   - getRankedDriversForBooking → powers the eligible-driver picker
//   - evaluateDriver             → the gate enforced when an admin assigns
//   - autoAssignDriver           → picks the single best eligible driver
// ---------------------------------------------------------------------------

const User = require('../models/User');

// A booking is "same-day" when pickup is within the next 24 hours.
// feat/availability-engine will later refine same-day detection.
const SAME_DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Membership trips are marked by a subscriptionPrice on the booking.
function isMembershipTrip(booking) {
  return booking?.subscriptionPrice != null;
}

function isSameDayBooking(booking) {
  const start = booking?.dates?.startDate;
  if (!start) return false;
  return new Date(start).getTime() - Date.now() <= SAME_DAY_WINDOW_MS;
}

// Default-open region binding — driver serves everywhere unless restricted.
function driverServesRegion(driverDoc, regionId) {
  if (!regionId) return true;
  const d = driverDoc.driver || {};
  if (d.serveAllRegions !== false) return true;
  const allowed = Array.isArray(d.regions) ? d.regions : [];
  return allowed.some((r) => String(r) === String(regionId));
}

// S-Level drivers operate Aleet-provided vehicles, so they are exempt from the
// driver-owned vehicle-type match. Pro/Diamond must own the required type.
function driverHasVehicleType(driverDoc, vehicleTypeId) {
  if (!vehicleTypeId) return true;
  const d = driverDoc.driver || {};
  if (d.tier === 'S-Level') return true;
  const owned = (d.vehicleTypes || []).map((v) => String(v));
  return owned.includes(String(vehicleTypeId));
}

/**
 * Evaluate one driver against one booking.
 * @returns {{ eligible: boolean, reason: string|null }}
 */
function evaluateDriver(driverDoc, booking) {
  if (!driverDoc || driverDoc.role !== 'driver') {
    return { eligible: false, reason: 'Not a driver account' };
  }
  const d = driverDoc.driver || {};

  if (d.status !== 'approved') {
    return { eligible: false, reason: 'Driver is not approved' };
  }
  if (isMembershipTrip(booking) && d.tier === 'S-Level') {
    return { eligible: false, reason: 'Membership trips require a Pro or Diamond driver' };
  }
  if (!driverHasVehicleType(driverDoc, booking.vehicleType)) {
    return { eligible: false, reason: 'Driver lacks the required vehicle type' };
  }
  if (!driverServesRegion(driverDoc, booking.region)) {
    return { eligible: false, reason: "Driver doesn't serve this region" };
  }
  return { eligible: true, reason: null };
}

// Rating at/above this promotes a Pro driver to "Select Pro" — same-day
// priority just below Diamond (spec: same-day = Diamond, then Select Pro).
// Soft signal only: lower-rated Pro drivers stay eligible, just ranked later.
const SELECT_PRO_MIN_RATING = 4.5;

/** True when a Pro driver's rating qualifies them as a "Select Pro". */
function isSelectPro(tier, rating) {
  return tier === 'Pro' && Number(rating || 0) >= SELECT_PRO_MIN_RATING;
}

// Tier priority — lower number = higher priority.
// Same-day: Diamond → Select Pro → other Pro → S-Level.
// Advance:  S-Level → Pro / Diamond.
const ADVANCE_PRIORITY = { 'S-Level': 0, Pro: 1, Diamond: 1 };

function sameDayRank(tier, rating) {
  if (tier === 'Diamond') return 0;
  if (tier === 'Pro') return isSelectPro(tier, rating) ? 1 : 2;
  if (tier === 'S-Level') return 3;
  return 99;
}

function tierRank(tier, rating, sameDay) {
  if (sameDay) return sameDayRank(tier, rating);
  return ADVANCE_PRIORITY[tier] != null ? ADVANCE_PRIORITY[tier] : 99;
}

/**
 * Return every driver ranked for a booking. Eligible drivers come first
 * (sorted by tier priority, then rating); ineligible drivers follow, each
 * carrying a reason so the admin UI can show why they can't be picked.
 */
async function getRankedDriversForBooking(booking) {
  const sameDay = isSameDayBooking(booking);

  const drivers = await User.find({ role: 'driver' })
    .select(
      'name email phone role driver.tier driver.status driver.vehicleTypes ' +
        'driver.regions driver.serveAllRegions driver.driverRating',
    )
    .lean();

  const evaluated = drivers.map((driver) => {
    const { eligible, reason } = evaluateDriver(driver, booking);
    const d = driver.driver || {};
    const tier = d.tier || null;
    const rating = d.driverRating || 0;
    return {
      _id: driver._id,
      name: driver.name,
      email: driver.email,
      phone: driver.phone,
      tier,
      rating,
      selectPro: isSelectPro(tier, rating),
      eligible,
      reason,
    };
  });

  evaluated.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1; // eligible first
    const rankDiff =
      tierRank(a.tier, a.rating, sameDay) - tierRank(b.tier, b.rating, sameDay);
    if (rankDiff !== 0) return rankDiff;                       // tier priority
    return b.rating - a.rating;                               // higher rating first
  });

  return {
    sameDay,
    membershipTrip: isMembershipTrip(booking),
    drivers: evaluated,
  };
}

/**
 * Auto-dispatch — pick the single best driver for a booking. The chosen driver
 * is the top-ranked eligible driver from getRankedDriversForBooking (tier
 * priority, then rating). Returns null when no driver is eligible.
 *
 * Scheduling conflicts are intentionally NOT considered — a driver may already
 * hold an overlapping trip; the admin resolves any clash.
 *
 * @param {object} booking  A Booking doc (or lean object).
 * @returns {Promise<{ driver: object|null, sameDay: boolean,
 *                      membershipTrip: boolean, candidates: object[] }>}
 */
async function autoAssignDriver(booking) {
  const { drivers, sameDay, membershipTrip } = await getRankedDriversForBooking(booking);
  const driver = drivers.find((d) => d.eligible) || null;
  return { driver, sameDay, membershipTrip, candidates: drivers };
}

module.exports = {
  evaluateDriver,
  getRankedDriversForBooking,
  autoAssignDriver,
  isSameDayBooking,
  isMembershipTrip,
  isSelectPro,
  SELECT_PRO_MIN_RATING,
};
