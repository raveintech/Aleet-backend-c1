/**
 * controllers/bookingController.js
 * ---------------------------------------------------------------------------
 * Booking controllers only — no business logic or utilities here.
 *
 * Dependencies:
 *   utils/bookingHelpers.js      — validation, pricing, itinerary helpers
 *   services/googleRoutesService.js — Google Routes API (distance surcharge)
 * ---------------------------------------------------------------------------
 */

const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const User = require('../models/User');
const VehicleType = require('../models/Vehicle');
const MonthlyHours = require('../models/MonthlyHours');
const TierSettings = require('../models/TierSettings');

const { getPagination, getSorting, getSearchQuery } = require('../utils/queryHelper');
const {
  sendSuccess,
  sendError,
  sendValidationError,
  sendNotFound,
  sendForbidden,
  sendPaginated
} = require('../utils/responseHelper');
const { computePayoutCents } = require('../services/payoutUtils');
const { getMilesFromBase } = require('../services/googleRoutesService');
const { getRegionSameDayStatus } = require('../services/availabilityService');
const { sendTripAlertSMS, sendTripAlert, formatTripTime } = require('../services/twilioService');
const { autoDispatchBooking, evaluateDriver } = require('../services/dispatchService');
const {
  toId,
  validateBookingInput,
  validateFinalBookingInput,
  buildItineraryFromBody,
  validateItinerary,
  resolveMemberRate,
  calculateBookingPrice
} = require('../utils/bookingHelpers');

// ---------------------------------------------------------------------------
// Shared: distance surcharge breakdown builder
// ---------------------------------------------------------------------------
function buildDistanceBreakdown(baseToPickupMiles, distanceSurcharge) {
  return {
    baseToPickupMiles: baseToPickupMiles !== null ? Number(baseToPickupMiles.toFixed(2)) : null,
    freeMiles: 20,
    surchargePerMile: 2,
    distanceSurcharge
  };
}

// ---------------------------------------------------------------------------
// Shared: compute distanceSurcharge from miles
// ---------------------------------------------------------------------------
async function resolveDistanceSurcharge(pickupLocation) {
  if (!pickupLocation) return { baseToPickupMiles: null, distanceSurcharge: 0 };

  const miles = await getMilesFromBase(pickupLocation);
  if (typeof miles !== 'number') return { baseToPickupMiles: null, distanceSurcharge: 0 };

  const surcharge = miles > 20 ? Number(((miles - 20) * 2).toFixed(2)) : 0;
  return { baseToPickupMiles: miles, distanceSurcharge: surcharge };
}

// ---------------------------------------------------------------------------
// Shared: fire-and-forget trip-alert SMS (SMS failure must not break booking ops)
// ---------------------------------------------------------------------------
function safeSendTripAlert(phone, message) {
  if (!phone || !message) return;
  Promise.resolve(sendTripAlertSMS(phone, message)).catch((err) => {
    console.error('Trip-alert SMS failed:', err?.message || err);
  });
}

