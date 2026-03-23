const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Define the User schema
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: false }, // Made optional for phone-only registration
    email: { type: String, required: false, unique: true, sparse: true }, // Made optional with sparse index
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: false }, // Made optional for phone-only auth
    isPhoneVerified: { type: Boolean, default: false }, // Track phone verification status
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },

    // Role to differentiate between Admin, Driver, Customer
    role: {
      type: String,
      required: true,
      enum: ["admin", "driver", "customer"],
      default: "customer",
    },

    // Subscription status for Customers
    subscriptionStatus: {
      type: String,
      enum: ["non-subscriber", "subscriber", "cancelled", "expired"],
      default: "non-subscriber",
    },

    // Subscription details
    subscriptionDetails: {
      plan: { type: String, default: null },
      price: { type: Number, default: null },
      billingCycle: { type: String, default: null },
      startDate: { type: Date, default: null },
      nextBillingDate: { type: Date, default: null },
      paymentMethodId: { type: String, default: null },
      stripeCustomerId: { type: String, default: null },
      stripeSessionId: { type: String, default: null },
      stripePaymentIntentId: { type: String, default: null },
      isActive: { type: Boolean, default: false },
      monthlyHoursIncluded: { type: Number, default: 0 },
      discountRate: { type: Number, default: 1.0 },
      cancelledAt: { type: Date, default: null },
      cancellationReason: { type: String, default: null },
      updatedAt: { type: Date, default: null },
    },

    // Customer-specific fields
    preferences: { type: String, default: "standard" },

    // Driver-specific fields (only for users with driver role)
    driver: {
      tier: {
        type: String,
        enum: ["S-Level", "Pro", "Diamond"],
        default: "S-Level",
      },
      backgroundCheck: { type: Boolean, default: false },

      vehicleTypes: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "VehicleType",
          required: function () {
            return this.parent().role === "driver";
          },
        },
      ],

      ssn: { type: String },
      licenseImage: { type: String, default: null },
      vehicleImage: { type: String, default: null },
      driverRating: { type: Number, default: 0 },
      active: { type: Boolean, default: true },

      // 🟩 S-Level Fields
      sLevel: {
        rentalUsed: { type: Boolean, default: false },
        rentalCost: { type: Number, default: 0 },
        rentalSplit: {
          driver: { type: Number, default: 0 },
          ceo: { type: Number, default: 0 },
          coo: { type: Number, default: 0 },
        },
      },

      // 🟦 Pro Driver Fields
      pro: {
        chauffeurLicenseNumber: { type: String, default: null },
        etiquetteTrainingCompleted: { type: Boolean, default: false },
      },

      // 💎 Diamond Driver Fields
      diamond: {
        completedTrips: { type: Number, default: 0 },
        noComplaints: { type: Boolean, default: true },
        luxuryVehicleApproved: { type: Boolean, default: false },
        sameDayBookingAvailable: { type: Boolean, default: false },
        diamondTrainingCompleted: { type: Boolean, default: false },
        instantPayoutEligible: { type: Boolean, default: false },
      },

      // ✅ Background check (Checkr)
      checkr: {
        candidateId: { type: String },
        invitationId: { type: String },
        reportId: { type: String },
        status: { type: String },
        lastEvent: { type: String },
        lastEventAt: { type: Date },
        dashboardUrl: { type: String },
      },
    },
    active: { type: Boolean, default: true }, // active status

    // Admin-specific fields
    admin: {
      permissions: [
        {
          type: String,
          enum: ["manage-users", "view-reports", "manage-bookings"],
          required: true,
        },
      ],
    },
  },
  { timestamps: true }
);

// Hash password before saving (only if password exists)
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Custom validation for driver fields
userSchema.pre("save", function (next) {
  if (this.role === "driver") {
    if (!this.driver.ssn) {
      return next(new Error("SSN is required for drivers"));
    }
  }
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
