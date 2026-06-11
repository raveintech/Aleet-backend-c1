const jwt = require('jsonwebtoken');

/**
 * Socket.IO connection-time auth middleware.
 *
 * Reads the JWT from `socket.handshake.auth.token` (preferred) or
 * `socket.handshake.headers.authorization` (fallback). Attaches
 * `socket.userId` and `socket.role` for downstream presence handlers.
 *
 * Rejecting a connection here closes it before any event handlers fire.
 */
function socketAuth(socket, next) {
    const headerAuth = socket.handshake.headers?.authorization || '';
    const tokenFromAuth = socket.handshake.auth?.token;
    const tokenFromHeader = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : null;
    const token = tokenFromAuth || tokenFromHeader;

    if (!token) {
        return next(new Error('Unauthorized: no token'));
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        socket.role = decoded.role;
        return next();
    } catch (err) {
        return next(new Error('Unauthorized: invalid token'));
    }
}

module.exports = socketAuth;
