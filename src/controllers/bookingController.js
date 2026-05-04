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
const {
  toId,
  validateBookingInput,
  validateFinalBookingInput,
  buildItineraryFromBody,
  validateItinerary,
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
// Shared: validation error message matcher
// ---------------------------------------------------------------------------
const VALIDATION_PHRASES = [
  'Minimum booking', 'Maximum booking', 'Start date', 'Quantity',
  'Region is required', 'Pickup location is required', 'Dropoff location is required',
  'At least one stop', 'Each stop must have a location',
  'dwellMinutes must be a number', 'Invalid ISO datetime', 'Itinerary validation failed',
  'Duration must be a positive number of hours'
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

    const { bookingHours } = validateBookingInput({
      region,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      quantity,
      bookingMode: resolvedBookingMode,
      durationHours: effectiveDurationHours
    });

    const safeAddOnIds = Array.isArray(addOns) ? addOns.map(toId).filter(Boolean) : [];
    const safeStops = Array.isArray(stops)
      ? stops.map(s => ({ ...s, addOnIds: Array.isArray(s.addOnIds) ? s.addOnIds.map(toId).filter(Boolean) : [] }))
      : [];

    const [user, vehicleType] = await Promise.all([
      User.findById(req.user.id),
      VehicleType.findById(vehicleTypeId)
    ]);
    if (!user) return sendNotFound(res, 'User not found');
    if (!vehicleType) return sendValidationError(res, 'Invalid vehicle type');

    // Route validation — only when all location data is present
    let routeValidation = null;
    if (!freeRouting && pickupLocation && dropoffLocation && safeStops.length > 0) {
      const itinerary = buildItineraryFromBody({ ...req.body, stops: safeStops });
      routeValidation = await validateItinerary(itinerary, { bufferMinutes: 15 });
      // Uncomment to enforce route validation:
      // if (!routeValidation.allOk) {
      //   const firstFail = routeValidation.legs.find(l => !l.ok) || routeValidation.legs[0];
      //   const mins = firstFail?.minRequiredGapSec ? Math.ceil(firstFail.minRequiredGapSec / 60) : 'unknown';
      //   return sendValidationError(res,
      //     `Minimum required time is ${mins} mins for "${firstFail.from} → ${firstFail.to}".`,
      //     { routeValidation }
      //   );
      // }
    }

    const currentMonth = `${new Date(effectiveStartDate).getFullYear()}-${String(new Date(effectiveStartDate).getMonth() + 1).padStart(2, '0')}`;
    const monthlyHours = await MonthlyHours.findOne({ user: req.user.id, yearMonth: currentMonth }) || { totalHoursUsed: 0 };

    const isSubscriber = user.subscriptionStatus === 'subscriber';
    const { regularPrice, subscriberPrice, breakdown } = await calculateBookingPrice({
      vehicleType, quantity, addOns: safeAddOnIds, isSubscriber,
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

    const { bookingHours } = validateBookingInput({
      region,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      quantity,
      bookingMode: resolvedBookingMode,
      durationHours: effectiveDurationHours
    });
    validateFinalBookingInput({
      pickupLocation,
      dropoffLocation,
      stops: inputStops,
      freeRouting: effectiveFreeRouting,
      bookingMode: resolvedBookingMode
    });

    const safeAddOnIds = Array.isArray(addOns) ? addOns.map(toId).filter(Boolean) : [];
    const safeStops = Array.isArray(inputStops)
      ? inputStops.map(s => ({ ...s, addOnIds: Array.isArray(s.addOnIds) ? s.addOnIds.map(toId).filter(Boolean) : [] }))
      : [];

    const [user, vehicleType] = await Promise.all([
      User.findById(req.user.id),
      VehicleType.findById(vehicleTypeId)
    ]);
    if (!user) return sendNotFound(res, 'User not found');
    if (!vehicleType) return sendValidationError(res, 'Invalid vehicle type');

    // Route validation (admin override supported)
    let routeValidation = null;
    let _adminOverride = false;
    let _dispatchFlag = false;
    // Uncomment to enforce:
    // if (!freeRouting) {
    //   const itinerary = buildItineraryFromBody({ ...req.body, stops: safeStops });
    //   routeValidation = await validateItinerary(itinerary, { bufferMinutes: 15 });
    //   const isAdmin = ['admin', 'staff'].includes(req.user.role);
    //   _adminOverride = !!bodyAdminOverride && isAdmin;
    //   if (!routeValidation.allOk && !_adminOverride) {
    //     const firstFail = routeValidation.legs.find(l => !l.ok) || routeValidation.legs[0];
    //     const mins = firstFail?.minRequiredGapSec ? Math.ceil(firstFail.minRequiredGapSec / 60) : 'unknown';
    //     return sendValidationError(res,
    //       `Minimum required time is ${mins} mins for "${firstFail.from} → ${firstFail.to}".`,
    //       { routeValidation }
    //     );
    //   }
    //   _dispatchFlag = _adminOverride && !routeValidation.allOk;
    // }

    const currentMonth = `${new Date(effectiveStartDate).getFullYear()}-${String(new Date(effectiveStartDate).getMonth() + 1).padStart(2, '0')}`;
    let monthlyHours = await MonthlyHours.findOne({ user: req.user.id, yearMonth: currentMonth });
    if (!monthlyHours) {
      monthlyHours = await MonthlyHours.create({ user: req.user.id, yearMonth: currentMonth, totalHoursUsed: 0 });
    }

    const isSubscriber = user.subscriptionStatus === 'subscriber';
    const { regularPrice, subscriberPrice, breakdown } = await calculateBookingPrice({
      vehicleType, quantity, addOns: safeAddOnIds, stops: safeStops, isSubscriber,
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
        addOnIds: s.addOnIds
      })),
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

    if (req.user.role === 'admin' && driverId) {
      const driver = await User.findById(driverId);
      if (!driver || driver.role !== 'driver') return sendValidationError(res, 'Invalid driver');
      booking.assignedDriver = driverId;
    }

    if (req.user.role === 'driver' && !driverId) {
      booking.assignedDriver = req.user.id;
    }

    if (!booking.assignedDriver) return sendValidationError(res, 'Driver assignment required');

    booking.status = 'Confirmed';
    await booking.save();

    return sendSuccess(res, 200, 'Booking confirmed successfully', booking);
  } catch (error) {
    console.error('Confirm Booking Error:', error);
    return sendError(res, 500, error.message || 'Failed to confirm booking');
  }
});

