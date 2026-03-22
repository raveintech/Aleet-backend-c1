const mongoose = require('mongoose');

// Define the OTP Verification schema
const otpVerificationSchema = new mongoose.Schema({
  phone: { 
    type: String, 
    required: true, 
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
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Index for efficient queries
otpVerificationSchema.index({ phone: 1, createdAt: -1 });

module.exports = mongoose.model('OTPVerification', otpVerificationSchema);
