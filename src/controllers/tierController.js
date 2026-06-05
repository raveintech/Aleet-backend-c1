// src/controllers/tierController.js

const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const User = require('../models/User');
const Booking = require('../models/Booking');
const TierSettings = require('../models/TierSettings');
const { sendSuccess, sendError, sendValidationError } = require('../utils/responseHelper');

const VALID_TIERS = ['S-Level', 'Pro', 'Diamond'];

// ---------------------------------------------------------------------------
// Shared: get or create singleton settings doc
// ---------------------------------------------------------------------------
async function getOrCreateSettings() {
    let settings = await TierSettings.findOne();
    if (!settings) settings = await TierSettings.create({});
    return settings;
}

// ---------------------------------------------------------------------------
// GET /api/admin/tiers/performance
// Driver Tier Performance table + tier count cards
// ---------------------------------------------------------------------------
const getDriverTierPerformance = asyncHandler(async (req, res) => {
    try {
        const { tier, page = 1, limit = 20, sortBy = 'totalEarnings', order = 'desc' } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * limitNum;

        const driverFilter = { role: 'driver' };
        if (tier && VALID_TIERS.includes(tier)) {
            driverFilter['driver.tier'] = tier;
        }

        // Aggregate completed bookings per driver
        const earningsAgg = await Booking.aggregate([
            { $match: { status: 'Completed', assignedDriver: { $ne: null } } },
            {
                $group: {
                    _id: '$assignedDriver',
                    totalTrips: { $sum: 1 },
                    totalRevenue: { $sum: '$finalPrice' }
                }
            }
        ]);

        const earningsMap = new Map();
        for (const e of earningsAgg) {
            earningsMap.set(e._id.toString(), { totalTrips: e.totalTrips, totalRevenue: e.totalRevenue });
        }

        // Fetch tier settings for payout rate calculation
        const settings = await getOrCreateSettings();

        // Get all matching drivers
        const [drivers, total, tierCounts] = await Promise.all([
            User.find(driverFilter)
                .select('name email driver.tier driver.driverRating')
                .lean(),
            User.countDocuments(driverFilter),
            User.aggregate([
                { $match: { role: 'driver' } },
                { $group: { _id: '$driver.tier', count: { $sum: 1 } } }
            ])
        ]);

        // Enrich with earnings
        const enriched = drivers.map(d => {
            const stats = earningsMap.get(d._id.toString()) || { totalTrips: 0, totalRevenue: 0 };
            const tierCfg = settings.tiers?.[d.driver?.tier];
            const payoutRate = tierCfg?.payoutRate ?? 0.30;
            const bookingFeeEarned = tierCfg?.keepsBookingFee
                ? stats.totalTrips * (settings.bookingFee ?? 34)
                : 0;
            const totalEarnings = Number(((stats.totalRevenue * payoutRate) + bookingFeeEarned).toFixed(2));

            return {
                _id: d._id,
                name: d.name,
                tier: d.driver?.tier || null,
                rating: d.driver?.driverRating ?? 0,
                totalTrips: stats.totalTrips,
                totalEarnings
            };
        });

        // Sort in memory
        const sortDir = order === 'asc' ? 1 : -1;
        const sortField = ['totalTrips', 'totalEarnings', 'rating'].includes(sortBy) ? sortBy : 'totalEarnings';
        enriched.sort((a, b) => sortDir * (a[sortField] - b[sortField]));

        const paginated = enriched.slice(skip, skip + limitNum);

        // Build tier count map
        const counts = { 'S-Level': 0, Pro: 0, Diamond: 0 };
        for (const { _id, count } of tierCounts) {
            if (_id in counts) counts[_id] = count;
        }

        return sendSuccess(res, 200, 'Driver tier performance retrieved', paginated, {
            tierCounts: counts,
            total,
            page: pageNum,
            limit: limitNum,
            pages: Math.ceil(total / limitNum)
        });
    } catch (error) {
        console.error('Get Driver Tier Performance Error:', error);
        return sendError(res, 500, error.message || 'Failed to retrieve tier performance');
    }
});

