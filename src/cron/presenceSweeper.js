const User = require('../models/User');

/**
 * Presence sweeper — safety net for crashed sockets, killed processes,
 * and any scenario where a socket's 'disconnect' event never fired.
 *
 * Flips any driver to isOnline=false if their lastSeenAt is older than
 * STALE_THRESHOLD_MS. Socket.IO emits a pong every ~25s while the
 * connection is healthy (which bumps lastSeenAt via the onAny handler
 * in driverPresence.js), so a 5-minute staleness window is generous.
 *
 * Invoked from server.js on a 2-minute setInterval.
 */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

async function runPresenceSweep() {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const result = await User.updateMany(
        {
            role: 'driver',
            'driver.isOnline': true,
            $or: [
                { 'driver.lastSeenAt': { $lt: cutoff } },
                { 'driver.lastSeenAt': null },
            ],
        },
        { $set: { 'driver.isOnline': false } }
    );
    if (result.modifiedCount > 0) {
        console.log(`[presence-sweeper] flipped ${result.modifiedCount} stale drivers offline`);
    }
    return result.modifiedCount;
}

module.exports = { runPresenceSweep, STALE_THRESHOLD_MS };
