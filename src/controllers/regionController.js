const Region = require('../models/Region');
const {
    sendSuccess,
    sendError,
    sendValidationError,
    sendNotFound,
    sendConflict,
} = require('../utils/responseHelper');

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
const getAllRegions = async (req, res) => {
    try {
        const regions = await Region.find().sort('name');
        return sendSuccess(res, 200, 'All regions retrieved successfully', regions);
    } catch (error) {
        console.error('Get All Regions Error:', error);
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
        console.error('Add Region Error:', error);
        return sendError(res, 500, error.message || 'Failed to add region');
    }
};

// PUT /api/regions/:id — update name/code/isActive (admin)
const updateRegion = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, code, isActive } = req.body;

        const region = await Region.findById(id);
        if (!region) return sendNotFound(res, 'Region not found');

        if (name !== undefined) region.name = name.trim();
        if (code !== undefined) region.code = code.trim().toUpperCase();
        if (isActive !== undefined) region.isActive = Boolean(isActive);

        await region.save();
        return sendSuccess(res, 200, 'Region updated successfully', region);
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
    addRegion,
    updateRegion,
    deleteRegion,
};