function formatTripWindow(startDate) {
  try {
    return new Date(startDate).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Shared: membership-trip marker — only Pro & Diamond can fulfill these
// ---------------------------------------------------------------------------
function isMembershipTrip(booking) {
  return booking?.subscriptionPrice != null;
}

// ---------------------------------------------------------------------------
// Shared: region binding — true if the driver is allowed to serve this region
// ---------------------------------------------------------------------------
function driverServesRegion(driverDoc, regionId) {
  if (!driverDoc || !regionId) return false;
  const d = driverDoc.driver || {};
  // Default-open: serve all unless explicitly restricted
  if (d.serveAllRegions !== false) return true;
  const allowed = Array.isArray(d.regions) ? d.regions : [];
  return allowed.some((r) => String(r) === String(regionId));
}

// ---------------------------------------------------------------------------
// Shared: driver-scoped booking DTO — hides guest totals, exposes payout only
// ---------------------------------------------------------------------------
function toDriverBooking(booking, driver, settings) {
  const obj = booking?.toObject ? booking.toObject() : booking;
  if (!obj) return obj;
  const payoutCents = computePayoutCents(obj, driver, settings);
  return {
    _id: obj._id,
    status: obj.status,
    region: obj.region,
    bookingMode: obj.bookingMode,
    dates: obj.dates,
    durationHours: obj.durationHours,
    vehicleType: obj.vehicleType,
    quantity: obj.quantity,
    pickupLocation: obj.pickupLocation,
    dropoffLocation: obj.dropoffLocation,
    stops: obj.stops,
    specialNotes: obj.specialNotes,
    assignedDriver: obj.assignedDriver,
    addOns: obj.addOns,
    freeRouting: obj.freeRouting,
    tip: obj.tip,
    completedAt: obj.completedAt,
    paymentStatus: obj.paymentStatus,
    PaidToDriver: obj.PaidToDriver,
    payoutCents,
    payoutDollars: Math.round(payoutCents) / 100,
  };
}

// ---------------------------------------------------------------------------
// Shared: validation error message matcher
// ---------------------------------------------------------------------------
const VALIDATION_PHRASES = [
  'Minimum booking', 'Maximum booking', 'Start date', 'Quantity',
  'Region is required', 'Pickup location is required', 'Dropoff location is required',
  'At least one stop', 'Each stop must have a location',
  'dwellMinutes must be a number', 'Invalid ISO datetime', 'Itinerary validation failed',
  'Duration must be a positive number of hours',
  'Earliest pickup'
];

function isValidationError(msg) {
  return VALIDATION_PHRASES.some(p => msg.includes(p));
}

function handleBookingError(res, err, context) {
  console.error(`${context} Error:`, err.message);
  const msg = err.message || '';
  if (isValidationError(msg)) return sendValidationError(res, msg);
  if (/Cast to ObjectId failed/i.test(msg)) {
    return sendValidationError(res, 'One or more IDs are invalid. Please pass valid MongoDB ObjectIds.');
  }
  return sendError(res, 500, `Failed to ${context.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

/**
 * POST /api/bookings/preview
 * Calculate price without persisting. pickupLocation is optional.
 */
const previewBooking = asyncHandler(async (req, res) => {
  try {
    const {
      region, startDate, endDate, vehicleTypeId, quantity,
      stops = [], addOns = [], freeRouting = false,
      pickupLocation, dropoffLocation,
      bookingMode = 'multi_day',
      durationHours,
      duration
    } = req.body;

    const resolvedBookingMode = bookingMode === 'buy_hours' ? 'buy_hours' : 'multi_day';
    const effectiveDurationHours = Number(durationHours ?? duration);
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    if (resolvedBookingMode === 'buy_hours') {
      if (!effectiveStartDate) throw new Error('Start date is required');
      if (!Number.isFinite(effectiveDurationHours) || effectiveDurationHours <= 0) {
        throw new Error('Duration must be a positive number of hours');
      }
      const startMs = new Date(effectiveStartDate).getTime();
      if (Number.isNaN(startMs)) throw new Error('Invalid ISO datetime for startDate. Use UTC ISO like 2025-10-12T16:00:00.000Z');
      effectiveEndDate = new Date(startMs + (effectiveDurationHours * 60 * 60 * 1000)).toISOString();
    }

    const [user, vehicleType] = await Promise.all([
      User.findById(req.user.id),
      VehicleType.findById(vehicleTypeId)
    ]);
    if (!user) return sendNotFound(res, 'User not found');
    if (!vehicleType) return sendValidationError(res, 'Invalid vehicle type');

    const isSubscriber = user.subscriptionStatus === 'subscriber';

    const { bookingHours } = validateBookingInput({
      region,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      quantity,
      bookingMode: resolvedBookingMode,
      durationHours: effectiveDurationHours,
      isSubscriber,
    });

    const safeAddOnIds = Array.isArray(addOns) ? addOns.map(toId).filter(Boolean) : [];
    const safeStops = Array.isArray(stops)
      ? stops.map(s => ({ ...s, addOnIds: Array.isArray(s.addOnIds) ? s.addOnIds.map(toId).filter(Boolean) : [] }))
      : [];

    // Route validation — only when all location data is present (non-blocking on preview)
    let routeValidation = null;
    if (!freeRouting && pickupLocation && dropoffLocation && safeStops.length > 0) {
      const itinerary = buildItineraryFromBody({ ...req.body, stops: safeStops });
      routeValidation = await validateItinerary(itinerary, { bufferMinutes: 15 });
    }

    const currentMonth = `${new Date(effectiveStartDate).getFullYear()}-${String(new Date(effectiveStartDate).getMonth() + 1).padStart(2, '0')}`;
    const monthlyHours = await MonthlyHours.findOne({ user: req.user.id, yearMonth: currentMonth }) || { totalHoursUsed: 0 };

    const tierSettings = await TierSettings.findOne().lean();
    const memberRate = resolveMemberRate(user, tierSettings);

    const { regularPrice, subscriberPrice, breakdown } = await calculateBookingPrice({
      vehicleType, quantity, addOns: safeAddOnIds, isSubscriber, memberRate,
      usedHours: monthlyHours.totalHoursUsed, bookingHours
    });

    const { baseToPickupMiles, distanceSurcharge } = await resolveDistanceSurcharge(pickupLocation);

    const regTotal = Number((regularPrice + distanceSurcharge).toFixed(2));
    const subTotal = Number((subscriberPrice + distanceSurcharge).toFixed(2));
    const total = isSubscriber ? subTotal : regTotal;

    return sendSuccess(res, 200, 'Booking preview calculated', {
      vehicleType,
      bookingMode: resolvedBookingMode,
      quantity,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      durationHours: resolvedBookingMode === 'buy_hours' ? effectiveDurationHours : undefined,
      hours: bookingHours,
      regularPrice: regTotal,
      subscriptionPrice: isSubscriber ? subTotal : undefined,
      total,
      breakdown: {
        ...breakdown,
        distance: buildDistanceBreakdown(baseToPickupMiles, distanceSurcharge)
      },
      routeValidation
    });
  } catch (err) {
    return handleBookingError(res, err, 'Preview Booking');
  }
});

/**
 * POST /api/bookings
 * Validate all fields and persist the booking.
 */
const startBooking = asyncHandler(async (req, res) => {
  try {
    const {
      region, startDate, endDate, vehicleTypeId, quantity,
      stops = [], addOns = [], freeRouting = false,
      pickupLocation, dropoffLocation, adminOverride: bodyAdminOverride,
      specialNotes,
      bookingMode = 'multi_day',
      durationHours,
      duration
    } = req.body;

    const resolvedBookingMode = bookingMode === 'buy_hours' ? 'buy_hours' : 'multi_day';
    const effectiveDurationHours = Number(durationHours ?? duration);
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;
    const effectiveFreeRouting = resolvedBookingMode === 'buy_hours' ? true : !!freeRouting;
    const inputStops = stops;

    if (resolvedBookingMode === 'buy_hours') {
      if (!effectiveStartDate) throw new Error('Start date is required');
      if (!Number.isFinite(effectiveDurationHours) || effectiveDurationHours <= 0) {
        throw new Error('Duration must be a positive number of hours');
      }
      const startMs = new Date(effectiveStartDate).getTime();
      if (Number.isNaN(startMs)) throw new Error('Invalid ISO datetime for startDate. Use UTC ISO like 2025-10-12T16:00:00.000Z');
      effectiveEndDate = new Date(startMs + (effectiveDurationHours * 60 * 60 * 1000)).toISOString();
    }

    const [user, vehicleType] = await Promise.all([
      User.findById(req.user.id),
      VehicleType.findById(vehicleTypeId)
    ]);
    if (!user) return sendNotFound(res, 'User not found');
    if (!vehicleType) return sendValidationError(res, 'Invalid vehicle type');

    const isSubscriber = user.subscriptionStatus === 'subscriber';

    const { bookingHours } = validateBookingInput({
      region,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      quantity,
      bookingMode: resolvedBookingMode,
      durationHours: effectiveDurationHours,
      isSubscriber,
    });
    validateFinalBookingInput({
      pickupLocation,
      dropoffLocation,
      stops: inputStops,
      freeRouting: effectiveFreeRouting,
      bookingMode: resolvedBookingMode
    });

    // Same-day availability gate — a guest cannot book a same-day trip in a
    // region where same-day is OFF (AQD-RB-CL formula fails or admin-blocked).
    // Admin-created trips bypass availability logic entirely.
    const isAdminBooker = ['admin', 'staff'].includes(req.user.role);
    const sameDayBooking =
      new Date(effectiveStartDate).getTime() - Date.now() <= 24 * 60 * 60 * 1000;
    if (!isAdminBooker && sameDayBooking) {
      // Measure committed drivers against THIS trip's window so a driver busy
      // on a non-overlapping trip still counts toward available coverage.
      const sameDayStatus = await getRegionSameDayStatus(region, {
        windowStart: effectiveStartDate,
        windowEnd: effectiveEndDate,
      });
      if (sameDayStatus && !sameDayStatus.available) {
        return sendValidationError(
          res,
          sameDayStatus.message ||
            'Same-day booking is currently unavailable for this region. Please choose a later pickup time.',
          {
            eligibility: {
              eligible: false,
              reason: sameDayStatus.reason || 'same_day_unavailable',
              sameDay: {
                aqd: sameDayStatus.aqd,
                rb: sameDayStatus.rb,
                cl: sameDayStatus.cl,
                mct: sameDayStatus.mct,
              },
            },
          },
        );
      }
    }

    const safeAddOnIds = Array.isArray(addOns) ? addOns.map(toId).filter(Boolean) : [];
    const safeStops = Array.isArray(inputStops)
      ? inputStops.map(s => ({ ...s, addOnIds: Array.isArray(s.addOnIds) ? s.addOnIds.map(toId).filter(Boolean) : [] }))
      : [];

    // Route validation (admin override supported) — enforces the 15-min buffer per leg
    let routeValidation = null;
    let _adminOverride = false;
    let _dispatchFlag = false;
    if (!effectiveFreeRouting && pickupLocation && dropoffLocation && safeStops.length > 0) {
      const itinerary = buildItineraryFromBody({
        pickupLocation,
        dropoffLocation,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
        stops: safeStops,
      });
      routeValidation = await validateItinerary(itinerary, { bufferMinutes: 15 });
      const isAdmin = ['admin', 'staff'].includes(req.user.role);
      _adminOverride = !!bodyAdminOverride && isAdmin;

      // Distinguish two failure modes:
      //   1. Routes API couldn't compute the ETA (minRequiredGapSec === null).
      //      That's a 3rd-party hiccup, not the guest's fault — let the booking
      //      through with dispatchFlag so admin can review.
      //   2. The drive time WAS computed but the guest didn't give enough gap.
      //      That's a real validation error — show "Minimum required time is X mins".
      const realConflict = routeValidation.legs.find((l) => !l.ok && l.minRequiredGapSec != null);
      const apiUnavailable = !routeValidation.allOk && !realConflict;

      if (realConflict && !_adminOverride) {
        const mins = Math.ceil(realConflict.minRequiredGapSec / 60);
        return sendValidationError(
          res,
          `Minimum required time is ${mins} mins for "${realConflict.from} → ${realConflict.to}".`,
          { routeValidation }
        );
      }
      // Either a real conflict that admin overrode, or the Routes API couldn't
      // validate at least one leg — flag for internal review either way.
      _dispatchFlag = (_adminOverride && !routeValidation.allOk) || apiUnavailable;
    }

    const currentMonth = `${new Date(effectiveStartDate).getFullYear()}-${String(new Date(effectiveStartDate).getMonth() + 1).padStart(2, '0')}`;
    let monthlyHours = await MonthlyHours.findOne({ user: req.user.id, yearMonth: currentMonth });
    if (!monthlyHours) {
      monthlyHours = await MonthlyHours.create({ user: req.user.id, yearMonth: currentMonth, totalHoursUsed: 0 });
    }

    const tierSettings = await TierSettings.findOne().lean();
    const memberRate = resolveMemberRate(user, tierSettings);

    const { regularPrice, subscriberPrice, breakdown } = await calculateBookingPrice({
      vehicleType, quantity, addOns: safeAddOnIds, stops: safeStops, isSubscriber, memberRate,
      usedHours: monthlyHours.totalHoursUsed, bookingHours
    });

    const { baseToPickupMiles, distanceSurcharge } = await resolveDistanceSurcharge(pickupLocation);

    if (isSubscriber) {
      monthlyHours.totalHoursUsed += bookingHours;
      await monthlyHours.save();
    }

    const adjustedRegular = Number((regularPrice + distanceSurcharge).toFixed(2));
    const adjustedSubscriber = Number((subscriberPrice + distanceSurcharge).toFixed(2));
    const finalPrice = isSubscriber ? adjustedSubscriber : adjustedRegular;
    const savings = isSubscriber ? Number((adjustedRegular - adjustedSubscriber).toFixed(2)) : 0;

    const booking = await Booking.create({
      user: req.user.id,
      region,
      bookingMode: resolvedBookingMode,
      pickupLocation,
      dropoffLocation: dropoffLocation || null,
      dates: { startDate: new Date(effectiveStartDate), endDate: new Date(effectiveEndDate) },
      durationHours: resolvedBookingMode === 'buy_hours' ? effectiveDurationHours : bookingHours,
      vehicleType: vehicleTypeId,
      quantity,
      stops: safeStops.map(s => ({
        location: s.location,
        arrivalTime: s.time || s.arrivalTime || s.pickupTime,
        timeType: s.timeType || (s.pickupTime ? 'pickup' : 'arrival'),
        dwellMinutes: Number(s.dwellMinutes || 0),
        notes: s.notes || null,
        addOnIds: s.addOnIds
      })),
      specialNotes: typeof specialNotes === 'string' ? specialNotes.trim() || null : null,
      addOns: safeAddOnIds,
      freeRouting: effectiveFreeRouting,
      regularPrice: adjustedRegular,
      subscriptionPrice: isSubscriber ? adjustedSubscriber : undefined,
      finalPrice,
      savings,
      status: 'Pending',
      routeValidation: routeValidation || undefined,
      adminOverride: _adminOverride,
      dispatchFlag: _dispatchFlag
    });

    sendTripAlert(user, 'guest_booking_received', {
      when: formatTripTime(effectiveStartDate),
    }).catch(e => console.error('SMS guest_booking_received failed:', e?.message));

    // Auto-dispatch — send the trip offer to the first eligible tier.
    // Fire-and-forget: a dispatch failure must not break booking creation.
    (async () => {
      try {
        const { drivers } = await autoDispatchBooking(booking);
        const when = formatTripTime(effectiveStartDate);
        for (const driver of drivers) {
          sendTripAlert(driver, 'driver_trip_offer', {
            when,
            pickup: pickupLocation,
          }).catch(e => console.error('SMS driver_trip_offer failed:', e?.message));
        }
      } catch (e) {
        console.error('Auto-dispatch failed:', e?.message || e);
      }
    })();

    return sendSuccess(res, 201, 'Booking started successfully', {
      booking,
      comparison: !isSubscriber ? {
        regularTotal: adjustedRegular,
        subscriptionTotal: adjustedSubscriber + 449,
        savings: adjustedRegular - (adjustedSubscriber + 449)
      } : undefined,
      breakdown: {
        ...breakdown,
        distance: buildDistanceBreakdown(baseToPickupMiles, distanceSurcharge)
      }
    });
  } catch (err) {
    return handleBookingError(res, err, 'Start Booking');
  }
});

/**
 * POST /api/bookings/confirm
 * Assign a driver and confirm a pending booking (Admin or Driver).
 */
const confirmBooking = asyncHandler(async (req, res) => {
  try {
    const { bookingId, driverId } = req.body;
    if (!bookingId) return sendValidationError(res, 'Booking ID is required');

    const booking = await Booking.findById(bookingId);
    if (!booking) return sendNotFound(res, 'Booking not found');
    if (booking.status === 'Confirmed') return sendValidationError(res, 'Booking already confirmed');

    let assignedDriverDoc = null;
    if (req.user.role === 'admin' && driverId) {
      assignedDriverDoc = await User.findById(driverId);
      if (!assignedDriverDoc || assignedDriverDoc.role !== 'driver') return sendValidationError(res, 'Invalid driver');
      booking.assignedDriver = driverId;
    }

    if (req.user.role === 'driver' && !driverId) {
      booking.assignedDriver = req.user.id;
      assignedDriverDoc = await User.findById(req.user.id);
    }

    if (!booking.assignedDriver) return sendValidationError(res, 'Driver assignment required');

    // Tier + region gates — same rules whether admin assigns or driver self-confirms
    const resolvedDriver = await User.findById(booking.assignedDriver)
      .select('role driver.tier driver.regions driver.serveAllRegions')
      .lean();
    if (!resolvedDriver || resolvedDriver.role !== 'driver') {
      return sendValidationError(res, 'Invalid driver');
    }
    if (isMembershipTrip(booking) && resolvedDriver.driver?.tier === 'S-Level') {
      return sendForbidden(res, 'Membership trips can only be assigned to Pro or Diamond drivers');
    }
    if (!driverServesRegion(resolvedDriver, booking.region)) {
      return sendForbidden(res, "This driver doesn't serve the booking's region");
    }

    booking.status = 'Confirmed';
    await booking.save();

    // Trip-alert SMS — notify guest + driver
    const [guest, driver] = await Promise.all([
      User.findById(booking.user).select('phone name').lean(),
      User.findById(booking.assignedDriver).select('phone name').lean(),
    ]);
    const tripWindow = formatTripWindow(booking.dates?.startDate);
    if (guest?.phone) {
      safeSendTripAlert(
        guest.phone,
        `Aleet: Your driver has been assigned for your trip${tripWindow ? ` on ${tripWindow}` : ''}. Track details in the app.`
      );
    }
    if (driver?.phone && req.user.role === 'admin') {
      safeSendTripAlert(
        driver.phone,
        `Aleet: You've been assigned a new trip${tripWindow ? ` on ${tripWindow}` : ''}. Open the driver app for details.`
      );
    }

    if (req.user.role === 'driver') {
      const settings = await TierSettings.findOne().lean();
      const driverDoc = await User.findById(req.user.id).lean();
      return sendSuccess(res, 200, 'Booking confirmed successfully', toDriverBooking(booking, driverDoc, settings));
    }

    return sendSuccess(res, 200, 'Booking confirmed successfully', booking);
  } catch (error) {
    console.error('Confirm Booking Error:', error);
    return sendError(res, 500, error.message || 'Failed to confirm booking');
  }
});

