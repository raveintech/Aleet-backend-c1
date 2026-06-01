/**
 * utils/bookingHelpers.js
 * ---------------------------------------------------------------------------
 * Pure utility functions for the booking flow:
 *   - ObjectId sanitization
 *   - ISO UTC assertion
 *   - Input validation (basic + final)
 *   - Itinerary building + live ETA validation
 *   - Price calculation
 * ---------------------------------------------------------------------------
 */

const mongoose = require('mongoose');
const AddOn = require('../models/AddOn');
const { getDriveSeconds } = require('../services/googleRoutesService');

// ---------------------------------------------------------------------------
// ObjectId helpers
// ---------------------------------------------------------------------------

/**
 * Convert a string to ObjectId if valid; return null otherwise.
 * Silently drops invalid values — prevents Mongoose CastErrors.
 */
const toId = (v) =>
    mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : null;

// ---------------------------------------------------------------------------
// Date / ISO helpers
// ---------------------------------------------------------------------------

const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/**
 * Throws if value is not a strict ISO UTC string.
 * @param {string} label  Field name for error message
 * @param {*}      value
 */
function assertIsoUtc(label, value) {
    if (typeof value !== 'string' || !ISO_UTC_REGEX.test(value)) {
        throw new Error(
            `Invalid ISO datetime for ${label}. Use UTC ISO like 2025-10-12T16:00:00.000Z`
        );
    }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

// Non-members must give at least this much notice before pickup.
// Members are exempt per spec ("Members = no minimums").
const NON_MEMBER_NOTICE_MS = 3 * 60 * 60 * 1000;

/**
 * Basic booking validation — called by both previewBooking and startBooking.
 * Does NOT require pickupLocation / dropoffLocation (to support preview-only calls).
 *
 * @param {boolean} [opts.isSubscriber=false]  When true, skips the 3-hour notice rule.
 *   Defaults to false so a caller that forgets to pass it gets the stricter (safer) check.
 * @returns {{ bookingHours: number, bookingDays: number }}
 * @throws {Error} on any validation failure
 */
function validateBookingInput({ region, startDate, endDate, quantity, bookingMode = 'multi_day', durationHours, isSubscriber = false }) {
    assertIsoUtc('startDate', startDate);
    assertIsoUtc('endDate', endDate);

    if (!region) throw new Error('Region is required');

    const now = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start < now) throw new Error('Start date must be in future');

    // 3-hour notice rule (non-members only).
    // Keep this AFTER the past-time check so the error message is the most specific.
    if (!isSubscriber) {
        const earliestPickup = new Date(now.getTime() + NON_MEMBER_NOTICE_MS);
        if (start < earliestPickup) {
            throw new Error('Earliest pickup is 3 hours from now');
        }
    }

    const bookingHours = (end - start) / (1000 * 3600);
    const bookingDays = (end - start) / (1000 * 3600 * 24);

    if (bookingMode === 'buy_hours') {
        if (!Number.isFinite(Number(durationHours)) || Number(durationHours) <= 0) {
            throw new Error('Duration must be a positive number of hours');
        }
    }

    // Min 3h / max 7d apply to BOTH booking modes (buy_hours no longer bypasses
    // them). Members are exempt — "Members = no minimums".
    if (!isSubscriber) {
        if (bookingHours < 3) throw new Error('Minimum booking is 3 hours');
        if (bookingDays > 7) throw new Error('Maximum booking is 7 days');
    }

    // Quantity must be 1-5 when provided. Booking schema defaults to 1 when omitted.
    if (quantity != null && (!Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > 5)) {
        throw new Error('Quantity must be between 1 and 5');
    }

    return { bookingHours, bookingDays };
}

/**
 * Final validation — called only by startBooking before persisting.
 * Requires pickupLocation, dropoffLocation, and valid stops (when not freeRouting).
 *
 * @throws {Error} on any validation failure
 */
