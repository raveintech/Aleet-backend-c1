const User = require('../models/User');

/**
 * Driver presence handler — connection = online, disconnect = offline.
 *
 * On connect: if the user is an approved Diamond/Pro driver, flip
 * `driver.isOnline = true` and bump `driver.lastSeenAt`, then broadcast
 * a `driver:presence` event to the /admin namespace so admin UIs update
 * in real time without polling or refreshing.
 *
 * On disconnect: flip `driver.isOnline = false` IMMEDIATELY (real-time)
 * and broadcast the same event with isOnline=false.
 *
 * On any event/pong: bump `driver.lastSeenAt`.
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
 * Mark a driver online if they qualify (approved + Diamond/Pro).
 * Returns the updated driver doc (lean) so the broadcaster has fresh
 * lastSeenAt to send to admins. Non-qualifying users are allowed to
 * connect but don't affect AQD and don't trigger a broadcast.
 */
async function markOnline(userId) {
    const result = await User.findOneAndUpdate(
        {
            _id: userId,
            role: 'driver',
            'driver.status': 'approved',
            'driver.tier': { $in: ['Diamond', 'Pro'] },
        },
        { $set: { 'driver.isOnline': true, 'driver.lastSeenAt': new Date() } },
        { new: true, projection: { 'driver.isOnline': 1, 'driver.lastSeenAt': 1 } }
    ).lean();
    return result;
}

/** Mark a driver offline immediately. */
async function markOffline(userId) {
    const result = await User.findOneAndUpdate(
        { _id: userId, role: 'driver' },
        { $set: { 'driver.isOnline': false } },
        { new: true, projection: { 'driver.isOnline': 1, 'driver.lastSeenAt': 1 } }
    ).lean();
    return result;
}

/** Bump lastSeenAt without changing isOnline. Cheap freshness signal. */
async function touchLastSeen(userId) {
    await User.updateOne(
        { _id: userId, role: 'driver' },
        { $set: { 'driver.lastSeenAt': new Date() } }
    );
}

/**
 * Attach handlers to an authenticated socket. Called from sockets/index.js
 * after the auth middleware has populated `socket.userId` and `socket.role`.
 */
function registerDriverPresence(io, socket) {
    const userId = socket.userId;

    // Flip online on connect, then notify admins.
    markOnline(userId)
        .then((doc) => {
            if (doc) {
                broadcastPresence(io, {
                    userId,
                    isOnline: true,
                    lastSeenAt: doc.driver?.lastSeenAt || new Date().toISOString(),
                });
            }
        })
        .catch((e) => {
            console.error('[presence] markOnline failed:', userId, e?.message || e);
        });

    // Refresh lastSeenAt on any inbound event the driver app emits.
    socket.onAny(() => {
        touchLastSeen(userId).catch(() => { /* ignore */ });
    });

    socket.on('disconnect', (reason) => {
        markOffline(userId)
            .then((doc) => {
                broadcastPresence(io, {
                    userId,
                    isOnline: false,
                    lastSeenAt: doc?.driver?.lastSeenAt || null,
                });
            })
            .catch((e) => {
                console.error('[presence] markOffline failed:', userId, e?.message || e);
            });
        console.log(`[presence] socket disconnected for ${userId} (${reason}); marked offline`);
    });
}

module.exports = {
    registerDriverPresence,
    markOnline,
    markOffline,
    touchLastSeen,
    broadcastPresence,
};