/**
 * POST /api/bookings/accept
 * Driver accepts (or declines) an offered trip.
 *
 * Accept is race-safe — uses an atomic findOneAndUpdate so only one driver
 * can win a contested booking; everyone else gets a "Trip already taken"
 * 409. Decline is a soft no-op: the booking stays open for other drivers.
 */
const acceptBooking = asyncHandler(async (req, res) => {
  try {
    const { bookingId, action } = req.body;
    const driverId = req.user.id;

    if (!bookingId || !action) return sendValidationError(res, 'Booking ID and action are required');
    if (action !== 'accept' && action !== 'decline') {
      return sendValidationError(res, 'Invalid action. Must be "accept" or "decline"');
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) return sendNotFound(res, 'Booking not found');

    // Decline is soft — trip remains open for other eligible drivers in the offer pool
    if (action === 'decline') {
      return sendSuccess(res, 200, 'Trip declined — it will remain available to other drivers', {});
    }

    // Pre-flight checks (informational; the atomic update below is the real gate)
    if (booking.assignedDriver) return sendError(res, 409, 'Trip already taken');
    if (booking.status !== 'Pending') {
      return sendValidationError(res, `Booking is ${booking.status} and can no longer be accepted`);
    }

    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') return sendValidationError(res, 'Invalid driver');

    const { eligible, reason } = evaluateDriver(driver, booking);
    if (!eligible) return sendForbidden(res, reason || 'You are not eligible for this trip');

    // Tier-stage gate — only drivers in the current offer's tier pool can accept.
    // Older bookings (no offer state) skip the gate so legacy admin-confirm flows work.
    const offeredTiers = (booking.offer && booking.offer.tiers) || [];
    if (offeredTiers.length > 0 && !offeredTiers.includes(driver.driver?.tier)) {
      return sendForbidden(res, 'This trip is not currently being offered to your tier');
    }

    // Atomic claim — only one driver can win
    const claimed = await Booking.findOneAndUpdate(
      { _id: bookingId, assignedDriver: null, status: 'Pending' },
      {
        $set: {
          assignedDriver: driverId,
          status: 'Confirmed',
          'offer.stage': 0,
          'offer.expiresAt': null,
        },
      },
      { new: true },
    );
    if (!claimed) return sendError(res, 409, 'Trip already taken');

    // Notify guest the driver is on the way (fire-and-forget)
    try {
      const guest = await User.findById(claimed.user);
      if (guest) {
        sendTripAlert(guest, 'guest_driver_assigned', {
          driverName: driver.name,
          when: formatTripTime(claimed.dates?.startDate),
        }).catch(e => console.error('SMS guest_driver_assigned failed:', e?.message));
      }
    } catch (e) {
      console.error('Guest accept-notification lookup failed:', e?.message || e);
    }

    // Diamond tier — instant payout (existing behavior preserved)
    try {
      if (driver.driver?.tier === 'Diamond') {
        const BankAccount = require('../models/BankAccount');
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const bank = await BankAccount.findOne({ driverId }).lean();
        if (bank?.stripeAccountId && claimed.paymentStatus === 'Paid' && !claimed.PaidToDriver) {
          const amountCents = computePayoutCents(claimed);
          if (amountCents > 0) {
            const transfer = await stripe.transfers.create({
              amount: amountCents,
              currency: 'usd',
              destination: bank.stripeAccountId,
              transfer_group: `booking:${claimed._id}`,
            });
            await Booking.updateOne(
              { _id: claimed._id },
              { $set: { PaidToDriver: true, payoutTransferId: transfer.id } },
            );
            console.log(`💸 Instant payout $${(amountCents / 100).toFixed(2)} → Diamond driver ${driver._id}`);
          }
        }
      }
    } catch (e) {
      console.error('⚠️ Instant payout failed:', e?.message || e);
    }

    const settings = await TierSettings.findOne().lean();
    return sendSuccess(res, 200, 'Booking accepted successfully', toDriverBooking(claimed, driver, settings));
  } catch (error) {
    console.error('Accept Booking Error:', error);
    return sendError(res, 500, error.message || 'Failed to process booking action');
  }
});

