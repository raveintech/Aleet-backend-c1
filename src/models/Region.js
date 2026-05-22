const mongoose = require('mongoose');

const regionSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, unique: true, trim: true },
        code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // e.g. "NY", "TX"
        isActive: { type: Boolean, default: true }, // admin can enable/disable regions
        // Admin force-OFF for same-day availability — overrides the
        // AQD - RB - CL >= MCT formula and forces same-day OFF for this region.
        sameDayManualBlock: { type: Boolean, default: false },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Region', regionSchema);
