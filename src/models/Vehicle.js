const mongoose = require('mongoose');

// Vehicle Type schema (for admin to add vehicle types and their prices)
const vehicleTypeSchema = new mongoose.Schema({
  name: { type: String, required: true },  // Name of the vehicle (e.g., Sedan, SUV)
  description: { type: String, default: '' },  // Optional description of the vehicle type
  hourlyPrice: { type: Number, required: true },  // Hourly price set by admin
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },  // Admin who created it
}, { timestamps: true });

module.exports = mongoose.model('VehicleType', vehicleTypeSchema);