/**
 * GET /api/bookings/open-trips
 * Driver — lists pending bookings whose current offer stage includes the
 * caller's tier and which they pass full eligibility on (vehicle/region/
 * membership). Newest offers first.
 */
const getOpenTrips = asyncHandler(async (req, res) => {
  try {
    if (req.user.role !== 'driver') return sendForbidden(res, 'Drivers only');

    const driver = await User.findById(req.user.id);
    if (!driver) return sendNotFound(res, 'Driver not found');
    if (driver.driver?.status !== 'approved') {
      return sendForbidden(res, 'Only approved drivers can view open trips');
    }

    const candidates = await Booking.find({
      status: 'Pending',
      assignedDriver: null,
      'offer.stage': { $gt: 0 },
      'offer.tiers': driver.driver.tier,
    })
      .populate('region', 'name code')
      .populate('vehicleType', 'name hourlyPrice')
      .sort({ 'offer.offeredAt': -1 });

    const eligible = candidates.filter((b) => evaluateDriver(driver, b).eligible);

    const settings = await TierSettings.findOne().lean();
    const dtos = eligible.map((b) => toDriverBooking(b, driver, settings));

    return sendSuccess(res, 200, 'Open trips retrieved', dtos);
  } catch (error) {
    console.error('Get Open Trips Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve open trips');
  }
});

