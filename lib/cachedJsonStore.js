// Generic in-memory cache layer for the small JSON config files used all
// over the bot (antilink.json, antistatus.json, coins.json, etc).
//
// PROBLEM this fixes: every one of those files used to call
// fs.readFileSync() from scratch on every single get, and this get runs on
// EVERY incoming message (group or DM). fs.readFileSync is synchronous and
// blocks Node's single event loop — so on a busy bot, every message was
// stalling ALL other message processing while disk I/O completed.
//
// FIX: read the file once, keep it in memory, and only touch disk again
// when something actually changes (debounced, so bursts of changes still
// only cost one real write).
//
// © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx

const fs = require('fs');
const path = require('path');

const _cache = new Map();       // filePath -> parsed JS object (live reference)
const _writeTimers = new Map(); // filePath -> setTimeout handle
const WRITE_DEBOUNCE_MS = 300;

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Returns the cached object for filePath, loading it from disk exactly
 * once (lazily, on first access). All later calls are pure memory reads.
 */
function loadCached(filePath, defaultValue) {
    if (_cache.has(filePath)) return _cache.get(filePath);

    let data;
    try {
        data = fs.existsSync(filePath)
            ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
            : (typeof defaultValue === 'function' ? defaultValue() : defaultValue);
    } catch {
        data = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
    }

    _cache.set(filePath, data);
    return data;
}

/**
 * Updates the in-memory cache immediately (so any get() right after this
 * sees the new value with zero delay) and schedules a debounced disk write
 * so the change survives a restart.
 */
function saveCached(filePath, data) {
    _cache.set(filePath, data);

    if (_writeTimers.has(filePath)) return; // a flush is already scheduled

    const timer = setTimeout(() => {
        _writeTimers.delete(filePath);
        try {
            ensureDir(filePath);
            fs.writeFileSync(filePath, JSON.stringify(_cache.get(filePath), null, 2));
        } catch (e) {
            console.error('cachedJsonStore: write failed for', filePath, e.message);
        }
    }, WRITE_DEBOUNCE_MS);

    _writeTimers.set(filePath, timer);
}

/** Force any pending debounced writes to flush immediately (e.g. on shutdown). */
function flushAll() {
    for (const [filePath, timer] of _writeTimers.entries()) {
        clearTimeout(timer);
        _writeTimers.delete(filePath);
        try {
            ensureDir(filePath);
            fs.writeFileSync(filePath, JSON.stringify(_cache.get(filePath), null, 2));
        } catch (e) {
            console.error('cachedJsonStore: flush failed for', filePath, e.message);
        }
    }
}

module.exports = { loadCached, saveCached, flushAll };
