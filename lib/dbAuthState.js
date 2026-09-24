// Database-backed auth with safe fallback to multi-file auth.
// On Heroku without DATABASE_URL (or if sqlite native fails), we fall back
// to useMultiFileAuthState so the app never crashes on startup.

const path = require("path");
const fs = require("fs");
const { proto, initAuthCreds, BufferJSON, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const { DATABASE, DatabaseManager } = require("./database");

let AuthSession = null;
let dbReady = false;

if (DATABASE && DatabaseManager && DatabaseManager.isAvailable()) {
    try {
        const { DataTypes } = require("sequelize");
        AuthSession = DATABASE.define(
            "AuthSession",
            {
                sessionId: { type: DataTypes.STRING, primaryKey: true },
                creds: { type: DataTypes.TEXT, allowNull: false },
                keys: { type: DataTypes.TEXT, allowNull: false, defaultValue: "{}" },
            },
            { tableName: "auth_sessions", timestamps: true }
        );
        dbReady = true;
        console.log("✅ DB auth state ready");
    } catch (e) {
        console.error("⚠️ AuthSession model failed, using file auth:", e.message);
        dbReady = false;
        AuthSession = null;
    }
} else {
    console.log("ℹ️ No database available — using multi-file auth state");
}

let synced = false;
async function ensureSynced() {
    if (!dbReady || !AuthSession) return false;
    if (!synced) {
        try {
            await AuthSession.sync();
            synced = true;
        } catch (e) {
            console.error("⚠️ AuthSession.sync failed:", e.message);
            dbReady = false;
            return false;
        }
    }
    return true;
}

function sessionDir(sessionId) {
    const dir = path.join(__dirname, "..", "sessions", String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "_"));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

async function useDBAuthState(sessionId) {
    // Prefer DB when available
    if (await ensureSynced()) {
        try {
            const row = await AuthSession.findByPk(sessionId);
            const creds = row ? JSON.parse(row.creds, BufferJSON.reviver) : initAuthCreds();
            const keysData = row ? JSON.parse(row.keys, BufferJSON.reviver) : {};

            let saveTimer = null;
            let pendingWaiters = [];
            const persist = () =>
                new Promise((resolve, reject) => {
                    pendingWaiters.push({ resolve, reject });
                    if (saveTimer) return;
                    saveTimer = setTimeout(async () => {
                        const waiters = pendingWaiters;
                        pendingWaiters = [];
                        saveTimer = null;
                        try {
                            await AuthSession.upsert({
                                sessionId,
                                creds: JSON.stringify(creds, BufferJSON.replacer),
                                keys: JSON.stringify(keysData, BufferJSON.replacer),
                            });
                            waiters.forEach((w) => w.resolve());
                        } catch (err) {
                            waiters.forEach((w) => w.reject(err));
                        }
                    }, 250);
                });

            return {
                state: {
                    creds,
                    keys: {
                        get: async (type, ids) => {
                            const result = {};
                            for (const id of ids) {
                                if (keysData[type]?.[id] !== undefined) {
                                    let value = keysData[type][id];
                                    if (type === "app-state-sync-key" && value) {
                                        value = proto.Message.AppStateSyncKeyData.fromObject(value);
                                    }
                                    result[id] = value;
                                }
                            }
                            return result;
                        },
                        set: async (data) => {
                            for (const type in data) {
                                keysData[type] = keysData[type] || {};
                                Object.assign(keysData[type], data[type]);
                                for (const id of Object.keys(data[type] || {})) {
                                    if (data[type][id] == null) delete keysData[type][id];
                                }
                            }
                            await persist();
                        },
                    },
                },
                saveCreds: persist,
            };
        } catch (e) {
            console.error("⚠️ DB auth failed, falling back to file:", e.message);
        }
    }

    // Fallback: multi-file auth (works on Heroku ephemeral disk for current dyno life)
    console.log(`📁 Using multi-file auth for session: ${sessionId}`);
    return useMultiFileAuthState(sessionDir(sessionId));
}

async function dbSessionExists(sessionId) {
    if (await ensureSynced()) {
        try {
            const row = await AuthSession.findByPk(sessionId);
            return !!row;
        } catch (_) {}
    }
    const dir = sessionDir(sessionId);
    return fs.existsSync(path.join(dir, "creds.json"));
}

async function listDBSessions() {
    if (await ensureSynced()) {
        try {
            const rows = await AuthSession.findAll({ attributes: ["sessionId"] });
            return rows.map((r) => r.sessionId);
        } catch (_) {}
    }
    const base = path.join(__dirname, "..", "sessions");
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base).filter((n) => {
        try {
            return fs.statSync(path.join(base, n)).isDirectory();
        } catch {
            return false;
        }
    });
}

async function deleteDBSession(sessionId) {
    if (await ensureSynced()) {
        try {
            await AuthSession.destroy({ where: { sessionId } });
        } catch (_) {}
    }
    const dir = sessionDir(sessionId);
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
}

async function clearAllDBSessions() {
    let count = 0;
    if (await ensureSynced()) {
        try {
            count = await AuthSession.count();
            await AuthSession.destroy({ where: {}, truncate: true });
        } catch (_) {}
    }
    const base = path.join(__dirname, "..", "sessions");
    if (fs.existsSync(base)) {
        for (const n of fs.readdirSync(base)) {
            try {
                fs.rmSync(path.join(base, n), { recursive: true, force: true });
                count++;
            } catch (_) {}
        }
    }
    return count;
}

module.exports = { useDBAuthState, dbSessionExists, listDBSessions, deleteDBSession, clearAllDBSessions };
