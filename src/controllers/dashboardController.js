const asyncHandler = require('express-async-handler');
const Booking = require('../models/Booking');
const User = require('../models/User');
const MonthlyHours = require('../models/MonthlyHours');
const TierSettings = require('../models/TierSettings');
const { computePayoutCents } = require('../services/payoutUtils');
const mongoose = require('mongoose');

const {
  sendSuccess,
  sendError,
  sendNotFound,
} = require('../utils/responseHelper');
const logger = require('../utils/logger');

// ===== DASHBOARD STATISTICS ===== //

// Get Customer Dashboard Statistics
const getDashboardStats = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    // Get user info
    const user = await User.findById(userId).select('-password');
    if (!user) return sendNotFound(res, 'User not found');

    // --- FIXED AGGREGATION ---
    const allBookingsAgg = await Booking.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      {
        $lookup: {
          from: 'vehicletypes',
          localField: 'vehicleType',
          foreignField: '_id',
          as: 'vehicleType'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedDriver',
          foreignField: '_id',
          as: 'assignedDriver'
        }
      },
      // ✅ FIX: remove unwind or use conditional unwind safely
      {
        $addFields: {
          vehicleType: { $arrayElemAt: ['$vehicleType', 0] },
          assignedDriver: { $arrayElemAt: ['$assignedDriver', 0] }
        }
      },
      { $sort: { bookingDate: -1 } },
      {
        $project: {
          _id: 1,
          status: 1,
          'dates.startDate': 1,
          'dates.endDate': 1,
          pickupLocation: 1,
          dropoffLocation: 1,
          finalPrice: 1,
          rating: 1,
          tip: 1,
          'vehicleType.name': 1,
          'assignedDriver.name': 1
        }
      }
    ]);

    // --- STATS CALC ---
    let upcomingTrips = 0;
    let activeTrips = 0;
    const recentTrips = [];

    for (const booking of allBookingsAgg) {
      const startDate = new Date(booking.dates.startDate);
      const endDate = new Date(booking.dates.endDate);
      const status = (booking.status || '').toLowerCase();

      if (startDate > now && ['pending', 'confirmed'].includes(status)) {
        upcomingTrips++;
      }

      if (startDate <= now && endDate > now && status === 'confirmed') {
        activeTrips++;
      }

      // ✅ Always push Confirmed trips
      if (['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
        recentTrips.push({
          id: booking._id,
          status: booking.status,
          startDate: booking.dates.startDate,
          endDate: booking.dates.endDate,
          pickupLocation: booking.pickupLocation,
          dropoffLocation: booking.dropoffLocation,
          vehicleType: booking.vehicleType?.name || 'Unknown',
          driver: booking.assignedDriver?.name || null,
          finalPrice: booking.finalPrice,
          rating: booking.rating,
          tip: booking.tip
        });
      }
    }

    const limitedRecentTrips = recentTrips.slice(0, 5);

    const stats = {
      upcomingTrips,
      activeTrips,
      totalTrips: allBookingsAgg.length,
      recentTrips: limitedRecentTrips,
      subscriptionStatus: user.subscriptionStatus,
      monthlyUsage: {
        hoursUsed: 0,
        hoursRemaining: 0
      }
    };

    // --- MONTHLY USAGE ---
    if (user.subscriptionStatus === 'subscriber') {
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthlyUsageAgg = await MonthlyHours.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            yearMonth: currentMonth
          }
        },
        {
          $project: {
            totalHoursUsed: 1
          }
        }
      ]);

      const hoursUsed = monthlyUsageAgg[0]?.totalHoursUsed || 0;
      // Source of truth depends on flag rollout: the legacy reader pulls
      // `monthlyHoursIncluded` from the user's `subscriptionDetails` (written
      // by both subscriptionController and the Stripe webhook). The
      // Subscription ledger (T-2.3.4) becomes authoritative once
      // PRICING_OVERAGE flips on. No `|| 5` fallback — if a subscriber has no
      // plan record we surface 0, which is correct rather than fail-open.
      let hoursIncluded = Number(user.subscriptionDetails?.monthlyHoursIncluded || 0);
      let ledgerHoursUsed = hoursUsed;
      try {
        const subscriptionLedger = require('../services/subscriptionLedgerService');
        const activeSub = await subscriptionLedger.findActiveForUser(userId);
        if (activeSub) {
          hoursIncluded = Number(activeSub.hoursIncluded || hoursIncluded);
          ledgerHoursUsed = Number(activeSub.hoursUsed || hoursUsed);
        }
      } catch (_err) {
        // Fall through to legacy values; subscription ledger is best-effort.
      }
      stats.monthlyUsage = {
        hoursUsed: ledgerHoursUsed,
        hoursIncluded,
        hoursRemaining: Math.max(0, hoursIncluded - ledgerHoursUsed),
        month: currentMonth,
      };
    }

    return sendSuccess(res, 200, 'Dashboard statistics retrieved successfully', {
      stats,
      user: {
        name: user.name,
        email: user.email,
        phone: user.phone,
        subscriptionStatus: user.subscriptionStatus
      }
    });

  } catch (error) {
    (req.log || logger).error({ err: error }, 'Dashboard Stats Error');
    return sendError(res, 500, error.message || 'Failed to retrieve dashboard statistics');
  }
});