/**
 * POST /api/bookings/driver-cancel
 * Driver — post-acceptance cancellation. Resets the booking to Pending so
 * the admin can re-dispatch or reassign. Increments the driver's
 * cancellationCount (admin settings convert that into rating/visibility
 * penalties separately).
 */
const driverCancelBooking = asyncHandler(async (req, res) => {
  try {
    const { bookingId, reason } = req.body;
    const driverId = req.user.id;

    if (!bookingId) return sendValidationError(res, 'Booking ID is required');

    const booking = await Booking.findById(bookingId);
    if (!booking) return sendNotFound(res, 'Booking not found');
    if (String(booking.assignedDriver) !== String(driverId)) {
      return sendForbidden(res, 'You are not assigned to this booking');
    }
    if (['Completed', 'Cancelled', 'Expired'].includes(booking.status)) {
      return sendValidationError(res, `Booking is already ${booking.status}`);
    }

    await Booking.updateOne(
      { _id: bookingId },
      {
        $set: {
          assignedDriver: null,
          status: 'Pending',
          'offer.stage': 0,
          'offer.offeredAt': null,
          'offer.expiresAt': null,
          'offer.tiers': [],
          cancellation: {
            cancelledBy: driverId,
            cancelledAt: new Date(),
            reason: reason || null,
          },
        },
      },
    );

    await User.updateOne(
      { _id: driverId },
      {
        $inc: { 'driver.cancellationCount': 1 },
        $set: { 'driver.lastCancellationAt': new Date() },
      },
    );

    // Notify guest (fire-and-forget)
    try {
      const guest = await User.findById(booking.user);
      if (guest) {
        sendTripAlert(guest, 'guest_trip_cancelled', {})
          .catch(e => console.error('SMS guest_trip_cancelled failed:', e?.message));
      }
    } catch (e) {
      console.error('Driver-cancel guest notification failed:', e?.message || e);
    }

    return sendSuccess(res, 200, 'Booking cancelled — admin will reassign', {
      bookingId,
      status: 'Pending',
    });
  } catch (error) {
    console.error('Driver Cancel Booking Error:', error);
    return sendError(res, 500, error.message || 'Failed to cancel booking');
  }
});

