// lib/banStore.js
// Handles both WhatsApp-number bans (blocks bot commands) and IP bans
// (blocks pairing-site requests). Supports an optional reason and an
// optional expiry (auto-unban after N hours).
//
// Persisted in Postgres (via cachedDbStore) instead of a local JSON file,
// so bans survive a Heroku dyno restart/redeploy instead of being wiped.

const { preload, getCached, setCached } = require('./cachedDbStore');

const KEY = 'bans';
const DEFAULT = () => ({ users: {}, ips: {} });

const ready = preload(KEY, DEFAULT);

function loadBans() {
    const data = getCached(KEY, DEFAULT);
    if (!data.users) data.users = {};
    if (!data.ips) data.ips = {};
    return data;
}

function saveBans(data) {
    setCached(KEY, data);
}

// Drops any bans whose expiry has passed. Saves only if something changed.
function pruneExpired(data) {
    const now = Date.now();
    let changed = false;
    for (const bucketName of ['users', 'ips']) {
        const bucket = data[bucketName];
        for (const id of Object.keys(bucket)) {
            if (bucket[id].expiresAt && bucket[id].expiresAt <= now) {
                delete bucket[id];
                changed = true;
            }
        }
    }
    if (changed) saveBans(data);
    return data;
}

function isBanned(type, value) {
    if (!value) return false;
    const data = pruneExpired(loadBans());
    const bucket = type === 'ip' ? data.ips : data.users;
    return !!bucket[value];
}

function getBanInfo(type, value) {
    const data = pruneExpired(loadBans());
    const bucket = type === 'ip' ? data.ips : data.users;
    return bucket[value] || null;
}

function ban(type, value, reason, expiryHours) {
    const data = loadBans();
    const bucket = type === 'ip' ? data.ips : data.users;
    bucket[value] = {
        reason: reason ? String(reason).slice(0, 200) : null,
        bannedAt: Date.now(),
        expiresAt: expiryHours ? Date.now() + (Number(expiryHours) * 3600 * 1000) : null
    };
    saveBans(data);
}

function unban(type, value) {
    const data = loadBans();
    const bucket = type === 'ip' ? data.ips : data.users;
    delete bucket[value];
    saveBans(data);
}

// Returns { users: [{value, reason, bannedAt, expiresAt}], ips: [...] }
function listBans() {
    const data = pruneExpired(loadBans());
    const toList = (bucket) => Object.entries(bucket).map(([value, info]) => ({ value, ...info }));
    return { users: toList(data.users), ips: toList(data.ips) };
}

module.exports = { isBanned, getBanInfo, ban, unban, listBans, ready };
