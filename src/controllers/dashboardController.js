const asyncHandler = require('express-async-handler');
const Booking = require('../models/Booking');
const User = require('../models/User');
const MonthlyHours = require('../models/MonthlyHours');
const mongoose = require('mongoose');

const {
  sendSuccess,
  sendError,
  sendNotFound,
} = require('../utils/responseHelper');

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
      stats.monthlyUsage = {
        hoursUsed,
        hoursRemaining: Math.max(0, 5 - hoursUsed),
        month: currentMonth
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
    console.error('Dashboard Stats Error:', error);
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
    console.error('Trip History Error:', error);
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
    console.error('Upcoming Trips Error:', error);
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
    console.error('Active Trips Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve active trips');
  }
});

module.exports = {
  getDashboardStats,
  getTripHistory,
  getUpcomingTrips,
  getActiveTrips,
};
