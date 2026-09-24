// Database-backed stats with in-memory / file fallback so Heroku never crashes.

const fs = require("fs");
const path = require("path");
const { DATABASE, DatabaseManager } = require("./database");

const FILE = path.join(__dirname, "..", "persistent-data.json");

let BotStats = null;
let dbReady = false;
let synced = false;

if (DATABASE && DatabaseManager && DatabaseManager.isAvailable()) {
    try {
        const { DataTypes } = require("sequelize");
        BotStats = DATABASE.define(
            "BotStats",
            {
                id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
                totalUsers: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
                totalBotLinked: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
                totalQrLinked: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
            },
            { tableName: "bot_stats", timestamps: true }
        );
        dbReady = true;
    } catch (e) {
        console.error("⚠️ BotStats model failed:", e.message);
        dbReady = false;
    }
}

async function ensureSynced() {
    if (!dbReady || !BotStats) return false;
    if (!synced) {
        try {
            await BotStats.sync();
            synced = true;
        } catch (e) {
            console.error("⚠️ BotStats.sync failed:", e.message);
            dbReady = false;
            return false;
        }
    }
    return true;
}

function readFileStats() {
    try {
        if (fs.existsSync(FILE)) {
            const d = JSON.parse(fs.readFileSync(FILE, "utf8"));
            return {
                totalUsers: d.totalUsers || 0,
                totalBotLinked: d.totalBotLinked || 0,
                totalQrLinked: d.totalQrLinked || 0,
            };
        }
    } catch (_) {}
    return { totalUsers: 0, totalBotLinked: 0, totalQrLinked: 0 };
}

function writeFileStats(stats) {
    try {
        fs.writeFileSync(FILE, JSON.stringify({ ...stats, lastUpdated: new Date().toISOString() }, null, 2));
    } catch (_) {}
}

async function loadStats() {
    if (await ensureSynced()) {
        try {
            const row = await BotStats.findByPk(1);
            if (row) {
                return {
                    totalUsers: row.totalUsers,
                    totalBotLinked: row.totalBotLinked,
                    totalQrLinked: row.totalQrLinked,
                };
            }
            await BotStats.create({ id: 1, totalUsers: 0, totalBotLinked: 0, totalQrLinked: 0 });
            return { totalUsers: 0, totalBotLinked: 0, totalQrLinked: 0 };
        } catch (e) {
            console.error("loadStats DB error:", e.message);
        }
    }
    return readFileStats();
}

async function saveStats({ totalUsers, totalBotLinked, totalQrLinked }) {
    if (await ensureSynced()) {
        try {
            await BotStats.upsert({ id: 1, totalUsers, totalBotLinked, totalQrLinked });
            return;
        } catch (e) {
            console.error("saveStats DB error:", e.message);
        }
    }
    writeFileStats({ totalUsers, totalBotLinked, totalQrLinked });
}

async function resetStats() {
    if (await ensureSynced()) {
        try {
            await BotStats.upsert({ id: 1, totalUsers: 0, totalBotLinked: 0, totalQrLinked: 0 });
            return;
        } catch (_) {}
    }
    writeFileStats({ totalUsers: 0, totalBotLinked: 0, totalQrLinked: 0 });
}

module.exports = { loadStats, saveStats, resetStats };
