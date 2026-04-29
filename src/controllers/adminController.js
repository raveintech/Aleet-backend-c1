const Booking = require('../models/Booking');
const User = require('../models/User');
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

module.exports = { toggleDriverStatus, assignDriverToBooking, getAllDrivers, approveDriver, requestRevision, uploadAleetLicense };