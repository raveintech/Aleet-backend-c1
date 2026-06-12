const { markOnline, markOffline } = require('./presenceRegistry');

/**
 * Driver presence handler — connection = online, disconnect = offline.
 *
 * Presence lives ENTIRELY in memory via presenceRegistry — never written
 * to MongoDB. That isolates local dev from production even when both
 * share the same DB. Each backend instance owns its own registry; the
 * AQD service joins it with the approved-driver query.
 *
 * On connect: add to registry, broadcast `driver:presence` to /admin.
 * On disconnect: remove from registry (only if no other sockets remain
 * for the same user — multi-tab edge case), broadcast offline.
 */

/** Emit a presence change to all connected admin sockets. */
function broadcastPresence(io, payload) {
    if (!io) return;
    try {
        io.of('/admin').emit('driver:presence', payload);
    } catch (e) {
        console.error('[presence] broadcast failed:', e?.message || e);
    }
}

/**
 * Attach handlers to an authenticated socket. Called from sockets/index.js
 * after the auth middleware has populated `socket.userId` and `socket.role`.
 */
function registerDriverPresence(io, socket) {
    const userId = socket.userId;

    // Add this socket to the registry. `wasOffline` is true only on the
    // user's FIRST socket — that's when we tell admins the driver came
    // online. A second tab/device doesn't refire the event.
    const wasOffline = markOnline(userId, socket.id);
    if (wasOffline) {
        broadcastPresence(io, { userId, isOnline: true });
    }

    socket.on('disconnect', (reason) => {
        // Remove this socket; nowOffline is true only when the user's LAST
        // socket closed. Lets the driver app keep multi-tab presence quiet.
        const nowOffline = markOffline(userId, socket.id);
        if (nowOffline) {
            broadcastPresence(io, { userId, isOnline: false });
        }
        console.log(`[presence] socket disconnected for ${userId} (${reason}); ${nowOffline ? 'marked offline' : 'other sockets still open'}`);
    });
}

module.exports = { registerDriverPresence };
