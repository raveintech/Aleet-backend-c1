const mongoose = require('mongoose');

// Region is the smallest addressable unit for same-day capacity blocks (P0 #6)
// and the timezone anchor for the late-night pricing override (P0 #5). Legacy
// rows default to sameDayBlock=false and timezone=null (treated as UTC at the
// callsite).
const regionSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, unique: true, trim: true },
        code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // e.g. "NY", "TX"
        isActive: { type: Boolean, default: true }, // admin can enable/disable regions
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        timezone: { type: String, default: null }, // IANA tz (e.g. "America/New_York"); used by late-night override
        sameDayBlock: { type: Boolean, default: false }, // admin can force same-day OFF for this region
    },
    { timestamps: true }
);

module.exports = mongoose.model('Region', regionSchema);
