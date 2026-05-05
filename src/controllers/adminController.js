const Booking = require('../models/Booking');
const User = require('../models/User');
const mongoose = require('mongoose');
const { sendSuccess, sendError, sendValidationError, sendNotFound } = require('../utils/responseHelper');
const { fileUrl } = require('../utils/multer');
const { resolveDriverTier } = require('../services/driverTierService');


const assignDriverToBooking = async (req, res) => {
  try {
    const { bookingId, driverId } = req.body;

    if (!bookingId || !driverId) {
      return sendValidationError(res, 'Booking ID and Driver ID are required');
    }

    // Find the booking by ID
    const booking = await Booking.findById(bookingId);
    if (!booking) return sendNotFound(res, 'Booking not found');

    // Find the driver by ID
    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') {
      return sendValidationError(res, 'Invalid driver');
    }

    // Assign driver to the booking
    booking.assignedDriver = driverId;
    booking.status = 'Confirmed';  // Confirm booking once assigned
    await booking.save();

    return sendSuccess(res, 200, 'Driver assigned successfully', booking);
  } catch (error) {
    console.error('Assign Driver Error:', error);
    return sendError(res, 500, error.message || 'Failed to assign driver');
  }
};
// Admin function to activate/deactivate a driver
const toggleDriverStatus = async (req, res) => {
  try {
    const { driverId, status, driverStatus, backgroundCheck } = req.body;
    // status        → boolean (true = active, false = deactivated) — legacy field
    // driverStatus  → 'pending_review' | 'active' | 'suspended'
    // backgroundCheck → boolean

    if (!driverId) {
      return sendValidationError(res, 'Driver ID is required');
    }

    let driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') {
      return sendNotFound(res, 'Driver not found');
    }

    // Update driver.status enum
    const allowedStatuses = ['draft', 'submitted', 'background_pending', 'background_completed', 'approved', 'rejected', 'needs_revision', 'revision_complete'];
    if (driverStatus && allowedStatuses.includes(driverStatus)) {
      driver.driver.status = driverStatus;
      // Clear revision notes when moving away from needs_revision
      if (driverStatus !== 'needs_revision') {
        driver.driver.revisionNotes = null;
      }
    } else if (typeof status === 'boolean') {
      // Legacy boolean support
      driver.driver.status = status ? 'approved' : 'rejected';
      driver.driver.revisionNotes = null;
    }

    // Update background check if provided
    if (typeof backgroundCheck === 'boolean') {
      driver.driver.backgroundCheck = backgroundCheck;
    }

    await driver.save();

    return sendSuccess(res, 200, 'Driver status updated successfully', {
      name: driver.name,
      email: driver.email,
      driverStatus: driver.driver.status,
      backgroundCheck: driver.driver.backgroundCheck,
    });
  } catch (error) {
    console.error('Toggle Driver Status Error:', error);
    return sendError(res, 500, error.message || 'Failed to update driver status');
  }
};





const maskSSN = (ssn) => {
  if (!ssn) return null;
  const digits = String(ssn).replace(/\D/g, '');
  return `***-**-${digits.slice(-4)}`;
};

const formatDriverForAdmin = (driver) => ({
  _id: driver._id,
  name: driver.name,
  email: driver.email,
  phone: driver.phone,
  createdAt: driver.createdAt,
  driver: {
    tier: driver.driver?.tier,
    status: driver.driver?.status,
    backgroundCheck: driver.driver?.backgroundCheck,
    hasForHireLicense: driver.driver?.hasForHireLicense,
    hasOwnVehicle: driver.driver?.hasOwnVehicle,
    vehicleTypes: driver.driver?.vehicleTypes,
    licenseImage: driver.driver?.licenseImage,
    vehicleImage: driver.driver?.vehicleImage,
    forHireLicenseImage: driver.driver?.forHireLicenseImage,
    driverRating: driver.driver?.driverRating,
    ssn: maskSSN(driver.driver?.ssn),
    revisionNotes: driver.driver?.revisionNotes || null,
    checkr: driver.driver?.checkr
      ? {
        status: driver.driver.checkr.status,
        result: driver.driver.checkr.result,
        assessment: driver.driver.checkr.assessment,
        lastEvent: driver.driver.checkr.lastEvent,
        lastEventAt: driver.driver.checkr.lastEventAt,
        dashboardUrl: driver.driver.checkr.dashboardUrl,
      }
      : null,
  },
});

const getAllDrivers = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const filter = { role: 'driver' };
    const allowedStatuses = ['draft', 'submitted', 'background_pending', 'background_completed', 'approved', 'rejected', 'needs_revision', 'revision_complete'];
    if (status && allowedStatuses.includes(status)) {
      filter['driver.status'] = status;
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [drivers, total, approvedCount, rejectedCount, pendingCount] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(filter),
      User.countDocuments({ role: 'driver', 'driver.status': 'approved' }),
      User.countDocuments({ role: 'driver', 'driver.status': 'rejected' }),
      User.countDocuments({ role: 'driver', 'driver.status': { $in: ['submitted', 'background_pending', 'background_completed', 'needs_revision', 'revision_complete'] } }),
    ]);

    return sendSuccess(res, 200, 'Drivers retrieved successfully', drivers.map(formatDriverForAdmin), {
      stats: {
        total: approvedCount + rejectedCount + pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        pending: pendingCount,
      },
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error('Get All Drivers Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve drivers');
  }
};


const approveDriver = async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) return sendValidationError(res, 'driverId is required');

    const driver = await User.findOne({ _id: driverId, role: 'driver' });
    if (!driver) return sendNotFound(res, 'Driver not found');

    if (driver.driver.status === 'approved') {
      return sendValidationError(res, 'Driver is already active');
    }

    driver.driver.status = 'approved';
    await driver.save();

    return sendSuccess(res, 200, 'Driver approved successfully', formatDriverForAdmin(driver));
  } catch (error) {
    console.error('Approve Driver Error:', error);
    return sendError(res, 500, error.message || 'Failed to approve driver');
  }
};

const requestRevision = async (req, res) => {
  try {
    const { driverId, notes } = req.body;
    if (!driverId) return sendValidationError(res, 'driverId is required');
    if (!notes || !String(notes).trim()) return sendValidationError(res, 'notes are required');

    const driver = await User.findOne({ _id: driverId, role: 'driver' });
    if (!driver) return sendNotFound(res, 'Driver not found');

    driver.driver.status = 'needs_revision';
    driver.driver.revisionNotes = String(notes).trim();
    await driver.save();

    return sendSuccess(res, 200, 'Driver sent for revision', formatDriverForAdmin(driver));
  } catch (error) {
    console.error('Request Revision Error:', error);
    return sendError(res, 500, error.message || 'Failed to request revision');
  }
};

const uploadAleetLicense = async (req, res) => {
  try {
    const { id } = req.params;

    const driver = await User.findOne({ _id: id, role: 'driver' });
    if (!driver) return sendNotFound(res, 'Driver not found');

    if (driver.driver.hasForHireLicense) {
      return sendValidationError(res, 'Driver already has a for-hire license');
    }

    if (!req.file) {
      return sendValidationError(res, 'forHireLicenseImage file is required');
    }

    driver.driver.forHireLicenseImage = fileUrl(req.file.filename);
    driver.driver.hasForHireLicense = true;
    driver.driver.tier = resolveDriverTier({
      hasOwnVehicle: driver.driver.hasOwnVehicle,
      hasForHireLicense: true,
    });

    await driver.save();

    return sendSuccess(res, 200, 'Aleet license uploaded and tier recalculated', formatDriverForAdmin(driver));
  } catch (error) {
    console.error('Upload Aleet License Error:', error);
    return sendError(res, 500, error.message || 'Failed to upload license');
  }
};