// Get Trip History
const getTripHistory = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    const filter = { user: userId };

    // Filter by status if provided
    if (status && ['Pending', 'Confirmed', 'Cancelled', 'Completed'].includes(status)) {
      filter.status = status;
    }

    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('vehicleType', 'name hourlyPrice')
        .populate('assignedDriver', 'name phone')
        .populate('addOns', 'name price type')
        .sort({ bookingDate: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Booking.countDocuments(filter)
    ]);

    const tripHistory = bookings.map(booking => ({
      id: booking._id,
      status: booking.status,
      startDate: booking.dates.startDate,
      endDate: booking.dates.endDate,
      pickupLocation: booking.pickupLocation,
      dropoffLocation: booking.dropoffLocation,
      vehicleType: {
        id: booking.vehicleType?._id,
        name: booking.vehicleType?.name,
        hourlyPrice: booking.vehicleType?.hourlyPrice
      },
      driver: booking.assignedDriver ? {
        id: booking.assignedDriver._id,
        name: booking.assignedDriver.name,
        phone: booking.assignedDriver.phone
      } : null,
      quantity: booking.quantity,
      addOns: booking.addOns,
      regularPrice: booking.regularPrice,
      subscriptionPrice: booking.subscriptionPrice,
      finalPrice: booking.finalPrice,
      savings: booking.savings,
      rating: booking.rating,
      tip: booking.tip,
      bookingDate: booking.bookingDate,
      completedAt: booking.completedAt,
      paymentStatus: booking.paymentStatus
    }));

    return sendSuccess(res, 200, 'Trip history retrieved successfully', {
      trips: tripHistory,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalTrips: total,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Trip History Error');
    return sendError(res, 500, error.message || 'Failed to retrieve trip history');
  }
});

// Get Upcoming Trips
const getUpcomingTrips = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    const upcomingBookings = await Booking.find({
      user: userId,
      'dates.startDate': { $gt: now },
      status: { $in: ['Pending', 'Confirmed'] }
    })
      .populate('vehicleType', 'name hourlyPrice')
      .populate('assignedDriver', 'name phone')
      .populate('addOns', 'name price type')
      .sort({ 'dates.startDate': 1 });

    const upcomingTrips = upcomingBookings.map(booking => ({
      id: booking._id,
      status: booking.status,
      startDate: booking.dates.startDate,
      endDate: booking.dates.endDate,
      pickupLocation: booking.pickupLocation,
      dropoffLocation: booking.dropoffLocation,
      vehicleType: {
        id: booking.vehicleType?._id,
        name: booking.vehicleType?.name,
        hourlyPrice: booking.vehicleType?.hourlyPrice
      },
      driver: booking.assignedDriver ? {
        id: booking.assignedDriver._id,
        name: booking.assignedDriver.name,
        phone: booking.assignedDriver.phone
      } : null,
      quantity: booking.quantity,
      addOns: booking.addOns,
      finalPrice: booking.finalPrice,
      savings: booking.savings,
      bookingDate: booking.bookingDate,
      canCancel: booking.status === 'Pending' || booking.status === 'Confirmed',
      canModify: booking.status === 'Pending' && new Date(booking.dates.startDate) > new Date(Date.now() + 2 * 60 * 60 * 1000) // Can modify if more than 2 hours away
    }));

    return sendSuccess(res, 200, 'Upcoming trips retrieved successfully', {
      trips: upcomingTrips,
      count: upcomingTrips.length
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Upcoming Trips Error');
    return sendError(res, 500, error.message || 'Failed to retrieve upcoming trips');
  }
});

