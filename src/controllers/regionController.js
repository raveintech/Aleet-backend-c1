const Region = require('../models/Region');
const {
    sendSuccess,
    sendError,
    sendValidationError,
    sendNotFound,
    sendConflict,
} = require('../utils/responseHelper');
const { recordAudit } = require('../services/auditLogService');
const sameDayEngine = require('../services/sameDayEngine');
const logger = require('../utils/logger');

// ─── Public ──────────────────────────────────────────────────────────────────

// GET /api/regions — all active regions (used by booking wizard)
const getRegions = async (req, res) => {
    try {
        const regions = await Region.find({ isActive: true }).select('name code').sort('name');
        return sendSuccess(res, 200, 'Regions retrieved successfully', regions);
    } catch (error) {
        (req.log || logger).error({ err: error }, 'Get Regions Error');
        return sendError(res, 500, error.message || 'Failed to retrieve regions');
    }
};

// ─── Admin ────────────────────────────────────────────────────────────────────

// GET /api/regions/all — all regions including inactive (admin)
const getAllRegions = async (req, res) => {
    try {
        const regions = await Region.find().sort('name');
        return sendSuccess(res, 200, 'All regions retrieved successfully', regions);
    } catch (error) {
        (req.log || logger).error({ err: error }, 'Get All Regions Error');
        return sendError(res, 500, error.message || 'Failed to retrieve regions');
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
        (req.log || logger).error({ err: error }, 'Add Region Error');
        return sendError(res, 500, error.message || 'Failed to add region');
    }
};

// PUT /api/regions/:id — update name/code/isActive/timezone (admin)
const updateRegion = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, code, isActive, timezone } = req.body;

        const region = await Region.findById(id);
        if (!region) return sendNotFound(res, 'Region not found');

        const before = region.toObject();

        if (name !== undefined) region.name = name.trim();
        if (code !== undefined) region.code = code.trim().toUpperCase();
        if (isActive !== undefined) region.isActive = Boolean(isActive);
        if (timezone !== undefined) region.timezone = timezone || null;

        await region.save();

        await recordAudit({
            req,
            category: 'region',
            action: 'region.update',
            targetType: 'Region',
            targetId: region._id,
            before,
            after: region.toObject(),
        });

        return sendSuccess(res, 200, 'Region updated successfully', region);
    } catch (error) {
        (req.log || logger).error({ err: error }, 'Update Region Error');
        return sendError(res, 500, error.message || 'Failed to update region');
    }
};

// PATCH /api/regions/:id/same-day-block — admin toggle for same-day OFF (T-2.4.3)
const setSameDayBlock = async (req, res) => {
    try {
        const { id } = req.params;
        const { sameDayBlock } = req.body;
        if (typeof sameDayBlock !== 'boolean') {
            return sendValidationError(res, 'sameDayBlock must be a boolean');
        }

        const region = await Region.findById(id);
        if (!region) return sendNotFound(res, 'Region not found');

        const before = { sameDayBlock: region.sameDayBlock };
        region.sameDayBlock = sameDayBlock;
        await region.save();

        sameDayEngine.invalidateCapacityCache(id);

        await recordAudit({
            req,
            category: 'region',
            action: 'region.same_day_block.set',
            targetType: 'Region',
            targetId: region._id,
            before,
            after: { sameDayBlock: region.sameDayBlock },
        });

        return sendSuccess(res, 200, 'Same-day block updated', {
            regionId: region._id,
            sameDayBlock: region.sameDayBlock,
        });
    } catch (error) {
        (req.log || logger).error({ err: error }, 'Set Same-Day Block Error');
        return sendError(res, 500, error.message || 'Failed to update same-day block');
    }
};

// GET /api/regions/:id/capacity — admin view of current same-day capacity (T-2.4.3)
const getRegionCapacity = async (req, res) => {
    try {
        const { id } = req.params;
        const region = await Region.findById(id).lean();
        if (!region) return sendNotFound(res, 'Region not found');
        const capacity = await sameDayEngine.isSameDayCapacityOn(id, { force: true });
        return sendSuccess(res, 200, 'Region capacity retrieved', {
            region: { _id: region._id, name: region.name, code: region.code, sameDayBlock: region.sameDayBlock },
            capacity,
        });
    } catch (error) {
        (req.log || logger).error({ err: error }, 'Get Region Capacity Error');
        return sendError(res, 500, error.message || 'Failed to retrieve region capacity');
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
        (req.log || logger).error({ err: error }, 'Delete Region Error');
        return sendError(res, 500, error.message || 'Failed to delete region');
    }
};

module.exports = {
    getRegions,
    getAllRegions,
    addRegion,
    updateRegion,
    deleteRegion,
    setSameDayBlock,
    getRegionCapacity,
};
