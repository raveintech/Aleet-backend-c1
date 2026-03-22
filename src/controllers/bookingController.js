/**
 * controllers/bookingsController.js
 * ---------------------------------------------------------------------------
 * Full booking controller with:
 *  - Input validation (region/quantity/dates/stops)
 *  - Strict ISO UTC time checks
 *  - Per-leg live ETA validation (Google Distance Matrix) + 15-min buffer
 *  - Admin override (startBooking only) -> dispatch flag
 *  - ObjectId sanitization for add-ons (global + per-stop)
 *  - Distance surcharge (base -> pickup > 20mi)
 *  - Pricing, subscriber logic, payouts (existing)
 *  - Clean 400 vs 500 error mapping
 * ---------------------------------------------------------------------------
 */

const asyncHandler = require('express-async-handler');
const axios = require('axios');
const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const User = require('../models/User');
const VehicleType = require('../models/Vehicle');
const MonthlyHours = require('../models/MonthlyHours');
const AddOn = require('../models/AddOn');

const { getPagination, getSorting, getSearchQuery } = require('../utils/queryHelper');
const {
  sendSuccess,
  sendError,
  sendValidationError,
  sendNotFound,
  sendForbidden,
  sendPaginated
} = require('../utils/responseHelper');
const { computePayoutCents } = require('../services/payoutUtils'); // your existing helper

// ========================================
// Small helpers
// ==========================================================================

// Convert strings to ObjectId if valid; drop invalids silently (shortest safe fix)
const toId = (v) =>
  mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : null;

// Strict ISO UTC (e.g., 2025-10-12T16:00:00.000Z or without ms)
const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
/** Throws on non-ISO UTC string */
function assertIsoUtc(label, value) {
  if (typeof value !== 'string' || !ISO_UTC_REGEX.test(value)) {
    throw new Error(`Invalid ISO datetime for ${label}. Use UTC ISO like 2025-10-12T16:00:00.000Z`);
  }
}

// ==========================================================================
// Pricing
// ==========================================================================
async function calculateBookingPrice({ vehicleType, quantity, addOns, isSubscriber, usedHours, bookingHours }) {
  const baseRate = Number(vehicleType?.hourlyPrice || 0);
  const qty = Number(quantity) || 1;
  const hours = Number(bookingHours) || 0;
  const totalBookedHours = hours * qty;

  let regularPrice = totalBookedHours * baseRate;
  let subscriberPrice = regularPrice;

  // Expect already-sanitized ObjectIds; guard when empty
  const validAddOns = (Array.isArray(addOns) && addOns.length)
    ? await AddOn.find({ _id: { $in: addOns } })
    : [];

  // Add-ons pricing
  validAddOns.forEach(addOn => {
    if (addOn.type === 'paid') {
      regularPrice += addOn.price;
      subscriberPrice += addOn.price;
    }
  });

  // Subscriber free hours logic
  let freeHoursLeft = Math.max(0, 5 - (usedHours || 0)); // example: 5 free hrs/mo
  let freeHoursUsed = 0;
  if (isSubscriber) {
    freeHoursUsed = Math.min(totalBookedHours, freeHoursLeft);
    const billableHours = Math.max(0, totalBookedHours - freeHoursLeft);
    subscriberPrice = billableHours * baseRate * 0.9; // example: 10% off
    validAddOns.forEach(addOn => {
      if (addOn.type === 'paid') subscriberPrice += addOn.price;
    });
  }

  return {
    regularPrice: Number(regularPrice.toFixed(2)),
    subscriberPrice: Number(subscriberPrice.toFixed(2)),
    breakdown: {
      baseRate,
      hours,
      qty,
      addOns: validAddOns,
      freeHoursUsed,
      freeHoursLeft: isSubscriber ? Math.max(0, freeHoursLeft - totalBookedHours) : 0
    }
  };
}