// Get Active Trips
const getActiveTrips = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    const activeBookings = await Booking.find({
      user: userId,
      'dates.startDate': { $lte: now },
      'dates.endDate': { $gt: now },
      status: 'Confirmed'
    })
      .populate('vehicleType', 'name hourlyPrice')
      .populate('assignedDriver', 'name phone')
      .populate('addOns', 'name price type')
      .sort({ 'dates.startDate': 1 });

    const activeTrips = activeBookings.map(booking => {
      const startTime = new Date(booking.dates.startDate);
      const endTime = new Date(booking.dates.endDate);
      const timeElapsed = Math.max(0, (now - startTime) / (1000 * 60)); // minutes
      const timeRemaining = Math.max(0, (endTime - now) / (1000 * 60)); // minutes

      return {
        id: booking._id,
        status: booking.status,
        startDate: booking.dates.startDate,
        endDate: booking.dates.endDate,
        pickupLocation: booking.pickupLocation,
        dropoffLocation: booking.dropoffLocation,
        vehicleType: {
          id: booking.vehicleType?._id,
          name: booking.vehicleType?.name,
          hourlyPrice: booking.vehicleType?.hourlyPrice
        },
        driver: booking.assignedDriver ? {
          id: booking.assignedDriver._id,
          name: booking.assignedDriver.name,
          phone: booking.assignedDriver.phone
        } : null,
        quantity: booking.quantity,
        addOns: booking.addOns,
        finalPrice: booking.finalPrice,
        timeElapsed: Math.round(timeElapsed),
        timeRemaining: Math.round(timeRemaining),
        progress: Math.min(100, Math.max(0, (timeElapsed / ((endTime - startTime) / (1000 * 60))) * 100))
      };
    });

    return sendSuccess(res, 200, 'Active trips retrieved successfully', {
      trips: activeTrips,
      count: activeTrips.length
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Active Trips Error');
    return sendError(res, 500, error.message || 'Failed to retrieve active trips');
  }
});

// ===== DRIVER DASHBOARD ===== //