/**
 * GET /api/admin/drivers/licensing
 * Returns drivers list with licensing & background fields for the admin Licensing page.
 * Stats: verified (backgroundCheck=true), pending, total.
 */
const getDriverLicensing = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const filter = { role: 'driver' };
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [
        { name: re },
        { email: re },
        { phone: re },
        { 'driver.licenseNumber': re }
      ];
    }

    const [drivers, total, verifiedCount, pendingCount] = await Promise.all([
      User.find(filter)
        .select('name email phone createdAt driver.tier driver.status driver.backgroundCheck driver.licenseNumber driver.licenseExpiry driver.checkr driver.hasForHireLicense')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(filter),
      User.countDocuments({ role: 'driver', 'driver.backgroundCheck': true }),
      User.countDocuments({ role: 'driver', 'driver.backgroundCheck': false }),
    ]);

    const formatted = drivers.map(d => ({
      _id: d._id,
      name: d.name,
      email: d.email,
      phone: d.phone,
      registeredAt: d.createdAt,
      license: {
        number: d.driver?.licenseNumber || null,
        expiry: d.driver?.licenseExpiry || null,
        status: d.driver?.status === 'approved' ? 'Approved' : 'Pending',
        hasForHireLicense: d.driver?.hasForHireLicense || false
      },
      background: {
        verified: d.driver?.backgroundCheck || false,
        status: d.driver?.backgroundCheck ? 'Verified' : 'Pending',
        checkrStatus: d.driver?.checkr?.status || null
      },
      tier: d.driver?.tier || null
    }));

    return sendSuccess(res, 200, 'Driver licensing data retrieved', formatted, {
      stats: {
        verified: verifiedCount,
        pending: pendingCount,
        total
      },
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum)
    });
  } catch (error) {
    console.error('Get Driver Licensing Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve licensing data');
  }
};

const getSidebarStats = async (req, res) => {
  try {
    const [pendingBookings, pendingDriverApprovals] = await Promise.all([
      Booking.countDocuments({ status: 'Pending' }),
      User.countDocuments({ role: 'driver', 'driver.status': 'pending' }),
    ]);

    return sendSuccess(res, 200, 'Sidebar stats retrieved successfully', {
      pendingBookings,
      pendingDriverApprovals,
    });
  } catch (error) {
    console.error('Get Sidebar Stats Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve sidebar stats');
  }
};

