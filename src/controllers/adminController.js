const Booking = require('../models/Booking');
const User = require('../models/User');
const { sendSuccess, sendError, sendValidationError, sendNotFound } = require('../utils/responseHelper');


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
    const { driverId, status, backgroundCheck } = req.body;  
    // status → boolean (true for activate, false for deactivate)
    // backgroundCheck → boolean (true for approved, false for not approved)

    if (!driverId) {
      return sendValidationError(res, 'Driver ID is required');
    }

    // Find the driver by ID
    let driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver') {
      return sendNotFound(res, 'Driver not found');
    }

    // Update driver's active status if provided
    if (typeof status === 'boolean') {
      driver.driver.active = status;
      driver.active = status; // top-level field sync
    }

    // Update driver's background check if provided
    if (typeof backgroundCheck === 'boolean') {
      driver.driver.backgroundCheck = backgroundCheck;
    }

    await driver.save();

    const driverData = {
      name: driver.name,
      email: driver.email,
      active: driver.driver.active,
      backgroundCheck: driver.driver.backgroundCheck
    };

    return sendSuccess(res, 200, 'Driver status updated successfully', driverData);
  } catch (error) {
    console.error('Toggle Driver Status Error:', error);
    return sendError(res, 500, error.message || 'Failed to update driver status');
  }
};





const getAllDrivers = async (req, res) => {
  try {
    // Fetch all users with role = 'driver', populate vehicleTypes to get the full vehicle object
    const drivers = await User.find({ role: 'driver' })
      .populate('driver.vehicleTypes') // Populate the vehicleTypes field to get full vehicle objects
      .select('-password'); // Select only useful fields, excluding password

    if (!drivers || drivers.length === 0) {
      return sendNotFound(res, 'No drivers found');
    }

    return sendSuccess(res, 200, 'Drivers retrieved successfully', drivers, {
      count: drivers.length
    });
  } catch (error) {
    console.error('Get All Drivers Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve drivers');
  }
};


module.exports = { toggleDriverStatus, assignDriverToBooking, getAllDrivers };