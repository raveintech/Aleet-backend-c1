// src/services/dispatchService.js
// ---------------------------------------------------------------------------
// Driver dispatch — eligibility, ranking, and staged auto-dispatch.
//
// Two flows live here:
//
//   Auto-dispatch (primary)
//     - autoDispatchBooking      → sends the trip offer to eligible drivers
//     - escalateExpiredOffers    → no-op for new bookings (single-stage); kept
//                                  to clear any legacy stage-1 advance offers
//     - getEligibleDriversForStage / tiersForStage
//
//   Admin tools
//     - getRankedDriversForBooking → eligible-driver picker
//     - evaluateDriver             → the gate enforced when an admin assigns
//     - autoAssignDriver           → one-shot "pick best driver" shortcut
// ---------------------------------------------------------------------------

const User = require('../models/User');
const Booking = require('../models/Booking');

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

// ---------------------------------------------------------------------------
// Staged auto-dispatch
//
// New bookings auto-emit a trip offer to the first eligible tier:
//   - Same-day  → stage 1 = Diamond + Pro  (single stage; no escalation)
//   - Advance   → stage 1 = S-Level only
//                 stage 2 = Pro + Diamond  (after FIRST_STAGE_WINDOW_MS)
//
// The first driver to atomically claim the booking wins it. Drivers see open
// offers via GET /api/bookings/open-trips (filtered by their tier against
// booking.offer.tiers).
// ---------------------------------------------------------------------------

// Offer TTL — kept so booking.offer.expiresAt has a sensible window for any
// future re-dispatch / cleanup logic. Both same-day and advance now use a
// single stage so escalation no longer fires (escalateExpiredOffers is a
// no-op for new bookings — it stays in place for legacy stage-1 records).
const FIRST_STAGE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Tiers eligible to receive the offer at the given dispatch stage.
 *
 * Per spec — both flows fire in a single stage:
 *   - Same-day  → Diamond + Pro       (S-Level uses company vehicles, not
 *                                      available on short notice)
 *   - Advance   → S-Level + Pro + Diamond (all three see it together;
 *                                      first eligible driver to accept wins)
 *
 * Stage 2 is retired but kept returning [] for back-compat with any in-flight
 * legacy bookings that already advanced past stage 1.
 */
function tiersForStage(sameDay, stage) {
  if (stage !== 1) return [];
  return sameDay ? ['Diamond', 'Pro'] : ['S-Level', 'Pro', 'Diamond'];
}

/**
 * Find approved drivers whose tier qualifies for the given stage AND who pass
 * the full booking-eligibility gate (vehicle, region, membership).
 */
async function getEligibleDriversForStage(booking, stage) {
  const sameDay = isSameDayBooking(booking);
  const tiers = tiersForStage(sameDay, stage);
  if (tiers.length === 0) return [];

  const drivers = await User.find({
    role: 'driver',
    'driver.status': 'approved',
    'driver.tier': { $in: tiers },
  });

  return drivers.filter((d) => evaluateDriver(d, booking).eligible);
}

/**
 * Persist the offer for the given stage on the booking and return the drivers
 * who should be notified. Caller is responsible for firing SMS (so failures
 * there don't roll back the offer state).
 */
async function sendOfferForStage(booking, stage) {
  const sameDay = isSameDayBooking(booking);
  const tiers = tiersForStage(sameDay, stage);
  if (tiers.length === 0) {
    return { drivers: [], stage, tiers, sameDay };
  }

  const drivers = await getEligibleDriversForStage(booking, stage);
  const driverIds = drivers.map((d) => d._id);
  const prevOffered = (booking.offer && booking.offer.offeredTo) || [];
  const seen = new Set(prevOffered.map(String));
  const mergedOfferedTo = [...prevOffered];
  for (const id of driverIds) {
    if (!seen.has(String(id))) {
      mergedOfferedTo.push(id);
      seen.add(String(id));
    }
  }

  booking.offer = {
    stage,
    offeredAt: new Date(),
    expiresAt: new Date(Date.now() + FIRST_STAGE_WINDOW_MS),
    tiers,
    offeredTo: mergedOfferedTo,
  };
  await booking.save();

  return { drivers, stage, tiers, sameDay };
}

/**
 * Kick off auto-dispatch for a newly-created (or re-dispatched) booking.
 * Returns the eligible drivers so the caller can SMS them.
 */
async function autoDispatchBooking(booking) {
  return sendOfferForStage(booking, 1);
}

/**
 * Escalate a single booking from stage 1 → stage 2 if its window has expired
 * and it's still unaccepted. No-op for same-day (single stage) and bookings
 * that already have a driver.
 */
async function escalateOfferIfNeeded(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) return null;
  if (booking.assignedDriver) return null;
  if (booking.status !== 'Pending') return null;
  if (isSameDayBooking(booking)) return null;
  if (!booking.offer || booking.offer.stage !== 1) return null;
  if (!booking.offer.expiresAt || booking.offer.expiresAt > new Date()) return null;

  return sendOfferForStage(booking, 2);
}

/**
 * Periodic sweep — finds all stage-1 advance offers past their expiry and
 * escalates them. Returns the count of bookings that were escalated.
 */
async function escalateExpiredOffers() {
  const candidates = await Booking.find({
    status: 'Pending',
    assignedDriver: null,
    'offer.stage': 1,
    'offer.expiresAt': { $lte: new Date() },
  }).select('_id');

  let escalated = 0;
  for (const { _id } of candidates) {
    try {
      const result = await escalateOfferIfNeeded(_id);
      if (result && result.tiers.length > 0) escalated += 1;
    } catch (e) {
      console.error('Escalation failed for booking', String(_id), e?.message || e);
    }
  }
  return escalated;
}

module.exports = {
  evaluateDriver,
  getRankedDriversForBooking,
  autoAssignDriver,
  isSameDayBooking,
  isMembershipTrip,
  isSelectPro,
  SELECT_PRO_MIN_RATING,
  // Staged auto-dispatch
  autoDispatchBooking,
  sendOfferForStage,
  escalateOfferIfNeeded,
  escalateExpiredOffers,
  tiersForStage,
  getEligibleDriversForStage,
  FIRST_STAGE_WINDOW_MS,
};
