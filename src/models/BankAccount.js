const mongoose = require("mongoose");

const bankAccountSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    stripeAccountId: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BankAccount", bankAccountSchema);