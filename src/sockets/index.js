const { Server } = require('socket.io');
const socketAuth = require('../middleware/socketAuth');
const { registerDriverPresence } = require('./driverPresence');
const { getOnlineIds } = require('./presenceRegistry');

/**
 * Initialize the Socket.IO server on top of an existing HTTP server.
 *
 * Namespaces:
 *  - /drivers — driver-app connections. Each open socket marks the driver
 *               as present in THIS backend instance's in-memory registry
 *               (never DB-backed). AQD reads from the registry.
 *  - /admin   — admin-app connections. On connect, gets a snapshot of the
 *               currently-online driver IDs. Subsequent `driver:presence`
 *               broadcasts patch that snapshot live.
 *
 * Auth: socketAuth middleware verifies the JWT from
 * `handshake.auth.token` (preferred) or `Authorization` header (fallback).
 * Rejecting at this stage closes the socket before any events fire.
 */
function initSockets(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            credentials: false,
        },
    });

    const drivers = io.of('/drivers');
    drivers.use(socketAuth);
    drivers.on('connection', (socket) => {
        if (socket.role !== 'driver') {
            socket.disconnect(true);
            return;
        }
        console.log(`[socket] driver connected: ${socket.userId}`);
        registerDriverPresence(io, socket);
    });

    const admin = io.of('/admin');
    admin.use(socketAuth);
    admin.on('connection', (socket) => {
        if (socket.role !== 'admin') {
            socket.disconnect(true);
            return;
        }
        console.log(`[socket] admin connected: ${socket.userId}`);
        // Hydrate the admin UI immediately — no need to crawl the DB for
        // an `isOnline` flag (which we no longer write).
        socket.emit('driver:presence:snapshot', getOnlineIds());
        socket.on('disconnect', (reason) => {
            console.log(`[socket] admin disconnected: ${socket.userId} (${reason})`);
        });
    });

    return io;
}

module.exports = initSockets;
