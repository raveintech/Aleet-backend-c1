const AdminService = require('../services/adminService');
const {
    sendSuccess,
    sendError,
    sendValidationError,
    sendNotFound,
    sendConflict,
    sendPaginated,
} = require('../utils/responseHelper');

// ── GET /api/admin/admins ─────────────────────────────────────────────────────
const getAllAdmins = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

        const { admins, pagination } = await AdminService.getAllAdmins({ page, limit });

        return sendPaginated(res, 'Admins retrieved successfully', admins, pagination);
    } catch (error) {
        console.error('getAllAdmins error:', error);
        return sendError(res, error.statusCode || 500, error.message);
    }
};

// ── GET /api/admin/admins/:id ─────────────────────────────────────────────────
const getAdminById = async (req, res) => {
    try {
        const admin = await AdminService.getAdminById(req.params.id);
        return sendSuccess(res, 200, 'Admin retrieved successfully', admin);
    } catch (error) {
        console.error('getAdminById error:', error);
        if (error.statusCode === 404) return sendNotFound(res, error.message);
        return sendError(res, error.statusCode || 500, error.message);
    }
};

// ── POST /api/admin/admins ────────────────────────────────────────────────────
const createAdmin = async (req, res) => {
    try {
        const { name, email, phone, password, permissions } = req.body;
        const admin = await AdminService.createAdmin({ name, email, phone, password, permissions });
        return sendSuccess(res, 201, 'Admin created successfully', admin);
    } catch (error) {
        console.error('createAdmin error:', error);
        if (error.statusCode === 400) return sendValidationError(res, error.message);
        if (error.statusCode === 409) return sendConflict(res, error.message);
        return sendError(res, error.statusCode || 500, error.message);
    }
};

// ── PUT /api/admin/admins/:id ─────────────────────────────────────────────────
const updateAdmin = async (req, res) => {
    try {
        const { name, email, phone, permissions, active, password } = req.body;
        const admin = await AdminService.updateAdmin(req.params.id, {
            name,
            email,
            phone,
            permissions,
            active,
            password,
        });
        return sendSuccess(res, 200, 'Admin updated successfully', admin);
    } catch (error) {
        console.error('updateAdmin error:', error);
        if (error.statusCode === 404) return sendNotFound(res, error.message);
        if (error.statusCode === 400) return sendValidationError(res, error.message);
        if (error.statusCode === 409) return sendConflict(res, error.message);
        return sendError(res, error.statusCode || 500, error.message);
    }
};

// ── DELETE /api/admin/admins/:id ──────────────────────────────────────────────
const deleteAdmin = async (req, res) => {
    try {
        const requesterId = req.user._id.toString();
        const result = await AdminService.deleteAdmin(req.params.id, requesterId);
        return sendSuccess(res, 200, 'Admin deleted successfully', result);
    } catch (error) {
        console.error('deleteAdmin error:', error);
        if (error.statusCode === 404) return sendNotFound(res, error.message);
        if (error.statusCode === 400) return sendValidationError(res, error.message);
        return sendError(res, error.statusCode || 500, error.message);
    }
};

module.exports = { getAllAdmins, getAdminById, createAdmin, updateAdmin, deleteAdmin };