/**
 * POST /api/bookings/accept
 * Driver accepts or declines a booking. Diamond tier gets instant payout.
 */
const acceptBooking = asyncHandler(async (req, res) => {
  try {
    const { bookingId, action } = req.body;
    const driverId = req.user.id;

    if (!bookingId || !action) return sendValidationError(res, 'Booking ID and action are required');

    const booking = await Booking.findById(bookingId);
    if (!booking) return sendNotFound(res, 'Booking not found');
    if (booking.status === 'Confirmed') return sendValidationError(res, 'Booking already confirmed');

    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') return sendValidationError(res, 'Invalid driver');
    if (driver.driver?.status !== 'approved') return sendForbidden(res, 'Only active drivers can accept trips');

    const driverVehicles = driver.driver?.vehicleTypes?.map(v => v.toString()) || [];
    if (!driverVehicles.includes(booking.vehicleType.toString())) {
      return sendValidationError(res, 'Driver lacks required vehicle type');
    }

    if (action === 'accept') {
      booking.status = 'Confirmed';
      booking.assignedDriver = driverId;
      await booking.save();

      // Diamond Tier — Instant Payout
      try {
        if (driver.driver?.tier === 'Diamond') {
          const BankAccount = require('../models/BankAccount');
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const bank = await BankAccount.findOne({ driverId }).lean();
          if (bank?.stripeAccountId && booking.paymentStatus === 'Paid' && !booking.PaidToDriver) {
            const amountCents = computePayoutCents(booking);
            if (amountCents > 0) {
              const transfer = await stripe.transfers.create({
                amount: amountCents,
                currency: (process.env.CURRENCY || 'usd').toLowerCase(),
                destination: bank.stripeAccountId,
                transfer_group: `booking:${booking._id}`
              });
              await Booking.updateOne({ _id: booking._id }, { $set: { PaidToDriver: true, payoutTransferId: transfer.id } });
              console.log(`💸 Instant payout $${(amountCents / 100).toFixed(2)} → Diamond driver ${driver._id}`);
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

/**
 * GET /api/bookings
 * Paginated list of all bookings (Admin).
 */
const getAllBookings = asyncHandler(async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const sort = getSorting(req.query.sortBy, req.query.order);
    const search = getSearchQuery(req.query.search, ['region', 'pickupLocation', 'dropoffLocation', 'status']);

    const [bookings, total] = await Promise.all([
      Booking.find(search)
        .populate('user', 'name email')
        .populate('vehicleType', 'name hourlyPrice')
        .populate('addOns', 'name price type')
        .populate('assignedDriver', 'name')
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

module.exports = {
  previewBooking,
  startBooking,
  confirmBooking,
  acceptBooking,
  getAllBookings,
  getMyBookings,
  getBookingById,
  completeBooking
};