function validateFinalBookingInput({ pickupLocation, dropoffLocation, stops, freeRouting, bookingMode = 'multi_day' }) {
    if (!pickupLocation) throw new Error('Pickup location is required');

    if (bookingMode === 'buy_hours') {
        if (Array.isArray(stops)) {
            for (const s of stops) {
                if (!s.location) throw new Error('Each stop must have a location');
                const rawTime = s.time || s.arrivalTime || s.pickupTime;
                if (rawTime) assertIsoUtc(`stop.time (${s.location})`, rawTime);
                if (s.dwellMinutes != null && isNaN(Number(s.dwellMinutes))) {
                    throw new Error('dwellMinutes must be a number if provided');
                }
            }
        }
        return;
    }

    // dropoffLocation is optional when freeRouting is enabled
    if (!freeRouting && !dropoffLocation) throw new Error('Dropoff location is required');

    if (!freeRouting) {
        if (!Array.isArray(stops) || stops.length === 0) {
            throw new Error('At least one stop is required if Free Routing is off');
        }
        for (const s of stops) {
            if (!s.location) throw new Error('Each stop must have a location');
            const rawTime = s.time || s.arrivalTime || s.pickupTime;
            if (rawTime) assertIsoUtc(`stop.time (${s.location})`, rawTime);
            if (s.dwellMinutes != null && isNaN(Number(s.dwellMinutes))) {
                throw new Error('dwellMinutes must be a number if provided');
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Itinerary
// ---------------------------------------------------------------------------

/**
 * Build a normalized itinerary object from a raw request body.
 * @param {object} body  req.body (with pickupLocation, dropoffLocation, stops, startDate, endDate)
 * @returns {{ pickupLocation, pickupTime, stops, dropoffLocation, dropoffTime }}
 */
function buildItineraryFromBody(body) {
    const stops = (body.stops || []).map(s => {
        const rawTime = s.time || s.arrivalTime || s.pickupTime;
        const timeType =
            s.timeType === 'pickup' || s.timeType === 'arrival'
                ? s.timeType
                : s.pickupTime ? 'pickup' : 'arrival';

        return {
            location: s.location,
            arrivalTime: rawTime,
            dwellMinutes: Number(s.dwellMinutes || 0),
            timeType
        };
    });

    return {
        pickupLocation: body.pickupLocation,
        pickupTime: body.startDate,
        stops,
        dropoffLocation: body.dropoffLocation,
        dropoffTime: body.endDate
    };
}

/**
 * Validate live drive time + 15-min buffer for every leg in the itinerary.
 *
 * @param {{ pickupLocation, pickupTime, stops, dropoffLocation, dropoffTime }} itin
 * @param {{ bufferMinutes?: number }} options
 * @returns {Promise<{ allOk: boolean, bufferMinutes: number, legs: object[], error?: string }>}
 */
async function validateItinerary(itin, { bufferMinutes = 15 } = {}) {
    const legs = [];
    const bufferSec = bufferMinutes * 60;

    // Build ordered list: [Pickup] → stops[] → [Drop-off]
    const points = [
        { label: 'Pickup', loc: itin.pickupLocation, t: itin.pickupTime },
        ...itin.stops.map((s, idx) => ({
            label: `Stop ${idx + 1}`,
            loc: s.location,
            t: s.arrivalTime,
            dwell: s.dwellMinutes || 0
        })),
        { label: 'Drop-off', loc: itin.dropoffLocation, t: itin.dropoffTime }
    ];

    for (let i = 0; i < points.length - 1; i++) {
        const A = points[i];
        const B = points[i + 1];

        const tA = new Date(A.t).getTime();
        const tB = new Date(B.t).getTime();
        if (isNaN(tA) || isNaN(tB)) {
            return { allOk: false, bufferMinutes, legs: [], error: 'Invalid ISO in itinerary' };
        }

        const dwellA = Number(A.dwell || 0);
        const plannedGapSec = Math.max(0, Math.floor((tB - tA) / 1000) - dwellA * 60);

        const driveSec = await getDriveSeconds(A.loc, B.loc, new Date(tA).toISOString());
        if (driveSec == null) {
            legs.push({
                from: A.label,
                to: B.label,
                plannedGapSec,
                neededGapSec: null,
                minRequiredGapSec: null,
                ok: false,
                reason: 'ETA unavailable'
            });
            continue;
        }

        const minRequiredGapSec = driveSec + bufferSec;
        const ok = plannedGapSec >= minRequiredGapSec;

        legs.push({
            from: `${A.label} (${A.loc})`,
            to: `${B.label} (${B.loc})`,
            plannedGapSec,
            neededGapSec: driveSec,
            minRequiredGapSec,
            ok
        });
    }

    const allOk = legs.every(l => l.ok);
    return { allOk, bufferMinutes, legs };
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Resolve the locked membership hourly rate for a user.
 * Membership is a flat, vehicle-independent rate — NOT a percentage discount:
 *   - Founder 30 (invite-only) members → settings.founder30Rate ($69)
 *   - Standard members                 → settings.membershipRate ($89)
 * Returns null for non-members so callers can fall back to the dynamic rate.
 *
 * @param {object} user      User document (needs subscriptionStatus + subscriptionDetails.plan)
 * @param {object} [settings] TierSettings document (membershipRate, founder30Rate)
 * @returns {number|null}
 */
function resolveMemberRate(user, settings) {
    if (user?.subscriptionStatus !== 'subscriber') return null;
    const isFounder = user?.subscriptionDetails?.plan === 'founder30';
    const membershipRate = Number(settings?.membershipRate) || 89;
    const founder30Rate = Number(settings?.founder30Rate) || 69;
    return isFounder ? founder30Rate : membershipRate;
}

/**
 * Calculate booking price for both regular and subscriber rates.
 *
 * @param {{
 *   vehicleType,
 *   quantity,
 *   addOns: ObjectId[],       // top-level booking add-on IDs
 *   stops?: Array<{ addOnIds?: ObjectId[] }>,  // per-stop add-on IDs
 *   isSubscriber,
 *   memberRate,               // locked $/hr for members ($89 / $69); null for non-members
 *   usedHours,
 *   bookingHours
 * }} params
 * @returns {Promise<{ regularPrice, subscriberPrice, breakdown }>}
 */
async function calculateBookingPrice({
    vehicleType,
    quantity,
    addOns,
    stops,
    isSubscriber,
    memberRate,
    usedHours,
    bookingHours
}) {
    const baseRate = Number(vehicleType?.hourlyPrice || 0);
    const qty = Number(quantity) || 1;
    const hours = Number(bookingHours) || 0;
    const totalBookedHours = hours * qty;

    // Merge top-level addOns + per-stop addOnIds into one deduplicated set
    const topLevelIds = Array.isArray(addOns) ? addOns.filter(Boolean) : [];
    const stopIds = Array.isArray(stops)
        ? stops.flatMap(s => Array.isArray(s.addOnIds) ? s.addOnIds.filter(Boolean) : [])
        : [];

    const allIds = [...new Set([...topLevelIds, ...stopIds].map(id => id.toString()))].map(id => toId(id)).filter(Boolean);

    // Fetch only IDs that actually exist in DB — invalid IDs are silently dropped
    const validAddOns = allIds.length
        ? await AddOn.find({ _id: { $in: allIds } })
        : [];

    const paidAddOns = validAddOns.filter(a => a.type === 'paid');
    const freeAddOns = validAddOns.filter(a => a.type === 'free');

    const addOnsCost = paidAddOns.reduce((sum, a) => sum + (a.price || 0), 0);

    let regularPrice = totalBookedHours * baseRate + addOnsCost;
    let subscriberPrice = regularPrice;

    // Locked membership rate ($89 standard / $69 Founder 30), applied to every
    // booked hour regardless of vehicle type. Falls back to the dynamic vehicle
    // rate only if a caller forgets to pass memberRate (defensive).
    const lockedRate = Number(memberRate) > 0 ? Number(memberRate) : baseRate;

    let freeHoursLeft = Math.max(0, 5 - (usedHours || 0));
    let freeHoursUsed = 0;

    if (isSubscriber) {
        freeHoursUsed = Math.min(totalBookedHours, freeHoursLeft);
        const billableHours = Math.max(0, totalBookedHours - freeHoursLeft);
        subscriberPrice = billableHours * lockedRate + addOnsCost; // locked rate, no % discount
    }

    return {
        regularPrice: Number(regularPrice.toFixed(2)),
        subscriberPrice: Number(subscriberPrice.toFixed(2)),
        breakdown: {
            baseRate,
            memberRate: isSubscriber ? lockedRate : null,
            hours,
            qty,
            addOnsCost: Number(addOnsCost.toFixed(2)),
            paidAddOns,
            freeAddOns,
            freeHoursUsed,
            freeHoursLeft: isSubscriber ? Math.max(0, freeHoursLeft - totalBookedHours) : 0
        }
    };
}

module.exports = {
    toId,
    assertIsoUtc,
    validateBookingInput,
    validateFinalBookingInput,
    buildItineraryFromBody,
    validateItinerary,
    resolveMemberRate,
    calculateBookingPrice
};
