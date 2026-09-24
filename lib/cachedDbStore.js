// Generic database-backed key/value cache.
//
// Several command modules (antilink, antistatus, autoreacts, autochreact)
// keep their settings in memory for fast synchronous reads, but still need
// those settings to survive Heroku dyno restarts / redeploys. This module
// gives them a tiny key/value store on top of the existing Sequelize
// DATABASE connection (Postgres in production, sqlite locally), with an
// in-memory cache in front so getCached()/setCached() can stay synchronous.
//
// © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx

const { DATABASE, DatabaseManager } = require("./database");

let CachedSetting = null;
let dbReady = false;
let synced = false;

if (DATABASE && DatabaseManager && DatabaseManager.isAvailable()) {
    try {
        const { DataTypes } = require("sequelize");
        CachedSetting = DATABASE.define(
            "CachedSetting",
            {
                key: { type: DataTypes.STRING, primaryKey: true },
                value: { type: DataTypes.TEXT, allowNull: false, defaultValue: "null" },
            },
            { tableName: "cached_settings", timestamps: true }
        );
        dbReady = true;
    } catch (e) {
        console.error("⚠️ CachedSetting model failed:", e.message);
        dbReady = false;
    }
}

async function ensureSynced() {
    if (!dbReady || !CachedSetting) return false;
    if (!synced) {
        try {
            await CachedSetting.sync();
            synced = true;
        } catch (e) {
            console.error("⚠️ CachedSetting.sync failed:", e.message);
            dbReady = false;
            return false;
        }
    }
    return true;
}

const memCache = new Map();

// Resolve a default value that may be given either as a plain value or as
// a factory function (some callers pass `() => ({...})` to avoid sharing
// one mutable object across calls).
function resolveDefault(defaultValue) {
    return typeof defaultValue === "function" ? defaultValue() : defaultValue;
}

// Load a key from the DB into the in-memory cache (or seed it with the
// default if it isn't in the DB yet). Must be awaited once at startup
// before getCached()/setCached() are relied on for that key.
async function preload(key, defaultValue) {
    if (!(await ensureSynced())) {
        memCache.set(key, resolveDefault(defaultValue));
        return memCache.get(key);
    }
    try {
        const row = await CachedSetting.findByPk(key);
        if (row) {
            try {
                memCache.set(key, JSON.parse(row.value));
            } catch {
                memCache.set(key, resolveDefault(defaultValue));
            }
        } else {
            memCache.set(key, resolveDefault(defaultValue));
        }
    } catch (e) {
        memCache.set(key, resolveDefault(defaultValue));
    }
    return memCache.get(key);
}

// Synchronous read from the in-memory cache. Falls back to the default
// (without persisting it) if preload() hasn't populated this key yet.
function getCached(key, defaultValue) {
    if (memCache.has(key)) return memCache.get(key);
    return resolveDefault(defaultValue);
}

// Synchronous-looking write: updates the in-memory cache immediately so
// getCached() reflects it right away, and debounces the actual DB write
// so bursts of updates don't hammer the database.
const saveTimers = new Map();
function setCached(key, value) {
    memCache.set(key, value);

    if (saveTimers.has(key)) return; // a write is already scheduled for this key
    const timer = setTimeout(async () => {
        saveTimers.delete(key);
        try {
            if (await ensureSynced()) {
                await CachedSetting.upsert({ key, value: JSON.stringify(memCache.get(key)) });
            }
        } catch (err) {
            console.error(`[cachedDbStore] Failed to persist key "${key}":`, err.message);
        }
    }, 250);
    saveTimers.set(key, timer);
}

// Wipes every key/value pair from the cached_settings table (bans,
// disabled-commands, command-requests, antilink/antistatus/autoreact
// settings, channels, etc — anything stored through this module) AND
// resets the in-memory cache + any pending debounced writes, so nothing
// old gets re-written to the DB right after the clear.
async function clearAll() {
    let count = 0;
    if (await ensureSynced()) {
        try {
            count = await CachedSetting.count();
            await CachedSetting.destroy({ where: {}, truncate: true });
        } catch (_) {}
    }
    memCache.clear();
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();
    return count;
}

// Wipes only the given keys (both from DB and the in-memory cache), leaving
// every other key untouched. Use this instead of clearAll() when you want
// a precise, labeled "clear X" action rather than nuking everything stored
// through this module.
async function clearKeys(keys) {
    await ensureSynced();
    let count = 0;
    for (const key of keys) {
        if (memCache.has(key)) count++;
        memCache.delete(key);
        if (saveTimers.has(key)) {
            clearTimeout(saveTimers.get(key));
            saveTimers.delete(key);
        }
    }
    await CachedSetting.destroy({ where: { key: keys } });
    return count;
}

module.exports = { preload, getCached, setCached, clearAll, clearKeys };
