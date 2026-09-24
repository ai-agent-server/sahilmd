// lib/groupMetadataCache.js
// conn.groupMetadata(jid) is a real network round-trip to WhatsApp's
// servers. The bot was calling it fresh on EVERY group message that needed
// admin checks (antilink/antistatus) and on EVERY command run inside a
// group — so every such message had to wait out a network call before the
// bot could respond.
//
// FIX: cache each group's metadata in memory for a short TTL. Almost all
// reads (checking if someone is admin, getting the participant list) don't
// need up-to-the-second freshness — a group's admin list rarely changes
// second to second. We also proactively invalidate a group's cache entry
// the moment we hear about a real change (promotions/demotions/joins/
// leaves/subject change), so admin actions still take effect immediately
// instead of waiting for the TTL to expire.
//
// © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx

const TTL_MS = 60 * 1000; // metadata younger than this is served fresh, no refetch
const STALE_MS = 10 * 60 * 1000; // beyond this we won't serve it at all — force a real fetch
const _cache = new Map(); // jid -> { data, expiresAt, inflight }

async function getGroupMetadata(conn, jid, { force = false } = {}) {
    const entry = _cache.get(jid);
    const now = Date.now();

    if (!force && entry && entry.expiresAt > now) {
        return entry.data;
    }

    // If a fetch for this jid is already in flight, reuse it instead of
    // firing a second parallel network call for the same group.
    if (!force && entry && entry.inflight) {
        return entry.inflight;
    }

    const refresh = conn.groupMetadata(jid).then((data) => {
        _cache.set(jid, { data, expiresAt: Date.now() + TTL_MS, inflight: null });
        return data;
    }).catch((err) => {
        // Keep serving the stale data (if any) on a failed refresh instead
        // of wiping the cache — a transient network hiccup shouldn't force
        // every subsequent command in this group to block on a fresh fetch.
        if (entry) _cache.set(jid, { ...entry, inflight: null });
        else _cache.delete(jid);
        throw err;
    });

    // ── Stale-while-revalidate: if we have ANY previous data for this group
    // (even expired, as long as it's not ancient), return it immediately and
    // let the refresh happen in the background. This is what actually keeps
    // command replies fast — after the very first message in a group, no
    // command ever has to wait out a real network round-trip for admin
    // checks again, it just gets last-known-good data instantly. ──
    if (!force && entry?.data && now - (entry.expiresAt - TTL_MS) < STALE_MS) {
        _cache.set(jid, { data: entry.data, expiresAt: entry.expiresAt, inflight: refresh });
        refresh.catch(() => {}); // don't let the background refresh become an unhandled rejection
        return entry.data;
    }

    // True cache miss (first time seeing this group, or data too old to
    // trust) — this is the only case that actually waits on the network.
    _cache.set(jid, { data: entry?.data, expiresAt: entry?.expiresAt || 0, inflight: refresh });
    return refresh;
}

// Call this whenever we get a real-time signal that a group actually
// changed (participants updated, subject changed, etc.) so stale data
// never lingers past the moment we already know about the change.
function invalidate(jid) {
    _cache.delete(jid);
}

function invalidateAll() {
    _cache.clear();
}

module.exports = { getGroupMetadata, invalidate, invalidateAll };
