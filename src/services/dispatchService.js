// src/services/dispatchService.js
// ---------------------------------------------------------------------------
// Driver dispatch — eligibility evaluation + tier-priority ordering.
//
// Used by the admin "assign driver" flow:
//   - getRankedDriversForBooking → powers the eligible-driver picker
//   - evaluateDriver             → the gate enforced when an admin assigns
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

// Tier priority — lower number = higher priority.
// Same-day: Diamond first, then Pro, then S-Level.
// Advance:  S-Level first, then Pro / Diamond.
const SAME_DAY_PRIORITY = { Diamond: 0, Pro: 1, 'S-Level': 2 };
const ADVANCE_PRIORITY = { 'S-Level': 0, Pro: 1, Diamond: 1 };

function tierRank(tier, sameDay) {
  const map = sameDay ? SAME_DAY_PRIORITY : ADVANCE_PRIORITY;
  return map[tier] != null ? map[tier] : 99;
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
    return {
      _id: driver._id,
      name: driver.name,
      email: driver.email,
      phone: driver.phone,
      tier: d.tier || null,
      rating: d.driverRating || 0,
      eligible,
      reason,
    };
  });

  evaluated.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1; // eligible first
    const rankDiff = tierRank(a.tier, sameDay) - tierRank(b.tier, sameDay);
    if (rankDiff !== 0) return rankDiff;                       // tier priority
    return b.rating - a.rating;                               // higher rating first
  });

  return {
    sameDay,
    membershipTrip: isMembershipTrip(booking),
    drivers: evaluated,
  };
}

module.exports = {
  evaluateDriver,
  getRankedDriversForBooking,
  isSameDayBooking,
  isMembershipTrip,
};
