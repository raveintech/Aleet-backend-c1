const Region = require('../models/Region');
const {
    sendSuccess,
    sendError,
    sendValidationError,
    sendNotFound,
    sendConflict,
} = require('../utils/responseHelper');
const { computeSameDayStatus } = require('../services/availabilityService');

// ─── Public ──────────────────────────────────────────────────────────────────

// GET /api/regions — all active regions (used by booking wizard)
const getRegions = async (req, res) => {
    try {
        const regions = await Region.find({ isActive: true }).select('name code').sort('name');
        return sendSuccess(res, 200, 'Regions retrieved successfully', regions);
    } catch (error) {
        console.error('Get Regions Error:', error);
        return sendError(res, 500, error.message || 'Failed to retrieve regions');
    }
};

// ─── Admin ────────────────────────────────────────────────────────────────────

// GET /api/regions/all — all regions including inactive (admin)
// Each region is enriched with its live same-day availability breakdown.
const getAllRegions = async (req, res) => {
    try {
        const regions = await Region.find().sort('name');
        const enriched = await Promise.all(
            regions.map(async (region) => ({
                ...region.toObject(),
                sameDay: await computeSameDayStatus(region),
            })),
        );
        return sendSuccess(res, 200, 'All regions retrieved successfully', enriched);
    } catch (error) {
        console.error('Get All Regions Error:', error);
        return sendError(res, 500, error.message || 'Failed to retrieve regions');
    }
};

// GET /api/regions/:id/same-day-status — public; live same-day availability.
const getSameDayStatus = async (req, res) => {
    try {
        const region = await Region.findById(req.params.id);
        if (!region) return sendNotFound(res, 'Region not found');

        // Optional trip window — when the booking flow passes the intended
        // pickup/dropoff, Committed Load is measured against THAT window, so a
        // driver whose existing trips don't overlap the requested slot still
        // counts as available. Without it, computeSameDayStatus falls back to
        // the rolling next-24h window. Invalid/absent dates are ignored.
        const opts = {};
        const start = req.query.startDate ? new Date(req.query.startDate) : null;
        const end = req.query.endDate ? new Date(req.query.endDate) : null;
        if (start && !Number.isNaN(start.getTime())) opts.windowStart = start;
        if (end && !Number.isNaN(end.getTime())) opts.windowEnd = end;

        const status = await computeSameDayStatus(region, opts);
        return sendSuccess(res, 200, 'Same-day status retrieved', {
            regionId: region._id,
            ...status,
        });
    } catch (error) {
        console.error('Get Same-Day Status Error:', error);
        return sendError(res, 500, error.message || 'Failed to retrieve same-day status');
    }
};

// POST /api/regions — add a new region (admin)
const addRegion = async (req, res) => {
    try {
        const { name, code } = req.body;

        if (!name || !code) {
            return sendValidationError(res, 'Name and code are required');
        }

        const existing = await Region.findOne({
            $or: [{ name: name.trim() }, { code: code.trim().toUpperCase() }],
        });
        if (existing) {
            return sendConflict(res, 'Region with this name or code already exists');
        }

        const region = await Region.create({
            name: name.trim(),
            code: code.trim().toUpperCase(),
            createdBy: req.user.id,
        });

        return sendSuccess(res, 201, 'Region added successfully', region);
    } catch (error) {
        console.error('Add Region Error:', error);
        return sendError(res, 500, error.message || 'Failed to add region');
    }
};

// PUT /api/regions/:id — update name/code/isActive/sameDayManualBlock (admin)
const updateRegion = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, code, isActive, sameDayManualBlock } = req.body;

        const region = await Region.findById(id);
        if (!region) return sendNotFound(res, 'Region not found');

        if (name !== undefined) region.name = name.trim();
        if (code !== undefined) region.code = code.trim().toUpperCase();
        if (isActive !== undefined) region.isActive = Boolean(isActive);
        if (sameDayManualBlock !== undefined) region.sameDayManualBlock = Boolean(sameDayManualBlock);

        await region.save();
        const sameDay = await computeSameDayStatus(region);
        return sendSuccess(res, 200, 'Region updated successfully', {
            ...region.toObject(),
            sameDay,
        });
    } catch (error) {
        console.error('Update Region Error:', error);
        return sendError(res, 500, error.message || 'Failed to update region');
    }
};

// DELETE /api/regions/:id — hard delete (admin)
const deleteRegion = async (req, res) => {
    try {
        const { id } = req.params;

        const region = await Region.findById(id);
        if (!region) return sendNotFound(res, 'Region not found');

        await region.deleteOne();
        return sendSuccess(res, 200, 'Region deleted successfully');
    } catch (error) {
        console.error('Delete Region Error:', error);
        return sendError(res, 500, error.message || 'Failed to delete region');
    }
};

module.exports = {
    getRegions,
    getAllRegions,
    getSameDayStatus,
    addRegion,
    updateRegion,
    deleteRegion,
};