const getDriverDashboard = asyncHandler(async (req, res) => {
  try {
    const driverId = req.user.id;

    const driver = await User.findById(driverId).select('-password');
    if (!driver || driver.role !== 'driver') {
      return sendNotFound(res, 'Driver not found');
    }

    const settings = await TierSettings.findOne().lean();
    const now = new Date();

    // ── Time boundaries ──────────────────────────────────────────────────────
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayEnd);
    yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const driverObjectId = new mongoose.Types.ObjectId(driverId);

    // ── Queries (parallel) ───────────────────────────────────────────────────
    const [todayBookings, yesterdayBookings, weekBookings, monthlyBookings, totalCompleted] =
      await Promise.all([
        Booking.find({ assignedDriver: driverObjectId, status: 'Completed', completedAt: { $gte: todayStart, $lte: todayEnd } }).lean(),
        Booking.find({ assignedDriver: driverObjectId, status: 'Completed', completedAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }).lean(),
        Booking.find({ assignedDriver: driverObjectId, status: 'Completed', completedAt: { $gte: weekStart } }).lean(),
        Booking.find({ assignedDriver: driverObjectId, status: 'Completed', completedAt: { $gte: sixMonthsAgo } }).lean(),
        Booking.countDocuments({ assignedDriver: driverObjectId, status: 'Completed' }),
      ]);

    // ── Payout helper ────────────────────────────────────────────────────────
    const calcPayout = (bookings) =>
      bookings.reduce((sum, b) => sum + computePayoutCents(b, driver, settings), 0) / 100;

    const todayEarnings = calcPayout(todayBookings);
    const yesterdayEarnings = calcPayout(yesterdayBookings);
    const weekEarnings = calcPayout(weekBookings);

    let earningsChangePercent = 0;
    if (yesterdayEarnings > 0) {
      earningsChangePercent = Math.round(((todayEarnings - yesterdayEarnings) / yesterdayEarnings) * 100);
    } else if (todayEarnings > 0) {
      earningsChangePercent = 100;
    }

    // ── Earnings overview — last 6 months ────────────────────────────────────
    const monthlyMap = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('en-US', { month: 'short' });
      monthlyMap[key] = { month: label, earnings: 0 };
    }

    for (const booking of monthlyBookings) {
      const d = new Date(booking.completedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyMap[key]) {
        monthlyMap[key].earnings += computePayoutCents(booking, driver, settings) / 100;
      }
    }

    const earningsOverview = Object.values(monthlyMap).map((m) => ({
      month: m.month,
      earnings: Math.round(m.earnings * 100) / 100,
    }));

    // ── Weekly goal (default $1,200 — adjustable via TierSettings later) ────
    const weeklyGoalAmount = 1200;
    const weeklyGoalProgress = Math.min(100, Math.round((weekEarnings / weeklyGoalAmount) * 100));

    // ── Pending items ────────────────────────────────────────────────────────
    const pendingItems = [];
    const d = driver.driver || {};

    if (d.tier === 'S-Level' && d.sLevel?.rentalCost > 0) {
      pendingItems.push({
        type: 'license_fee',
        label: 'License Fee',
        amount: d.sLevel.rentalCost,
        urgency: 'due_soon',
      });
    }

    if (!d.hasForHireLicense && d.tier === 'S-Level') {
      pendingItems.push({
        type: 'for_hire_license',
        label: 'For-Hire License Pending',
        urgency: 'in_progress',
      });
    }

    if (d.status === 'background_pending') {
      pendingItems.push({
        type: 'background_check',
        label: 'Background Check In Progress',
        urgency: 'in_progress',
      });
    }

    if (d.status === 'needs_revision') {
      pendingItems.push({
        type: 'revision_required',
        label: 'Documents Need Revision',
        notes: d.revisionNotes || null,
        urgency: 'action_required',
      });
    }

    return sendSuccess(res, 200, 'Driver dashboard retrieved successfully', {
      driver: {
        name: driver.name,
        tier: d.tier,
        status: d.status,
      },
      overview: {
        todayEarnings: Math.round(todayEarnings * 100) / 100,
        earningsChangePercent,
        tripsCompletedToday: todayBookings.length,
        rating: d.driverRating || 0,
        totalTrips: totalCompleted,
      },
      weeklyGoal: {
        current: Math.round(weekEarnings * 100) / 100,
        goal: weeklyGoalAmount,
        progressPercent: weeklyGoalProgress,
        remaining: Math.max(0, Math.round((weeklyGoalAmount - weekEarnings) * 100) / 100),
      },
      earningsOverview,
      pendingItems,
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Driver Dashboard Error');
    return sendError(res, 500, error.message || 'Failed to retrieve driver dashboard');
  }
});

// ===== DRIVER TRIPS PAGE ===== //

