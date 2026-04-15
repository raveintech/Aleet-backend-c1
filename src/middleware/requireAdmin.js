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

module.exports = requireAdmin;
