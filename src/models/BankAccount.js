const mongoose = require("mongoose");

const bankAccountSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Method type
    type: {
      type: String,
      enum: ["paypal", "stripe_connect"],
      required: true,
      default: "paypal",
    },

    // Display label set by driver (e.g. "My PayPal")
    label: { type: String, default: null },

    // PayPal fields
    paypalEmail: { type: String, default: null },

    // Stripe Connect (reserved for future use)
    stripeAccountId: { type: String, default: null },
    stripeOnboardingComplete: { type: Boolean, default: false },

    // Primary method flag — only one per driver
    isPrimary: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BankAccount", bankAccountSchema);