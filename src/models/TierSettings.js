// src/models/TierSettings.js
// Singleton document — always one record. Admin-adjustable tier policy.

const mongoose = require('mongoose');

const tierConfigSchema = new mongoose.Schema({
    payoutRate: { type: Number, required: true },       // e.g. 0.40
    keepsBookingFee: { type: Boolean, required: true }, // true = driver keeps it
    vehicleCostDeduction: { type: Number, default: 0 }, // per-trip deduction charged to driver ($)
    companyCostAbsorption: { type: Number, default: 0 } // additional internal company cost ($)
}, { _id: false });

const tierSettingsSchema = new mongoose.Schema({
    bookingFee: { type: Number, default: 34 }, // admin-adjustable, applied per trip
    membershipRate: { type: Number, default: 89 }, // locked $/hr for standard members (any vehicle type)
    founder30Rate: { type: Number, default: 69 },  // locked $/hr for invite-only Founder 30 members
    tiers: {
        'S-Level': {
            type: tierConfigSchema,
            default: () => ({ payoutRate: 0.30, keepsBookingFee: false, vehicleCostDeduction: 50, companyCostAbsorption: 100 })
        },
        'Pro': {
            type: tierConfigSchema,
            default: () => ({ payoutRate: 0.40, keepsBookingFee: true, vehicleCostDeduction: 0, companyCostAbsorption: 0 })
        },
        'Diamond': {
            type: tierConfigSchema,
            default: () => ({ payoutRate: 0.40, keepsBookingFee: true, vehicleCostDeduction: 0, companyCostAbsorption: 0 })
        }
    }
}, { timestamps: true });

module.exports = mongoose.model('TierSettings', tierSettingsSchema);