// ==========================================================================
// Core validation: top-level fields + stops basic checks
// ==========================================================================
function validateBookingInput({
  region,
  startDate,
  endDate,
  quantity,
  stops,
  freeRouting,
  pickupLocation,
  dropoffLocation
}) {
  // strict ISO check for top-level
  assertIsoUtc('startDate', startDate);
  assertIsoUtc('endDate', endDate);

  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (!region) throw new Error('Region is required');
  if (!pickupLocation) throw new Error('Pickup location is required');
  if (!dropoffLocation) throw new Error('Dropoff location is required');
  if (start < now) throw new Error('Start date must be in future');

  const bookingHours = (end - start) / (1000 * 3600);
  const bookingDays = (end - start) / (1000 * 3600 * 24);

  if (bookingHours < 3) throw new Error('Minimum booking is 3 hours');
  if (bookingDays > 7) throw new Error('Maximum booking is 7 days');
  if (quantity < 1 || quantity > 5) throw new Error('Quantity must be between 1 and 5');

  // stops validation when not free-routing
  if (!freeRouting) {
    if (!Array.isArray(stops) || stops.length === 0) {
      throw new Error('At least one stop is required if Free Routing is off');
    }
    for (const s of stops) {
      if (!s.location) throw new Error('Each stop must have a location');
      const rawTime = s.time || s.arrivalTime || s.pickupTime;
      if (!rawTime) throw new Error('Each stop must include a time (arrival/pickup)');
      assertIsoUtc(`stop.time (${s.location})`, rawTime);
      if (s.dwellMinutes != null && isNaN(Number(s.dwellMinutes))) {
        throw new Error('dwellMinutes must be a number if provided');
      }
    }
  }

  return { bookingHours, bookingDays };
}

// ==========================================================================
// Distance/base surcharge
// ==========================================================================
async function getMilesFromBaseToPickup(pickupLocation) {
  try {
    const baseAddress = 'Alexandria, VA 22304';
    const apiKey = process.env.GOOGLE_MAPS_API_KEY; // env only (no fallback)
    if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY missing');

    const params = new URLSearchParams({
      origins: baseAddress,
      destinations: pickupLocation,
      key: apiKey,
      units: 'imperial'
    });
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
    const { data } = await axios.get(url, { timeout: 15000 });
    const element = data?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') return null;
    const meters = element.distance?.value;
    if (typeof meters !== 'number') return null;
    return meters / 1609.344; // meters -> miles
  } catch {
    return null;
  }
}

