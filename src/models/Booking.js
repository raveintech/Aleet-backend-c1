// src/models/Booking.js
// Booking schema with minimal additions for itinerary validation and dispatch review.

const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema({
  location: { type: String, required: true },

  // Client may send stop time; when present we persist normalized "arrivalTime"
  // and remember semantic (pickup/arrival) for analytics/ops.
  arrivalTime: { type: Date, required: false },            // normalized time (optional)
  timeType: { type: String, enum: ['arrival', 'pickup'], default: 'arrival' },

  dwellMinutes: { type: Number, default: 0 },

  // Optional: free-text note for this specific stop (gate codes, contact, etc.)
  notes: { type: String, default: null },

  // Optional: per-stop add-ons
  addOnIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AddOn' }]
}, { _id: false });


// Persisted output of validateItinerary. plannedDeparture / plannedArrival
// are populated only by the legacy routingValidator path; the active
// validateItinerary in bookingHelpers.js doesn't compute them, so they're
// optional here. plannedGapSec / neededGapSec / reason are the fields the
// active validator emits.
const routeLegSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  plannedDeparture: { type: Date },
  plannedArrival: { type: Date },
  api: {
    distanceMeters: Number,
    durationSec: Number,
    durationInTrafficSec: Number,
    provider: String
  },
  bufferMinutes: { type: Number, default: 15 },
  minRequiredGapSec: Number,
  neededGapSec: Number,
  plannedGapSec: Number,
  actualGapSec: Number,
  ok: Boolean,
  reason: String,
  recommendation: String
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  region: { type: mongoose.Schema.Types.ObjectId, ref: 'Region', required: true },
  bookingMode: { type: String, enum: ['multi_day', 'buy_hours'], default: 'multi_day' },

  dates: {
    startDate: { type: Date, required: true }, // pickup time
    endDate: { type: Date, required: true }  // dropoff arrival time
  },
  durationHours: { type: Number, min: 0, default: null },

  vehicleType: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleType', required: true },
  quantity: { type: Number, min: 1, max: 5, default: 1 },

  pickupLocation: { type: String, required: true },
  dropoffLocation: { type: String, default: null }, // optional when freeRouting is true

  // New stop structure (arrivalTime + dwellMinutes)
  stops: [stopSchema],

  // Trip-level special notes / instructions (visible to the assigned & offered driver)
  specialNotes: { type: String, default: null },

  assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Pricing
  regularPrice: { type: Number, required: true },
  subscriptionPrice: { type: Number },
  finalPrice: { type: Number, required: true },
  savings: { type: Number, default: 0 },

  addOns: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AddOn' }],
  freeRouting: { type: Boolean, default: false },

  status: { type: String, enum: ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'In Progress', 'Expired'], default: 'Pending' },
  bookingDate: { type: Date, default: Date.now },

  // Admin override if itinerary is unrealistic but staff chooses to proceed
  adminOverride: { type: Boolean, default: false },
  dispatchFlag: { type: Boolean, default: false }, // triggers internal dispatch review

  // Trip-offer state — tracks staged auto-dispatch.
  // Same-day: stage 1 = Diamond + Pro (single stage).
  // Advance:  stage 1 = S-Level, stage 2 = Pro + Diamond (escalates after window).
  // stage 0 means "no active offer" (booking is fresh, taken, or done).
  offer: {
    stage: { type: Number, default: 0 },
    offeredAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    tiers: [{ type: String }],
    offeredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },

  // Driver cancellation — populated when an assigned driver cancels post-accept.
  // Per-driver cancellation counters live on User.driver.cancellationCount.
  cancellation: {
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    reason: { type: String, default: null },
  },

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