// ---------------------------------------------------------------------------
// GET /api/admin/tiers/settings
// Returns current tier policy (payout rates, booking fee, deductions)
// ---------------------------------------------------------------------------
const getTierSettings = asyncHandler(async (req, res) => {
    try {
        const settings = await getOrCreateSettings();
        return sendSuccess(res, 200, 'Tier settings retrieved', settings);
    } catch (error) {
        console.error('Get Tier Settings Error:', error);
        return sendError(res, 500, error.message || 'Failed to retrieve tier settings');
    }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/tiers/settings
// Update tier policy fields
// Body: { bookingFee, tiers: { 'S-Level': { payoutRate, keepsBookingFee, vehicleCostDeduction, companyCostAbsorption }, ... } }
// ---------------------------------------------------------------------------
const updateTierSettings = asyncHandler(async (req, res) => {
    try {
        const { bookingFee, membershipRate, founder30Rate, sameDayMCT, sameDayMinRB, sameDayRBRatio, tiers } = req.body;
        const settings = await getOrCreateSettings();

        if (bookingFee !== undefined) {
            if (typeof bookingFee !== 'number' || bookingFee < 0) {
                return sendValidationError(res, 'bookingFee must be a non-negative number');
            }
            settings.bookingFee = bookingFee;
        }

        if (membershipRate !== undefined) {
            if (typeof membershipRate !== 'number' || membershipRate < 0) {
                return sendValidationError(res, 'membershipRate must be a non-negative number');
            }
            settings.membershipRate = membershipRate;
        }

        if (founder30Rate !== undefined) {
            if (typeof founder30Rate !== 'number' || founder30Rate < 0) {
                return sendValidationError(res, 'founder30Rate must be a non-negative number');
            }
            settings.founder30Rate = founder30Rate;
        }

        if (sameDayMCT !== undefined) {
            if (typeof sameDayMCT !== 'number' || sameDayMCT < 1) {
                return sendValidationError(res, 'sameDayMCT must be a number >= 1');
            }
            settings.sameDayMCT = sameDayMCT;
        }

        if (sameDayMinRB !== undefined) {
            if (typeof sameDayMinRB !== 'number' || sameDayMinRB < 0) {
                return sendValidationError(res, 'sameDayMinRB must be a non-negative number');
            }
            settings.sameDayMinRB = sameDayMinRB;
        }

        if (sameDayRBRatio !== undefined) {
            if (typeof sameDayRBRatio !== 'number' || sameDayRBRatio < 0 || sameDayRBRatio > 1) {
                return sendValidationError(res, 'sameDayRBRatio must be a number between 0 and 1');
            }
            settings.sameDayRBRatio = sameDayRBRatio;
        }

        if (tiers && typeof tiers === 'object') {
            for (const tierName of Object.keys(tiers)) {
                if (!VALID_TIERS.includes(tierName)) {
                    return sendValidationError(res, `Invalid tier name: ${tierName}. Must be one of: ${VALID_TIERS.join(', ')}`);
                }
                const cfg = tiers[tierName];
                if (cfg.payoutRate !== undefined) {
                    if (typeof cfg.payoutRate !== 'number' || cfg.payoutRate < 0 || cfg.payoutRate > 1) {
                        return sendValidationError(res, `${tierName}.payoutRate must be a number between 0 and 1`);
                    }
                    settings.tiers[tierName].payoutRate = cfg.payoutRate;
                }
                if (cfg.keepsBookingFee !== undefined) {
                    settings.tiers[tierName].keepsBookingFee = !!cfg.keepsBookingFee;
                }
                if (cfg.vehicleCostDeduction !== undefined) {
                    settings.tiers[tierName].vehicleCostDeduction = Number(cfg.vehicleCostDeduction);
                }
                if (cfg.companyCostAbsorption !== undefined) {
                    settings.tiers[tierName].companyCostAbsorption = Number(cfg.companyCostAbsorption);
                }
            }
        }

        settings.markModified('tiers');
        await settings.save();

        return sendSuccess(res, 200, 'Tier settings updated', settings);
    } catch (error) {
        console.error('Update Tier Settings Error:', error);
        return sendError(res, 500, error.message || 'Failed to update tier settings');
    }
});

module.exports = { getDriverTierPerformance, getTierSettings, updateTierSettings };