const getDriverTrips = asyncHandler(async (req, res) => {
  try {
    const driverId = req.user.id;
    const { tab = 'available', search = '', page = 1, limit = 20 } = req.query;

    const driver = await User.findById(driverId).select('-password').lean();
    if (!driver || driver.role !== 'driver') return sendNotFound(res, 'Driver not found');

    const tier = driver.driver?.tier || 'S-Level';
    const settings = await TierSettings.findOne().lean();
    const driverObjectId = new mongoose.Types.ObjectId(driverId);
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // ── Search condition (applied to available + history tabs) ───────────────
    const searchFilter = search.trim()
      ? {
        $or: [
          { pickupLocation: { $regex: search, $options: 'i' } },
          { dropoffLocation: { $regex: search, $options: 'i' } },
        ],
      }
      : {};

    // ── Eligibility filters: stop showing trips that would 403 on accept ─────
    // Keep these in lockstep with the gates in confirmBooking / acceptBooking.

    // S-Level cannot fulfill membership trips (pay split makes them ineligible)
    const membershipFilter =
      tier === 'S-Level' ? { subscriptionPrice: { $exists: false } } : {};

    // Region binding: only show trips in regions the driver opts into.
    // Default-open: serveAllRegions !== false means "everywhere" (no constraint).
    const driverRegions = Array.isArray(driver.driver?.regions) ? driver.driver.regions : [];
    const regionFilter =
      driver.driver?.serveAllRegions !== false ? {} : { region: { $in: driverRegions } };

    // Vehicle-type binding: driver only sees trips for vehicles they're approved for.
    // An empty vehicleTypes list yields { $in: [] } which matches nothing — that's
    // intentional: a driver with no approved vehicles shouldn't see any trips.
    const driverVehicles = Array.isArray(driver.driver?.vehicleTypes)
      ? driver.driver.vehicleTypes
      : [];
    const vehicleFilter = { vehicleType: { $in: driverVehicles } };

    // ── Stats queries (parallel) ──────────────────────────────────────────────
    const availableFilter = {
      status: 'Pending',
      assignedDriver: null,
      ...membershipFilter,
      ...regionFilter,
      ...vehicleFilter,
    };

    const myTripsFilter = {
      assignedDriver: driverObjectId,
      status: { $in: ['Confirmed', 'In Progress'] },
    };

    const completedFilter = {
      assignedDriver: driverObjectId,
      status: 'Completed',
    };

    const [availableCount, myTripsCount, completedCount, totalEarningsRaw] = await Promise.all([
      Booking.countDocuments(availableFilter),
      Booking.countDocuments(myTripsFilter),
      Booking.countDocuments(completedFilter),
      Booking.find(completedFilter).select('finalPrice subscriptionPrice').lean(),
    ]);

    const totalEarnings =
      totalEarningsRaw.reduce((sum, b) => sum + computePayoutCents(b, driver, settings), 0) / 100;

    // ── Fetch trips for the selected tab ─────────────────────────────────────
    let tripFilter = {};
    let sortOrder = {};

    if (tab === 'available') {
      tripFilter = { ...availableFilter, ...searchFilter };
      sortOrder = { 'dates.startDate': 1 };
    } else if (tab === 'mine') {
      tripFilter = { ...myTripsFilter, ...searchFilter };
      sortOrder = { 'dates.startDate': 1 };
    } else if (tab === 'history') {
      tripFilter = { ...completedFilter, ...searchFilter };
      sortOrder = { completedAt: -1 };
    }

    const [bookings, total] = await Promise.all([
      Booking.find(tripFilter)
        .populate('vehicleType', 'name')
        .populate('region', 'name code')
        .sort(sortOrder)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Booking.countDocuments(tripFilter),
    ]);

    // ── Format trip cards ─────────────────────────────────────────────────────
    const trips = bookings.map((booking) => {
      const driverEarnings = computePayoutCents(booking, driver, settings) / 100;

      return {
        id: booking._id,
        status: booking.status,
        region: booking.region ? { name: booking.region.name, code: booking.region.code } : null,
        pickupLocation: booking.pickupLocation,
        dropoffLocation: booking.dropoffLocation,
        startDate: booking.dates.startDate,
        endDate: booking.dates.endDate,
        vehicleType: booking.vehicleType?.name || 'Unknown',
        quantity: booking.quantity,
        isMembershipTrip: !!booking.subscriptionPrice,
        driverEarnings: Math.round(driverEarnings * 100) / 100,
        completedAt: booking.completedAt ?? null,
      };
    });

    return sendSuccess(res, 200, 'Driver trips retrieved successfully', {
      stats: {
        availableTrips: availableCount,
        myTrips: myTripsCount,
        completed: completedCount,
        totalEarnings: Math.round(totalEarnings * 100) / 100,
      },
      trips,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Driver Trips Error');
    return sendError(res, 500, error.message || 'Failed to retrieve driver trips');
  }
});

// ===== DRIVER EARNINGS PAGE ===== //

const getDriverEarnings = asyncHandler(async (req, res) => {
  try {
    const driverId = req.user.id;
    const driver = await User.findById(driverId).select('-password').lean();
    if (!driver || driver.role !== 'driver') return sendNotFound(res, 'Driver not found');

    const settings = await TierSettings.findOne().lean();
    const now = new Date();

    // ── Boundaries ────────────────────────────────────────────────────────────
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Current week Mon–Sun
    const dayOfWeek = now.getDay(); // 0=Sun
    const diffToMon = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diffToMon);
    weekStart.setHours(0, 0, 0, 0);

    const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(weekStart); prevWeekEnd.setMilliseconds(-1);

    const driverObjectId = new mongoose.Types.ObjectId(driverId);

    // ── Parallel queries ──────────────────────────────────────────────────────
    const [monthBookings, todayBookings, weekBookings, prevWeekBookings, pendingBookings, payoutMethods] =
      await Promise.all([
        Booking.find({ assignedDriver: driverObjectId, status: 'Completed', completedAt: { $gte: monthStart } }).lean(),
        Booking.find({ assignedDriver: driverObjectId, status: 'Completed', completedAt: { $gte: todayStart, $lte: todayEnd } }).lean(),
        Booking.find({ assignedDriver: driverObjectId, status: 'Completed', completedAt: { $gte: weekStart } }).lean(),
        Booking.find({ assignedDriver: driverObjectId, status: 'Completed', completedAt: { $gte: prevWeekStart, $lte: prevWeekEnd } }).lean(),
        Booking.find({ assignedDriver: driverObjectId, status: 'Completed', paymentStatus: 'Paid', PaidToDriver: false }).lean(),
        require('../models/BankAccount').find({ driverId: driverObjectId }).sort({ createdAt: 1 }).lean(),
      ]);

    const calcPayout = (bookings) =>
      bookings.reduce((sum, b) => sum + computePayoutCents(b, driver, settings), 0) / 100;
    const calcTips = (bookings) =>
      bookings.reduce((sum, b) => sum + (Number(b.tip) || 0), 0);

    const totalEarnings = calcPayout(monthBookings);
    const todayEarnings = calcPayout(todayBookings);
    const weekEarnings = calcPayout(weekBookings);
    const prevWeekEarnings = calcPayout(prevWeekBookings);
    const pendingPayout = calcPayout(pendingBookings);

    let weeklyChangePercent = 0;
    if (prevWeekEarnings > 0) {
      weeklyChangePercent = Math.round(((weekEarnings - prevWeekEarnings) / prevWeekEarnings) * 100);
    } else if (weekEarnings > 0) {
      weeklyChangePercent = 100;
    }

    // ── Weekly chart — last 7 days ────────────────────────────────────────────
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      dailyMap[key] = { day: dayNames[d.getDay()], date: key, earnings: 0, tips: 0, trips: 0, payoutStatus: null };
    }

    // Populate from last 7 days completed bookings
    const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(now.getDate() - 6); sevenDaysAgo.setHours(0, 0, 0, 0);
    const last7Bookings = await Booking.find({
      assignedDriver: driverObjectId,
      status: 'Completed',
      completedAt: { $gte: sevenDaysAgo },
    }).lean();

    for (const b of last7Bookings) {
      const key = new Date(b.completedAt).toISOString().slice(0, 10);
      if (dailyMap[key]) {
        dailyMap[key].earnings += computePayoutCents(b, driver, settings) / 100;
        dailyMap[key].tips += Number(b.tip) || 0;
        dailyMap[key].trips += 1;
        // status: if any booking that day is not paid to driver → Processing, else Paid
        if (!b.PaidToDriver) dailyMap[key].payoutStatus = 'Processing';
        else if (dailyMap[key].payoutStatus !== 'Processing') dailyMap[key].payoutStatus = 'Paid';
      }
    }

    const weeklyChart = Object.values(dailyMap).map((d) => ({
      day: d.day,
      date: d.date,
      earnings: Math.round(d.earnings * 100) / 100,
    }));

    const dailyBreakdown = Object.values(dailyMap).map((d) => ({
      date: d.date,
      trips: d.trips,
      baseEarnings: Math.round((d.earnings - d.tips) * 100) / 100,
      tips: Math.round(d.tips * 100) / 100,
      total: Math.round(d.earnings * 100) / 100,
      status: d.trips === 0 ? null : (d.payoutStatus || 'Pending'),
    })).filter((d) => d.trips > 0);

    // ── This week breakdown ───────────────────────────────────────────────────
    const weekTips = calcTips(weekBookings);
    const weekBase = Math.max(0, weekEarnings - weekTips);

    // ── Fixed goals ───────────────────────────────────────────────────────────
    const WEEKLY_GOAL = 800;
    const MONTHLY_GOAL = 3200;

    // ── Payout methods ────────────────────────────────────────────────────────
    const methods = payoutMethods.map((m) => ({
      id: m._id,
      type: m.type,
      label: m.label,
      paypalEmail: m.paypalEmail,
      isPrimary: m.isPrimary,
    }));

    return sendSuccess(res, 200, 'Driver earnings retrieved successfully', {
      topStats: {
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        weeklyAvg: Math.round(weekEarnings * 100) / 100,
        weeklyChangePercent,
        todayEarnings: Math.round(todayEarnings * 100) / 100,
        tripsToday: todayBookings.length,
        pendingPayout: Math.round(pendingPayout * 100) / 100,
      },
      weeklyChart,
      dailyBreakdown,
      earningsGoals: {
        weekly: {
          current: Math.round(weekEarnings * 100) / 100,
          goal: WEEKLY_GOAL,
          progressPercent: Math.min(100, Math.round((weekEarnings / WEEKLY_GOAL) * 100)),
          remaining: Math.max(0, Math.round((WEEKLY_GOAL - weekEarnings) * 100) / 100),
        },
        monthly: {
          current: Math.round(totalEarnings * 100) / 100,
          goal: MONTHLY_GOAL,
          progressPercent: Math.min(100, Math.round((totalEarnings / MONTHLY_GOAL) * 100)),
          remaining: Math.max(0, Math.round((MONTHLY_GOAL - totalEarnings) * 100) / 100),
        },
        thisWeekBreakdown: {
          base: Math.round(weekBase * 100) / 100,
          tips: Math.round(weekTips * 100) / 100,
        },
      },
      payoutMethods: methods,
      payoutNote: 'Payouts are processed every Monday. Funds arrive within 1–3 business days depending on your bank.',
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Driver Earnings Error');
    return sendError(res, 500, error.message || 'Failed to retrieve driver earnings');
  }
});

// T-2.4.5 — driver availability surface. Reads the driver's current commitment
// state so the driver UI can render "Available / Committed / On a trip".
const getDriverAvailability = asyncHandler(async (req, res) => {
  try {
    const driverId = req.user.id;
    const driver = await User.findById(driverId).select('role driver.status driver.tier driver.regions driver.serveAllRegions').lean();
    if (!driver || driver.role !== 'driver') return sendError(res, 403, 'Driver only');

    const now = new Date();
    const activeBooking = await Booking.findOne({
      assignedDriver: driverId,
      status: { $in: ['Confirmed', 'In Progress'] },
      'dates.startDate': { $lte: now },
      'dates.endDate': { $gte: now },
    }).select('_id status dates region').lean();

    const isApproved = driver.driver?.status === 'approved';
    const tierEligible = ['Pro', 'Diamond'].includes(driver.driver?.tier);
    const counted = isApproved && tierEligible && !activeBooking;

    let presence = 'unavailable';
    if (activeBooking) presence = 'on-trip';
    else if (counted) presence = 'available';
    else if (isApproved) presence = 'committed'; // approved but not in same-day pool (S-Level)

    return sendSuccess(res, 200, 'Driver availability retrieved', {
      presence,
      countedInAQD: counted,
      tier: driver.driver?.tier || null,
      status: driver.driver?.status || null,
      activeBooking: activeBooking
        ? { _id: activeBooking._id, status: activeBooking.status, region: activeBooking.region }
        : null,
    });
  } catch (error) {
    (req.log || logger).error({ err: error }, 'Get Driver Availability Error');
    return sendError(res, 500, error.message || 'Failed to retrieve driver availability');
  }
});

module.exports = {
  getDashboardStats,
  getTripHistory,
  getUpcomingTrips,
  getActiveTrips,
  getDriverDashboard,
  getDriverTrips,
  getDriverEarnings,
  getDriverAvailability,
};