/**
 * GET /api/bookings
 * Paginated list of all bookings (Admin).
 */
const getAllBookings = asyncHandler(async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const sort = getSorting(req.query.sortBy, req.query.order);
    const search = getSearchQuery(req.query.search, ['pickupLocation', 'dropoffLocation', 'status']);

    if (req.query.status) search.status = req.query.status;
    if (req.query.bookingMode) search.bookingMode = req.query.bookingMode;
    if (req.query.paymentStatus) search.paymentStatus = req.query.paymentStatus;

    const [bookings, total] = await Promise.all([
      Booking.find(search)
        .populate('user', 'name email phone')
        .populate('region', 'name code')
        .populate('vehicleType', 'name hourlyPrice')
        .populate('addOns', 'name price type')
        .populate('assignedDriver', 'name phone')
        .sort(sort).skip(skip).limit(limit),
      Booking.countDocuments(search)
    ]);

    return sendPaginated(res, 'Bookings retrieved successfully', bookings, { page, limit, total });
  } catch (error) {
    console.error('Get All Bookings Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve bookings');
  }
});

/**
 * PATCH /api/bookings/:id/complete
 * Mark a booking as completed and optionally add rating/tip (Customer).
 */
const completeBooking = asyncHandler(async (req, res) => {
  try {
    const bookingId = req.params.id || req.body.bookingId;
    const { rating, tip } = req.body;
    const userId = req.user.id;

    if (!bookingId) return sendValidationError(res, 'Booking ID is required');

    const booking = await Booking.findById(bookingId);
    if (!booking) return sendNotFound(res, 'Booking not found');
    if (booking.user.toString() !== userId.toString()) return sendForbidden(res, 'You can only complete your own booking');
    if (['Completed', 'Cancelled'].includes(booking.status)) {
      return sendValidationError(res, `Booking already ${booking.status}`);
    }

    const now = new Date();
    if (now < new Date(booking.dates.endDate)) {
      return sendValidationError(res, 'Ride cannot be completed before end time');
    }

    if (rating != null) {
      if (rating < 1 || rating > 5) return sendValidationError(res, 'Rating must be between 1 and 5');
      booking.rating = rating;
    }
    if (tip && Number(tip) > 0) booking.tip = Number(tip);

    booking.status = 'Completed';
    booking.completedAt = now;
    await booking.save();

    // Notify guest of completion (fire-and-forget)
    (async () => {
      try {
        const guest = await User.findById(booking.user);
        if (guest) {
          sendTripAlert(guest, 'guest_trip_completed', {})
            .catch(e => console.error('SMS guest_trip_completed failed:', e?.message));
        }
      } catch (e) {
        console.error('SMS completeBooking dispatch failed:', e?.message);
      }
    })();

    return sendSuccess(res, 200, 'Booking completed successfully', booking);
  } catch (error) {
    console.error('Complete Booking Error:', error);
    return sendError(res, 500, error.message || 'Failed to complete booking');
  }
});

