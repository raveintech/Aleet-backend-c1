const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Define the User schema
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: false }, // Made optional for phone-only registration
    email: { type: String, required: false, sparse: true },
    phone: { type: String, required: true },
    password: { type: String, required: false }, // Made optional for phone-only auth
    isPhoneVerified: { type: Boolean, default: false }, // Track phone verification status
    resetPasswordToken: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    avatar: { type: String, default: null },

    // SMS preferences.
    // smsOptIn: transactional SMS (booking lifecycle alerts). Default true — required for service.
    // smsPromoOptIn: marketing SMS (promos, re-engagement). Default false — requires explicit opt-in.
    smsOptIn: { type: Boolean, default: true },
    smsPromoOptIn: { type: Boolean, default: false },

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

    // Membership invite gate — only an admin-invited user may hold the
    // private Founder 30 plan ($69/hr). Non-invited users cannot self-select it.
    founder30Invited: { type: Boolean, default: false },

    // Subscription details
    subscriptionDetails: {
      plan: { type: String, default: null }, // e.g. 'membership' | 'founder30'
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

      /**
       * Regions this driver serves. Empty array + serveAllRegions=true means
       * the driver is available in every currently-active region (default-open).
       * Setting serveAllRegions=false and providing a non-empty list restricts
       * the driver to only those regions.
       */
      regions: [
        { type: mongoose.Schema.Types.ObjectId, ref: "Region" },
      ],
      serveAllRegions: { type: Boolean, default: true },

      licenseNumber: { type: String, default: null },   // e.g. DL-2024-001
      licenseExpiry: { type: Date, default: null },      // expiry date of driver's license
      ssn: { type: String, select: false },
      licenseImage: { type: String, default: null },
      vehicleImage: { type: String, default: null },
      forHireLicenseImage: { type: String, default: null },
      driverRating: { type: Number, default: 0 },
      // Post-acceptance cancellation tracking. Per spec, ratings/visibility/
      // penalties are derived from these counters via admin settings.
      cancellationCount: { type: Number, default: 0 },
      lastCancellationAt: { type: Date, default: null },

      // Socket-driven presence — populated by sockets/driverPresence.js
      // when the driver app opens a Socket.IO connection. AQD reads
      // isOnline === true AND lastSeenAt within freshness window
      // (gated by process.env.AQD_PRESENCE_ENABLED).
      isOnline: { type: Boolean, default: false },
      lastSeenAt: { type: Date, default: null },
      hasForHireLicense: { type: Boolean, default: false },
      hasOwnVehicle: { type: Boolean, default: false },
      authorizeBackgroundCheck: { type: Boolean, default: false },
      status: {
        type: String,
        enum: [
          'draft',               // default — signup not yet completed
          'submitted',           // signup complete, awaiting admin action
          'background_pending',  // Checkr invitation sent, check in progress
          'background_completed',// Checkr report done, awaiting admin review
          'approved',            // admin approved, can accept bookings
          'rejected',            // admin rejected
          'needs_revision',      // admin requested document corrections
          'revision_complete',   // driver submitted corrections, awaiting re-review
        ],
        default: 'draft',
      },
      revisionNotes: { type: String, default: null }, // Admin notes sent with needs_revision status

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
          enum: ["super-admin", "manage-users", "view-reports", "manage-bookings"],
          required: true,
        },
      ],
    },
  },
  { timestamps: true }
);

// Compound unique indexes: same email/phone allowed for different roles
userSchema.index({ email: 1, role: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1, role: 1 }, { unique: true });

// Hash password before saving (only if password exists)
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Custom validation for driver fields
userSchema.pre("save", function (next) {
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
