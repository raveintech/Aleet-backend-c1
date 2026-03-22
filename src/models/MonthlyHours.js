const mongoose = require('mongoose');

// Monthly Hours schema
const monthlyHoursSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },  // Reference to User model
  yearMonth: { type: String, required: true },  // Format: 'YYYY-MM' (e.g., '2025-08')
  totalHoursUsed: { type: Number, default: 0 },  // Total hours used in this month
}, { timestamps: true });

// Ensure that there is only one entry per user per month
monthlyHoursSchema.index({ user: 1, yearMonth: 1 }, { unique: true });

module.exports = mongoose.model('MonthlyHours', monthlyHoursSchema);