/**
 * GET /api/bookings/my
 * All bookings of the authenticated user, newest first.
 */
const getMyBookings = asyncHandler(async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const sort = getSorting(req.query.sortBy, req.query.order) || { createdAt: -1 };

    const filter = { user: req.user.id };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.bookingMode) filter.bookingMode = req.query.bookingMode;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('vehicleType', 'name hourlyPrice')
        .populate('addOns', 'name price type')
        .populate('stops.addOnIds', 'name price type')
        .populate('assignedDriver', 'name phone')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(filter)
    ]);

    return sendPaginated(res, 'Bookings retrieved successfully', bookings, { page, limit, total });
  } catch (error) {
    console.error('Get My Bookings Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve bookings');
  }
});

/**
 * GET /api/bookings/:id
 * Single booking — owner or admin only.
 */
const getBookingById = asyncHandler(async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('vehicleType', 'name hourlyPrice description')
      .populate('addOns', 'name price type description')
      .populate('stops.addOnIds', 'name price type description')
      .populate('assignedDriver', 'name phone')
      .populate('user', 'name email phone');

    if (!booking) return sendNotFound(res, 'Booking not found');

    const isOwner = booking.user._id.toString() === req.user.id.toString();
    const isAdminOrStaff = ['admin', 'staff'].includes(req.user.role);

    if (!isOwner && !isAdminOrStaff) {
      return sendForbidden(res, 'Access denied');
    }

    return sendSuccess(res, 200, 'Booking retrieved successfully', booking);
  } catch (error) {
    console.error('Get Booking By ID Error:', error);
    if (/Cast to ObjectId/i.test(error.message)) {
      return sendValidationError(res, 'Invalid booking ID');
    }
    return sendError(res, 500, error.message || 'Failed to retrieve booking');
  }
});

