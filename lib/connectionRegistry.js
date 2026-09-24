// ── Connection Registry ─────────────────────────────────────────────────────
// Mirrors server.js's `activeConnections` Map so that command files (which
// don't otherwise have access to server.js internals) can reach every
// currently-connected session. server.js calls register()/unregister()
// wherever it adds/removes an entry from activeConnections.

const registry = new Map(); // sessionId -> conn

function register(sessionId, conn) {
    if (!sessionId || !conn) return;
    registry.set(sessionId, conn);
}

function unregister(sessionId) {
    registry.delete(sessionId);
}

// Returns [{ sessionId, conn }, ...] for every session currently connected
function getAll() {
    return Array.from(registry.entries()).map(([sessionId, conn]) => ({ sessionId, conn }));
}

module.exports = { register, unregister, getAll };
