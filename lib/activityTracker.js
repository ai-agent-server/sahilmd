// lib/activityTracker.js
// Tracks the last time each group member sent a message, so features like
// ".kickoffline" can identify members who have been inactive for a while.
// Persisted to disk so activity history survives restarts.

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'activity-tracker.json');

function ensureDir() {
    const dir = path.dirname(FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
    try {
        if (!fs.existsSync(FILE_PATH)) return {};
        return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    } catch {
        return {};
    }
}

let cache = null;
let dirty = false;

function getCache() {
    if (!cache) cache = load();
    return cache;
}

function saveIfDirty() {
    if (!dirty) return;
    try {
        ensureDir();
        fs.writeFileSync(FILE_PATH, JSON.stringify(cache, null, 2));
        dirty = false;
    } catch (e) {
        console.error('activityTracker: save error:', e.message);
    }
}
// Flush to disk periodically instead of on every single message.
setInterval(saveIfDirty, 15000).unref?.();

// Record that `userJid` was active in `groupJid` right now (or at `timestamp`).
function recordActivity(groupJid, userJid, timestamp = Date.now()) {
    const data = getCache();
    if (!data[groupJid]) data[groupJid] = {};
    data[groupJid][userJid] = timestamp;
    dirty = true;
}

// Get the last-active timestamp (ms since epoch) for `userJid` in `groupJid`,
// or null if we have no record of them ever sending a message in that group.
function getLastActive(groupJid, userJid) {
    const data = getCache();
    return data[groupJid]?.[userJid] ?? null;
}

function getGroupActivity(groupJid) {
    const data = getCache();
    return data[groupJid] || {};
}

// Wipes all recorded activity history (in-memory + the file on disk).
function clearAll() {
    cache = {};
    dirty = false;
    try {
        if (fs.existsSync(FILE_PATH)) fs.unlinkSync(FILE_PATH);
    } catch (e) {
        console.error('activityTracker: clear error:', e.message);
    }
}

module.exports = { recordActivity, getLastActive, getGroupActivity, saveIfDirty, clearAll };
