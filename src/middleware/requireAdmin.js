const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendUnauthorized, sendForbidden } = require('../utils/responseHelper');

const requireAdmin = async (req, res, next) => {
    const authHeader = req.header('Authorization');
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return sendUnauthorized(res, 'No token provided');

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');

        if (!user) return sendUnauthorized(res, 'User not found');
        if (user.role !== 'admin') return sendForbidden(res, 'Admin access required');
        if (!user.active) return sendForbidden(res, 'Account is deactivated');

        req.user = user;
        next();
    } catch {
        return sendUnauthorized(res, 'Invalid or expired token');
    }
};

/**
 * Middleware factory that checks if the authenticated admin has ALL of the specified permissions.
 * Must be used AFTER requireAdmin (which populates req.user).
 *
 * Usage: requirePermission('manage-users')
 *        requirePermission('super-admin')
 */
const requirePermission = (...permissions) => (req, res, next) => {
    const userPermissions = req.user?.admin?.permissions ?? [];
    const missing = permissions.filter((p) => !userPermissions.includes(p));
    if (missing.length > 0) {
        return sendForbidden(res, `Missing required permission(s): ${missing.join(', ')}`);
    }
    next();
};

module.exports = requireAdmin;
module.exports.requirePermission = requirePermission;
