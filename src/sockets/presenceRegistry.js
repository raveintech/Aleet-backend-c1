/**
 * In-memory driver presence registry.
 *
 * Holds the set of userIds with an active /drivers socket on THIS backend
 * instance. Wiped on process restart; never persisted to MongoDB.
 *
 * Why in-memory:
 *  - Local dev backend's set never leaks into production (and vice versa)
 *    even when both share the same MongoDB. Each instance owns its own
 *    view of who is connected to IT.
 *  - No DB writes per connect/disconnect — faster, cleaner.
 *  - Restart self-heals within seconds via Socket.IO auto-reconnect.
 *
 * Caveats:
 *  - Multi-instance backends need a Redis adapter for Socket.IO so presence
 *    propagates between nodes. Single-instance is fine as-is.
 *
 * One user can have multiple sockets open (e.g. driver app on phone +
 * mistakenly left open on laptop). We track all socket IDs per user so
 * one tab closing doesn't mark the driver offline if another is still
 * connected.
 */

// userId (string) -> Set<socketId>
const socketsByUser = new Map();

/** Register a connected socket for a user. Returns true on first socket (newly online). */
function markOnline(userId, socketId) {
    const uid = String(userId);
    let set = socketsByUser.get(uid);
    const wasOffline = !set || set.size === 0;
    if (!set) {
        set = new Set();
        socketsByUser.set(uid, set);
    }
    set.add(socketId);
    return wasOffline;
}

/** Deregister a socket. Returns true when the user has no more sockets (newly offline). */
function markOffline(userId, socketId) {
    const uid = String(userId);
    const set = socketsByUser.get(uid);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) {
        socketsByUser.delete(uid);
        return true;
    }
    return false;
}

/** True if the user has at least one open socket on this instance. */
function isOnline(userId) {
    const set = socketsByUser.get(String(userId));
    return !!(set && set.size > 0);
}

/** Snapshot of currently-online userIds — used by AQD + admin UI hydration. */
function getOnlineIds() {
    return Array.from(socketsByUser.keys());
}

/** Number of distinct online drivers (debug / metrics). */
function getOnlineCount() {
    return socketsByUser.size;
}

/**
 * Disconnect every open socket for a user. Used when an admin suspends a
 * driver — they should immediately drop off AQD. Optional, the next AQD
 * computation also handles it via the approved-driver join.
 */
function disconnectUser(userId, ioOrNamespace) {
    const uid = String(userId);
    const set = socketsByUser.get(uid);
    if (!set || set.size === 0) return 0;
    let count = 0;
    for (const socketId of set) {
        const s = ioOrNamespace?.sockets?.get(socketId);
        if (s) {
            try { s.disconnect(true); count++; } catch (e) { /* ignore */ }
        }
    }
    socketsByUser.delete(uid);
    return count;
}

module.exports = {
    markOnline,
    markOffline,
    isOnline,
    getOnlineIds,
    getOnlineCount,
    disconnectUser,
};