/**
 * GET /api/bookings/stats
 * Admin dashboard stats: counts by status + total value + unassigned count.
 */
const getAdminBookingStats = asyncHandler(async (req, res) => {
  try {
    const [statusCounts, totalValueAgg, unassigned] = await Promise.all([
      Booking.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Booking.aggregate([
        { $group: { _id: null, totalValue: { $sum: '$finalPrice' } } }
      ]),
      Booking.countDocuments({ assignedDriver: null, status: { $nin: ['Cancelled', 'Completed', 'Expired'] } })
    ]);

    const counts = { Pending: 0, Confirmed: 0, 'In Progress': 0, Completed: 0, Cancelled: 0, Expired: 0 };
    for (const { _id, count } of statusCounts) {
      if (_id in counts) counts[_id] = count;
    }

    const totalTrips = Object.values(counts).reduce((a, b) => a + b, 0);
    const totalValue = totalValueAgg[0]?.totalValue ?? 0;

    return sendSuccess(res, 200, 'Booking stats retrieved', {
      totalTrips,
      pending: counts.Pending,
      confirmed: counts.Confirmed,
      inProgress: counts['In Progress'],
      completed: counts.Completed,
      cancelled: counts.Cancelled,
      expired: counts.Expired,
      totalValue: Number(totalValue.toFixed(2)),
      unassigned
    });
  } catch (error) {
    console.error('Admin Booking Stats Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve booking stats');
  }
});

module.exports = {
  previewBooking,
  startBooking,
  confirmBooking,
  acceptBooking,
  getOpenTrips,
  driverCancelBooking,
  getAllBookings,
  getAdminBookingStats,
  getMyBookings,
  getBookingById,
  completeBooking
};