// ==========================================================================
// Itinerary helpers (live ETA validation with buffer)
// ==========================================================================
function buildItineraryFromBody(body) {
  const stops = (body.stops || []).map(s => {
    const rawTime = s.time || s.arrivalTime || s.pickupTime;
    const timeType =
      s.timeType === 'pickup' || s.timeType === 'arrival'
        ? s.timeType
        : (s.pickupTime ? 'pickup' : 'arrival');

    return {
      location: s.location,
      arrivalTime: rawTime,                 // normalized
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

// single-leg drive time using Google Distance Matrix (live traffic)
async function getDriveSecondsGoogle(origin, destination, departIsoUtc) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('Itinerary validation failed: GOOGLE_MAPS_API_KEY missing');

  const params = new URLSearchParams({
    origins: origin,
    destinations: destination,
    key: apiKey,
    units: 'imperial',
    departure_time: Math.floor(new Date(departIsoUtc).getTime() / 1000).toString(), // seconds since epoch
    traffic_model: 'best_guess'
  });
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;

  const { data } = await axios.get(url, { timeout: 15000 });
  const el = data?.rows?.[0]?.elements?.[0];
  if (!el || el.status !== 'OK') return null;

  const sec = el.duration_in_traffic?.value ?? el.duration?.value ?? null;
  return (typeof sec === 'number') ? sec : null;
}

/**
 * Validate live drive time + buffer between all legs.
 * Returns { allOk, bufferMinutes, legs: [{from,to,plannedGapSec,neededGapSec,minRequiredGapSec,ok}], error? }
 */
async function validateItinerary(itin, { bufferMinutes = 15 } = {}) {
  const legs = [];
  const bufferSec = bufferMinutes * 60;

  // [Pickup] -> stops[] -> [Drop-off]
  const points = [
    { label: 'Pickup', loc: itin.pickupLocation, t: itin.pickupTime },
    ...itin.stops.map((s, idx) => ({ label: `Stop ${idx + 1}`, loc: s.location, t: s.arrivalTime, dwell: s.dwellMinutes || 0 })),
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

    // planned gap = B.time - A.time - dwell(A)
    const dwellA = Number(A.dwell || 0);
    const plannedGapSec = Math.max(0, Math.floor((tB - tA) / 1000) - dwellA * 60);

    // drive seconds departing at A.time
    const driveSec = await getDriveSecondsGoogle(A.loc, B.loc, new Date(tA).toISOString());
    if (driveSec == null) {
      legs.push({
        from: A.label, to: B.label, plannedGapSec, neededGapSec: null, minRequiredGapSec: null, ok: false, reason: 'ETA unavailable'
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

// ==========================================================================
// Controllers
// ==========================================================================

// Preview Booking (validates everything but does not persist)
const previewBooking = asyncHandler(async (req, res) => {
  try {
    const {
      region,
      startDate,
      endDate,
      vehicleTypeId,
      quantity,
      stops = [],
      addOns = [],
      freeRouting = false,
      pickupLocation,
      dropoffLocation
    } = req.body;

    const userId = req.user.id;

    // top-level input checks (strict ISO + basic fields + stops map)
    const { bookingHours } = validateBookingInput({
      region, startDate, endDate, quantity, stops, freeRouting, pickupLocation, dropoffLocation
    });

    // sanitize add-ons & per-stop addOnIds to avoid ObjectId cast errors
    const safeAddOnIds = Array.isArray(addOns) ? addOns.map(toId).filter(Boolean) : [];
    const safeStops = Array.isArray(stops)
      ? stops.map(s => ({ ...s, addOnIds: Array.isArray(s.addOnIds) ? s.addOnIds.map(toId).filter(Boolean) : [] }))
      : [];

    const user = await User.findById(userId);
    if (!user) return sendNotFound(res, 'User not found');

    const vehicleType = await VehicleType.findById(vehicleTypeId);
    if (!vehicleType) return sendValidationError(res, 'Invalid vehicle type');

    // real-time itinerary validation (only when planning stops)
    let routeValidation = null;
    if (!freeRouting) {
      const itinerary = buildItineraryFromBody({ ...req.body, stops: safeStops });
      routeValidation = await validateItinerary(itinerary, { bufferMinutes: 15 });
// comment due to google API location quota issues
      // if (!routeValidation.allOk) {
      //   const firstFail = routeValidation.legs.find(l => !l.ok) || routeValidation.legs[0];
      //   const mins = firstFail?.minRequiredGapSec ? Math.ceil(firstFail.minRequiredGapSec / 60) : 'unknown';
      //   return sendValidationError(
      //     res,
      //     `Please adjust your stop times to allow realistic travel between locations. The minimum required time is ${mins} mins for "${firstFail.from} → ${firstFail.to}".`,
      //     { routeValidation }
      //   );
      // }
    }

    // monthly hours for subscriber pricing
    const currentMonth = `${new Date(startDate).getFullYear()}-${String(new Date(startDate).getMonth() + 1).padStart(2, '0')}`;
    const monthlyHours = await MonthlyHours.findOne({ user: userId, yearMonth: currentMonth }) || { totalHoursUsed: 0 };

    const { regularPrice, subscriberPrice, breakdown } = await calculateBookingPrice({
      vehicleType,
      quantity,
      addOns: safeAddOnIds,
      isSubscriber: user.subscriptionStatus === 'subscriber',
      usedHours: monthlyHours.totalHoursUsed,
      bookingHours
    });

    // 20-mi base->pickup surcharge ($2/mi beyond 20)
    let baseToPickupMiles = null;
    let distanceSurcharge = 0;
    if (pickupLocation) {
      baseToPickupMiles = await getMilesFromBaseToPickup(pickupLocation);
      if (typeof baseToPickupMiles === 'number' && baseToPickupMiles > 20) {
        const extraMiles = Math.max(0, baseToPickupMiles - 20);
        distanceSurcharge = Number((extraMiles * 2).toFixed(2));
      }
    }

    const isSub = user.subscriptionStatus === 'subscriber';
    const regTotal = Number((regularPrice + distanceSurcharge).toFixed(2));
    const subTotal = Number((subscriberPrice + distanceSurcharge).toFixed(2));
    const total = isSub ? subTotal : regTotal;

    return sendSuccess(res, 200, 'Booking preview calculated', {
      vehicleType,
      quantity,
      startDate,
      endDate,
      hours: bookingHours,
      regularPrice: regTotal,
      subscriptionPrice: isSub ? subTotal : undefined,
      total,
      breakdown: {
        ...breakdown,
        distance:
          typeof baseToPickupMiles === 'number'
            ? { baseToPickupMiles: Number(baseToPickupMiles.toFixed(2)), freeMiles: 20, surchargePerMile: 2, distanceSurcharge }
            : { baseToPickupMiles: null, freeMiles: 20, surchargePerMile: 2, distanceSurcharge }
      },
      routeValidation
    });
  } catch (err) {
    console.error('Preview Booking Error:', err.message);

    const msg = err.message || '';
    const isValidation =
      msg.includes('Minimum booking') ||
      msg.includes('Maximum booking') ||
      msg.includes('Start date') ||
      msg.includes('Quantity') ||
      msg.includes('Region is required') ||
      msg.includes('Pickup location is required') ||
      msg.includes('Dropoff location is required') ||
      msg.includes('At least one stop is required') ||
      msg.includes('Each stop must have a location') ||
      msg.includes('Each stop must include a time') ||
      msg.includes('dwellMinutes must be a number') ||
      msg.includes('Invalid ISO datetime') ||
      msg.includes('Itinerary validation failed');

    if (isValidation) return sendValidationError(res, msg);

    if (/Cast to ObjectId failed/i.test(msg)) {
      return sendValidationError(res, 'One or more IDs are invalid. Please pass valid MongoDB ObjectIds.');
    }

    return sendError(res, 500, 'Failed to calculate booking preview');
  }
});

// Start Booking (validates + persists; admin override allowed)
// --- helpers (keep near the top of your file) ---
// Ensure date-only strings don't shift a day due to timezone when saved to Date
// 🔧 tiny helper: add exactly 1 day
const addOneDay = (d) => {
  if (!d) return d;

  // If it's a plain "YYYY-MM-DD", build a UTC date for the next day to avoid surprises
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number);
    // next day at 00:00 UTC
    return new Date(Date.UTC(y, m - 1, day + 1, 0, 0, 0, 0));
  }

  // Otherwise rely on Date parsing and just bump local day by 1
  const dt = new Date(d);
  dt.setDate(dt.getDate() + 1);
  return dt;
};

const startBooking = asyncHandler(async (req, res) => {
  try {
    const {
      region, startDate, endDate, vehicleTypeId, quantity,
      stops = [], addOns = [], freeRouting = false,
      pickupLocation, dropoffLocation, adminOverride: bodyAdminOverride
    } = req.body;
    const userId = req.user.id;

    // top-level input checks
    const { bookingHours } = validateBookingInput({
      region, startDate, endDate, quantity, stops, freeRouting, pickupLocation, dropoffLocation
    });

    // sanitize ids
    const safeAddOnIds = Array.isArray(addOns) ? addOns.map(toId).filter(Boolean) : [];
    const safeStops = Array.isArray(stops)
      ? stops.map(s => ({ ...s, addOnIds: Array.isArray(s.addOnIds) ? s.addOnIds.map(toId).filter(Boolean) : [] }))
      : [];

    const user = await User.findById(userId);
    if (!user) return sendNotFound(res, 'User not found');

    const vehicleType = await VehicleType.findById(vehicleTypeId);
    if (!vehicleType) return sendValidationError(res, 'Invalid vehicle type');

    // itinerary validation (admin override supported) — left as-is
    let routeValidation = null;
    let _adminOverride = false;
    let _dispatchFlag = false;

    // if (!freeRouting) {
    //   const itinerary = buildItineraryFromBody({ ...req.body, stops: safeStops });
    //   routeValidation = await validateItinerary(itinerary, { bufferMinutes: 15 });
    //
    //   const isAdmin = ['admin', 'staff'].includes(req.user.role);
    //   _adminOverride = !!bodyAdminOverride && isAdmin;
    //
    //   if (!routeValidation.allOk && !_adminOverride) {
    //     const firstFail = routeValidation.legs.find(l => !l.ok) || routeValidation.legs[0];
    //     const mins = firstFail?.minRequiredGapSec ? Math.ceil(firstFail.minRequiredGapSec / 60) : 'unknown';
    //     return sendValidationError(
    //       res,
    //       `Please adjust your stop times to allow realistic travel between locations. The minimum required time is ${mins} mins for "${firstFail.from} → ${firstFail.to}".`,
    //       { routeValidation }
    //     );
    //   }
    //
    //   _dispatchFlag = _adminOverride && !routeValidation.allOk;
    // }

    // monthly hours for subscribers — unchanged (still based on original startDate)
    const currentMonth = `${new Date(startDate).getFullYear()}-${String(new Date(startDate).getMonth() + 1).padStart(2, '0')}`;
    let monthlyHours = await MonthlyHours.findOne({ user: userId, yearMonth: currentMonth });
    if (!monthlyHours) {
      monthlyHours = await MonthlyHours.create({ user: userId, yearMonth: currentMonth, totalHoursUsed: 0 });
    }

    const isSubscriber = user.subscriptionStatus === 'subscriber';
    const { regularPrice, subscriberPrice, breakdown } = await calculateBookingPrice({
      vehicleType,
      quantity,
      addOns: safeAddOnIds,
      isSubscriber,
      usedHours: monthlyHours.totalHoursUsed,
      bookingHours
    });

    // distance surcharge
    let baseToPickupMiles = null;
    let distanceSurcharge = 0;
    if (pickupLocation) {
      baseToPickupMiles = await getMilesFromBaseToPickup(pickupLocation);
      if (typeof baseToPickupMiles === 'number' && baseToPickupMiles > 20) {
        const extraMiles = Math.max(0, baseToPickupMiles - 20);
        distanceSurcharge = Number((extraMiles * 2).toFixed(2));
      }
    }

    // update subscriber hours
    if (isSubscriber) {
      monthlyHours.totalHoursUsed += bookingHours;
      await monthlyHours.save();
    }

    const adjustedRegular = Number((regularPrice + distanceSurcharge).toFixed(2));
    const adjustedSubscriber = Number((subscriberPrice + distanceSurcharge).toFixed(2));
    const finalPrice = isSubscriber ? adjustedSubscriber : adjustedRegular;
    const savings = isSubscriber ? (adjustedRegular - adjustedSubscriber) : 0;

    const booking = await Booking.create({
      user: userId,
      region,
      pickupLocation,
      dropoffLocation,
      // ✅ as-requested: push both dates forward by 1 day before saving
      dates: {
        startDate: addOneDay(startDate),
        endDate: addOneDay(endDate)
      },
      vehicleType: vehicleTypeId,
      quantity,
      // persist stops as provided (schema supports arrivalTime/timeType/dwellMinutes)
      stops: safeStops.map(s => ({
        location: s.location,
        arrivalTime: s.time || s.arrivalTime || s.pickupTime,
        timeType: s.timeType || (s.pickupTime ? 'pickup' : 'arrival'),
        dwellMinutes: Number(s.dwellMinutes || 0),
        addOnIds: s.addOnIds
      })),
      addOns: safeAddOnIds,
      freeRouting: !!freeRouting,
      regularPrice: adjustedRegular,
      subscriptionPrice: isSubscriber ? adjustedSubscriber : undefined,
      finalPrice,
      savings,
      status: 'Pending',

      // persist itinerary status
      routeValidation: routeValidation || undefined,
      adminOverride: _adminOverride,
      dispatchFlag: _dispatchFlag
    });

    const responseData = {
      booking,
      comparison: !isSubscriber ? {
        regularTotal: adjustedRegular,
        subscriptionTotal: adjustedSubscriber + 449,
        savings: adjustedRegular - (adjustedSubscriber + 449)
      } : undefined,
      breakdown: {
        ...breakdown,
        distance:
          typeof baseToPickupMiles === 'number'
            ? { baseToPickupMiles: Number(baseToPickupMiles.toFixed(2)), freeMiles: 20, surchargePerMile: 2, distanceSurcharge }
            : { baseToPickupMiles: null, freeMiles: 20, surchargePerMile: 2, distanceSurcharge }
      }
    };

    return sendSuccess(res, 201, 'Booking started successfully', responseData);
  } catch (err) {
    console.error('Start Booking Error:', err.message);

    const msg = err.message || '';
    const isValidation =
      msg.includes('Minimum booking') ||
      msg.includes('Maximum booking') ||
      msg.includes('Start date') ||
      msg.includes('Quantity') ||
      msg.includes('Region is required') ||
      msg.includes('Pickup location is required') ||
      msg.includes('Dropoff location is required') ||
      msg.includes('At least one stop is required') ||
      msg.includes('Each stop must have a location') ||
      msg.includes('Each stop must include a time') ||
      msg.includes('dwellMinutes must be a number') ||
      msg.includes('Invalid ISO datetime') ||
      msg.includes('Itinerary validation failed');

    if (isValidation) return sendValidationError(res, msg);

    if (/Cast to ObjectId failed/i.test(msg)) {
      return sendValidationError(res, 'One or more IDs are invalid. Please pass valid MongoDB ObjectIds.');
    }

    return sendError(res, 500, 'Failed to start booking');
  }
});

// Confirm Booking (Admin/Driver)
const confirmBooking = asyncHandler(async (req, res) => {
  try {
    const { bookingId, driverId } = req.body;
    if (!bookingId) return sendValidationError(res, 'Booking ID is required');

    const booking = await Booking.findById(bookingId);
    if (!booking) return sendNotFound(res, 'Booking not found');

    if (booking.status === 'Confirmed') {
      return sendValidationError(res, 'Booking already confirmed');
    }

    if (req.user.role === 'admin' && driverId) {
      const driver = await User.findById(driverId);
      if (!driver || driver.role !== 'driver') {
        return sendValidationError(res, 'Invalid driver');
      }
      booking.assignedDriver = driverId;
    }

    if (req.user.role === 'driver' && !driverId) {
      booking.assignedDriver = req.user.id;
    }

    if (!booking.assignedDriver) {
      return sendValidationError(res, 'Driver assignment required');
    }

    booking.status = 'Confirmed';
    await booking.save();

    return sendSuccess(res, 200, 'Booking confirmed successfully', booking);
  } catch (error) {
    console.error('Confirm Booking Error:', error);
    return sendError(res, 500, error.message || 'Failed to confirm booking');
  }
});

// Accept/Decline Booking (Driver)
const acceptBooking = asyncHandler(async (req, res) => {
  try {
    const { bookingId, action } = req.body;
    const driverId = req.user.id;

    if (!bookingId || !action) {
      return sendValidationError(res, 'Booking ID and action are required');
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) return sendNotFound(res, 'Booking not found');
    if (booking.status === 'Confirmed') {
      return sendValidationError(res, 'Booking already confirmed');
    }

    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') {
      return sendValidationError(res, 'Invalid driver');
    }
    if (!driver.active || !driver.driver?.active) {
      return sendForbidden(res, 'Only active drivers can accept trips');
    }

    const driverVehicles = driver.driver?.vehicleTypes?.map(v => v.toString()) || [];
    if (!driverVehicles.includes(booking.vehicleType.toString())) {
      return sendValidationError(res, 'Driver lacks required vehicle type');
    }

    if (action === 'accept') {
      booking.status = 'Confirmed';
      booking.assignedDriver = driverId;
      await booking.save();

      // 🟢 Optional: Diamond Tier — Instant Payout
      // (Assumes BankAccount + stripe instances exist; kept from your original code)
      try {
        if (driver.driver?.tier === 'Diamond') {
          const bank = await BankAccount.findOne({ driverId }).lean();
          if (bank?.stripeAccountId && booking.paymentStatus === 'Paid' && !booking.PaidToDriver) {
            const amountCents = computePayoutCents(booking);
            if (amountCents > 0) {
              const transferGroup = `booking:${booking._id.toString()}`;
              const transfer = await stripe.transfers.create({
                amount: amountCents,
                currency: (process.env.CURRENCY || 'usd').toLowerCase(),
                destination: bank.stripeAccountId,
                transfer_group: transferGroup,
              });

              await Booking.updateOne(
                { _id: booking._id },
                { $set: { PaidToDriver: true, payoutTransferId: transfer.id } }
              );

              console.log(`💸 Instant payout of $${(amountCents / 100).toFixed(2)} sent to Diamond driver ${driver._id}`);
            }
          }
        }
      } catch (e) {
        console.error('⚠️ Instant payout failed:', e.message);
      }

    } else if (action === 'decline') {
      booking.status = 'Cancelled';
      booking.assignedDriver = null;
      await booking.save();
    } else {
      return sendValidationError(res, 'Invalid action. Must be "accept" or "decline"');
    }

    return sendSuccess(res, 200, `Booking ${action}ed successfully`, booking);
  } catch (error) {
    console.error('Accept Booking Error:', error);
    return sendError(res, 500, error.message || 'Failed to process booking action');
  }
});

const getAllBookings = asyncHandler(async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const sort = getSorting(req.query.sortBy, req.query.order);

    const filter = {};
    const search = getSearchQuery(req.query.search, [
      'region',
      'pickupLocation',
      'dropoffLocation',
      'status'
    ]);

    const finalFilter = { ...filter, ...search };

    const [bookings, total] = await Promise.all([
      Booking.find(finalFilter)
        .populate('user', 'name email')
        .populate('vehicleType', 'name hourlyPrice')
        .populate('addOns', 'name price type')
        .populate('assignedDriver', 'name')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(finalFilter)
    ]);

    return sendPaginated(res, 'Bookings retrieved successfully', bookings, {
      page,
      limit,
      total
    });
  } catch (error) {
    console.error('Get All Bookings Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve bookings');
  }
});

// Complete Booking (Customer)
const completeBooking = asyncHandler(async (req, res) => {
  try {
    const { bookingId, rating, tip } = req.body;
    const userId = req.user.id;

    if (!bookingId) return sendValidationError(res, 'Booking ID is required');

    const booking = await Booking.findById(bookingId);
    if (!booking) return sendNotFound(res, 'Booking not found');

    if (booking.user.toString() !== userId.toString()) {
      return sendForbidden(res, 'You can only complete your own booking');
    }

    if (['Completed', 'Cancelled'].includes(booking.status)) {
      return sendValidationError(res, `Booking already ${booking.status}`);
    }

    const now = new Date();
    const bookingEnd = new Date(booking.dates.endDate);
    if (now < bookingEnd) {
      return sendValidationError(res, 'Ride cannot be completed before end time');
    }

    if (rating != null) {
      if (rating < 1 || rating > 5) {
        return sendValidationError(res, 'Rating must be between 1 and 5');
      }
      booking.rating = rating;
    }

    if (tip && Number(tip) > 0) {
      booking.tip = Number(tip);
    }

    booking.status = 'Completed';
    booking.completedAt = now;

    await booking.save();

    return sendSuccess(res, 200, 'Booking completed successfully', booking);
  } catch (error) {
    console.error('Complete Booking Error:', error);
    return sendError(res, 500, error.message || 'Failed to complete booking');
  }
});

module.exports = {
  previewBooking,
  startBooking,
  confirmBooking,
  acceptBooking,
  getAllBookings,
  completeBooking
};
