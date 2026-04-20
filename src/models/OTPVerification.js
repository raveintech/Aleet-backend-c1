const mongoose = require('mongoose');

// Define the OTP Verification schema
const otpVerificationSchema = new mongoose.Schema({
  purpose: {
    type: String,
    enum: ['signup', 'login', 'driver_signup'],
    default: 'signup',
    index: true
  },
  phone: {
    type: String,
    default: null,
    index: true
  },
  email: {
    type: String,
    default: null,
    index: true
  },
  code: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 } // Auto-delete expired documents
  },
  attempts: {
    type: Number,
    default: 0
  },
  verified: {
    type: Boolean,
    default: false
  },
  payload: {
    email: { type: String, default: null },
    name: { type: String, default: null },
    role: { type: String, default: 'customer' },
    hashedPassword: { type: String, default: null }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
otpVerificationSchema.index({ phone: 1, purpose: 1, createdAt: -1 });
otpVerificationSchema.index({ email: 1, purpose: 1, createdAt: -1 });

module.exports = mongoose.model('OTPVerification', otpVerificationSchema);
