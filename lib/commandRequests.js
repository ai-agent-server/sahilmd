// lib/commandRequests.js
// Stores "request a new command" submissions coming from the pairing site
// so the admin can review them later.
//
// Persisted in Postgres (via cachedDbStore) so requests survive a Heroku
// dyno restart/redeploy instead of being wiped.

const { preload, getCached, setCached } = require('./cachedDbStore');

const KEY = 'command-requests';
const DEFAULT = () => ([]);
const MAX_REQUESTS = 500; // keep the list from growing forever

const ready = preload(KEY, DEFAULT);

function loadRequests() {
    const data = getCached(KEY, DEFAULT);
    return Array.isArray(data) ? data : [];
}

function saveRequests(list) {
    setCached(KEY, list);
}

// Basic per-IP throttle so one person can't spam hundreds of requests.
const lastSubmitByIp = new Map();
const THROTTLE_MS = 8 * 1000; // small cooldown, just to stop accidental double-submits

function isThrottled(ip) {
    const last = lastSubmitByIp.get(ip);
    if (!last) return false;
    return (Date.now() - last) < THROTTLE_MS;
}

function addRequest({ name, description, ip }) {
    const list = loadRequests();

    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: String(name || '').trim().slice(0, 60),
        description: String(description || '').trim().slice(0, 500),
        ip: ip || '',
        status: 'pending', // pending | approved | rejected
        createdAt: new Date().toISOString()
    };

    list.unshift(entry);
    if (list.length > MAX_REQUESTS) list.length = MAX_REQUESTS;

    saveRequests(list);
    if (ip) lastSubmitByIp.set(ip, Date.now());

    return entry;
}

function getRequests() {
    return loadRequests();
}

function updateStatus(id, status) {
    const list = loadRequests();
    const item = list.find(r => r.id === id);
    if (!item) return null;
    item.status = status;
    saveRequests(list);
    return item;
}

function deleteRequest(id) {
    const list = loadRequests();
    const next = list.filter(r => r.id !== id);
    const changed = next.length !== list.length;
    if (changed) saveRequests(next);
    return changed;
}

module.exports = {
    addRequest,
    getRequests,
    updateStatus,
    deleteRequest,
    isThrottled,
    ready
};

// © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx
