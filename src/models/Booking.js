// src/models/Booking.js
// Booking schema with minimal additions for itinerary validation and dispatch review.

const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema({
  location: { type: String, required: true },

  // Client now sends a single "time" + "timeType". We persist normalized "arrivalTime"
  // and remember semantic (pickup/arrival) for analytics/ops.
  arrivalTime: { type: Date, required: true },             // normalized time
  timeType: { type: String, enum: ['arrival', 'pickup'], default: 'arrival' },

  dwellMinutes: { type: Number, default: 0 },

  // Optional: per-stop add-ons
  addOnIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AddOn' }]
}, { _id: false });


const routeLegSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  plannedDeparture: { type: Date, required: true },
  plannedArrival: { type: Date, required: true },
  api: {
    distanceMeters: Number,
    durationSec: Number,
    durationInTrafficSec: Number,
    provider: String
  },
  bufferMinutes: { type: Number, default: 15 },
  minRequiredGapSec: Number,
  actualGapSec: Number,
  ok: Boolean,
  recommendation: String
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  region: { type: String, required: true },

  dates: {
    startDate: { type: Date, required: true }, // pickup time
    endDate:   { type: Date, required: true }  // dropoff arrival time
  },

  vehicleType: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleType', required: true },
  quantity: { type: Number, min: 1, max: 5, default: 1 },

  pickupLocation: { type: String, required: true },
  dropoffLocation:{ type: String, required: true },

  // New stop structure (arrivalTime + dwellMinutes)
  stops: [stopSchema],

  assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Pricing
  regularPrice: { type: Number, required: true },
  subscriptionPrice: { type: Number },
  finalPrice: { type: Number, required: true },
  savings: { type: Number, default: 0 },

  addOns: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AddOn' }],

  status: { type: String, enum: ['Pending', 'Confirmed', 'Cancelled', 'Completed'], default: 'Pending' },
  bookingDate: { type: Date, default: Date.now },

  // Admin override if itinerary is unrealistic but staff chooses to proceed
  adminOverride: { type: Boolean, default: false },
  dispatchFlag: { type: Boolean, default: false }, // triggers internal dispatch review

  // Persisted validation report (for audit/ops)
  routeValidation: {
    legs: [routeLegSchema],
    allOk: { type: Boolean, default: true },
    validatedAt: { type: Date }
  },

  // Ratings / payment fields (as you had)
  rating: { type: Number, min: 0, max: 5, default: null },
  tip: { type: Number, default: 0 },
  completedAt: { type: Date },

  paymentStatus: { type: String, enum: ['Unpaid', 'Paid', 'Refunded', 'Failed'], default: 'Unpaid' },
  stripeSessionId: { type: String, default: null },
  stripePaymentIntentId: { type: String, default: null },
  paidAt: { type: Date, default: null },
  refundId: { type: String, default: null },
  PaidToDriver: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema);