const getAdminDashboard = async (req, res) => {
  try {
    const now = new Date();

    // ── Boundaries ────────────────────────────────────────────────────────────
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(todayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart); yesterdayEnd.setMilliseconds(-1);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(monthStart); lastMonthEnd.setMilliseconds(-1);

    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7); weekStart.setHours(0, 0, 0, 0);
    const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);

    // ── Parallel queries ──────────────────────────────────────────────────────
    const [activeDrivers, prevWeekDrivers, totalTripsToday, totalTripsYesterday,
      monthRevenue, lastMonthRevenue, recentBookings] = await Promise.all([
        User.countDocuments({ role: 'driver', 'driver.status': 'active', updatedAt: { $gte: weekStart } }),
        User.countDocuments({ role: 'driver', 'driver.status': 'active', updatedAt: { $gte: prevWeekStart, $lt: weekStart } }),
        Booking.countDocuments({ status: 'Completed', completedAt: { $gte: todayStart } }),
        Booking.countDocuments({ status: 'Completed', completedAt: { $gte: yesterdayStart, $lte: yesterdayEnd } }),
        Booking.aggregate([
          { $match: { status: 'Completed', paymentStatus: 'Paid', completedAt: { $gte: monthStart } } },
          { $group: { _id: null, total: { $sum: '$finalPrice' } } },
        ]),
        Booking.aggregate([
          { $match: { status: 'Completed', paymentStatus: 'Paid', completedAt: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
          { $group: { _id: null, total: { $sum: '$finalPrice' } } },
        ]),
        Booking.find({ status: { $in: ['Completed', 'Active', 'Pending', 'Cancelled'] } })
          .sort({ createdAt: -1 })
          .limit(5)
          .populate('assignedDriver', 'name')
          .lean(),
      ]);

    // ── Revenue chart — last 6 months ─────────────────────────────────────────
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const revenueChart = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      revenueChart.push({ month: monthNames[d.getMonth()], year: d.getFullYear(), start: d, end });
    }
    const revenueAgg = await Booking.aggregate([
      {
        $match: {
          status: 'Completed',
          paymentStatus: 'Paid',
          completedAt: { $gte: revenueChart[0].start, $lt: revenueChart[revenueChart.length - 1].end },
        },
      },
      {
        $group: {
          _id: { year: { $year: '$completedAt' }, month: { $month: '$completedAt' } },
          revenue: { $sum: '$finalPrice' },
        },
      },
    ]);
    const revenueMap = {};
    for (const r of revenueAgg) revenueMap[`${r._id.year}-${r._id.month}`] = r.revenue;
    const revenueOverview = revenueChart.map((m) => ({
      month: m.month,
      revenue: Math.round((revenueMap[`${m.year}-${m.start.getMonth() + 1}`] || 0) * 100) / 100,
    }));

    // ── Top performing drivers this month ─────────────────────────────────────
    const topDriversAgg = await Booking.aggregate([
      { $match: { status: 'Completed', completedAt: { $gte: monthStart }, assignedDriver: { $ne: null } } },
      {
        $group: {
          _id: '$assignedDriver',
          trips: { $sum: 1 },
          earnings: { $sum: '$finalPrice' },
          avgRating: { $avg: '$rating' },
        },
      },
      { $sort: { earnings: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'driver',
        },
      },
      { $addFields: { driver: { $arrayElemAt: ['$driver', 0] } } },
      {
        $project: {
          _id: 0,
          driverId: '$_id',
          name: '$driver.name',
          trips: 1,
          earnings: { $round: ['$earnings', 2] },
          rating: { $round: ['$avgRating', 1] },
        },
      },
    ]);

    // ── Percent change helpers ─────────────────────────────────────────────────
    const pctChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    const currentRevenue = monthRevenue[0]?.total || 0;
    const previousRevenue = lastMonthRevenue[0]?.total || 0;
    const revenueChange = pctChange(currentRevenue, previousRevenue);

    // Growth rate = revenue change (simplified)
    const growthRate = revenueChange;

    const tripsChange = pctChange(totalTripsToday, totalTripsYesterday);
    const driverChange = pctChange(activeDrivers, prevWeekDrivers);

    // ── Format recent trips ───────────────────────────────────────────────────
    const recentTrips = recentBookings.map((b, i) => ({
      tripId: `TR${String(i + 1).padStart(3, '0')}`,
      driver: b.assignedDriver?.name || 'Unassigned',
      route: `${b.pickupLocation || '—'} → ${b.dropoffLocation || '—'}`,
      fare: Math.round((b.finalPrice || 0) * 100) / 100,
      status: b.status,
    }));

    return sendSuccess(res, 200, 'Admin dashboard retrieved successfully', {
      stats: {
        activeDrivers: { value: activeDrivers, changePercent: driverChange, label: 'from last week' },
        totalTrips: { value: totalTripsToday, changePercent: tripsChange, label: 'from yesterday' },
        revenue: { value: Math.round(currentRevenue * 100) / 100, changePercent: revenueChange, label: 'from last month' },
        growthRate: { value: growthRate, label: 'Monthly growth' },
      },
      revenueOverview,
      recentTrips,
      topDrivers: topDriversAgg.map((d, i) => ({ rank: i + 1, ...d })),
    });
  } catch (error) {
    console.error('Admin Dashboard Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve admin dashboard');
  }
};

module.exports = { toggleDriverStatus, assignDriverToBooking, getAllDrivers, approveDriver, requestRevision, uploadAleetLicense, getDriverLicensing, getSidebarStats, getAdminDashboard };
