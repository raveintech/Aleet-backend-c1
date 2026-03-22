const VehicleType = require('../models/Vehicle');
const { sendSuccess, sendError, sendValidationError, sendNotFound, sendConflict } = require('../utils/responseHelper');

// Add a new vehicle type (for admin to add vehicle types)
const addVehicleType = async (req, res) => {
  try {
    const { name, description, hourlyPrice } = req.body;

    if (!name || !description || !hourlyPrice) {
      return sendValidationError(res, 'Name, description, and hourly price are required');
    }

    // Check if vehicle type already exists
    const existingVehicleType = await VehicleType.findOne({ name });
    if (existingVehicleType) {
      return sendConflict(res, 'Vehicle type already exists');
    }

    // Create new vehicle type with createdBy from JWT token
    const newVehicleType = new VehicleType({
      name,
      description,
      hourlyPrice,
      createdBy: req.user.id
    });

    await newVehicleType.save();
    return sendSuccess(res, 201, 'Vehicle type added successfully', newVehicleType);
  } catch (error) {
    console.error('Add Vehicle Type Error:', error);
    return sendError(res, 500, error.message || 'Failed to add vehicle type');
  }
};


// Get all vehicle types (for driver to choose during signup)
const getAllVehicleTypes = async (req, res) => {
  try {
    const vehicleTypes = await VehicleType.find();
    return sendSuccess(res, 200, 'Vehicle types retrieved successfully', vehicleTypes);
  } catch (error) {
    console.error('Get Vehicle Types Error:', error);
    return sendError(res, 500, error.message || 'Failed to retrieve vehicle types');
  }
};


// Update vehicle type (admin only)
const updateVehicleType = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, hourlyPrice } = req.body;

    if (!id) {
      return sendValidationError(res, 'Vehicle type ID is required');
    }

    const vehicleType = await VehicleType.findById(id);
    if (!vehicleType) {
      return sendNotFound(res, 'Vehicle type not found');
    }

    if (name) vehicleType.name = name;
    if (description) vehicleType.description = description;
    if (hourlyPrice) vehicleType.hourlyPrice = hourlyPrice;

    await vehicleType.save();

    return sendSuccess(res, 200, 'Vehicle type updated successfully', vehicleType);
  } catch (error) {
    console.error('Update Vehicle Type Error:', error);
    return sendError(res, 500, error.message || 'Failed to update vehicle type');
  }
};


// Delete vehicle type (admin only)
const deleteVehicleType = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return sendValidationError(res, 'Vehicle type ID is required');
    }

    const vehicleType = await VehicleType.findById(id);
    if (!vehicleType) {
      return sendNotFound(res, 'Vehicle type not found');
    }

    await vehicleType.deleteOne();

    return sendSuccess(res, 200, 'Vehicle type deleted successfully');
  } catch (error) {
    console.error('Delete Vehicle Type Error:', error);
    return sendError(res, 500, error.message || 'Failed to delete vehicle type');
  }
};


module.exports = { 
  addVehicleType, 
  getAllVehicleTypes, 
  updateVehicleType, 
  deleteVehicleType 
};
