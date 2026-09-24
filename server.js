const express = require("express");
const http = require("http");
require("dotenv").config();
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");
const { useMultiFileAuthState, makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Browsers, downloadContentFromMessage, jidNormalizedUser } = require("@whiskeysockets/baileys");
const { useDBAuthState, dbSessionExists, listDBSessions, deleteDBSession, clearAllDBSessions } = require("./lib/dbAuthState");
const dbStats = require("./lib/dbStats");
const cachedDbStore = require("./lib/cachedDbStore");
const groupMetaCache = require("./lib/groupMetadataCache");

// Set DEBUG_LOGS=true in the environment to bring back verbose per-message
// console logging (useful while developing). Off by default because
// console.log is synchronous I/O — printing 2-3 lines for every single
// message adds up fast on a busy bot and was slowing everything down.
const DEBUG_LOGS = process.env.DEBUG_LOGS === 'true';
const P = require("pino");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = process.env.PORT || 3000;

let GroupEvents;
try {
    GroupEvents = require("./events/GroupEvents");
} catch (e) {
    console.error("⚠️ GroupEvents not found, using stub:", e.message);
    GroupEvents = async () => {};
}
const runtimeTracker = require('./commands/runtime');
const { isAntiDeleteEnabled, getAntiDeleteOwner, getAntiDeleteMode } = require('./commands/antidelete');
const { isSeenEnabled, isLikeEnabled, isDownloadEnabled, setSeenEnabled, setLikeEnabled, setDownloadEnabled } = require('./commands/status');
const { isAiEnabled, askAI } = require('./commands/ai');
const { isAntiCallEnabled, isWarningEnabled, getWarningText, recordBlockedCall } = require('./commands/anticall');
const { getAntilinkMode, processAntilinkMessage, LINK_REGEX } = require('./commands/antilink');
const { getAntistatusMode, processAntistatusMessage } = require('./commands/antistatus');
const { handleAutoReact } = require('./commands/autoreacts');
const { handleAutoChreactPost, addChannelByLink, removeChannelByIdentifier, listChannelsForAdmin, setAutoChreactEnabled } = require('./commands/autochreact');
const { getMode, setMode, VALID_MODES } = require('./lib/botMode');
const connRegistry = require('./lib/connectionRegistry');
const banStore = require('./lib/banStore');
const commandRequests = require('./lib/commandRequests');
const disabledCommands = require('./lib/disabledCommands');
const activityTracker = require('./lib/activityTracker');
const { getBannerBuffer } = require('./lib/bannerCache');

// ── Owner-number matching: strips "+", spaces, dashes and leading 00 so
// that OWNER_NUMBER env values like "+92 300 1234567" or "0092300..."
// still match the plain-digit JID format WhatsApp sends us. ──────────────
function normalizeOwnerNum(num) {
    if (!num) return null;
    let n = String(num).replace(/[^\d]/g, ''); // keep digits only
    if (n.startsWith('00')) n = n.slice(2); // 0092... -> 92...
    return n;
}

// ── AntiDelete: in-memory message cache (last 500 msgs) ──────────────
const msgCache = new Map();
const MAX_CACHE = 500;

// ── AntiDelete: resolve a "@lid" JID to the real phone-number JID ──────────
// Baileys can report senders/participants using an opaque "@lid" identifier
// with no real number attached to the message. Try the most reliable
// sources in order; fall back to the original id if none work.
async function adResolveRealJid(conn, jid, groupJid) {
    if (!jid) return jid;
    if (!jid.endsWith('@lid')) return jidNormalizedUser(jid);
    const lidUser = jid.split('@')[0].split(':')[0];

    try {
        const pn = await conn?.signalRepository?.lidMapping?.getPNForLID?.(lidUser);
        if (pn) return jidNormalizedUser(pn.includes('@') ? pn : `${pn}@s.whatsapp.net`);
    } catch (e) {
        console.error('AntiDelete: lidMapping.getPNForLID failed:', e.message);
    }

    if (groupJid) {
        try {
            const meta = await groupMetaCache.getGroupMetadata(conn, groupJid);
            const p = meta.participants.find(pp => jidNormalizedUser(pp.id) === jidNormalizedUser(jid));
            const realNum = p?.phoneNumber || p?.pn || (p?.jid && p.jid !== p.id ? p.jid : null);
            if (realNum) return jidNormalizedUser(realNum.includes('@') ? realNum : `${realNum}@s.whatsapp.net`);
        } catch (e) {
            console.error('AntiDelete: group participant lookup failed:', e.message);
        }
    }

    try {
        const [result] = await conn.onWhatsApp(jid);
        if (result?.jid && result.jid !== jid) return jidNormalizedUser(result.jid);
    } catch (e) {
        console.error('AntiDelete: onWhatsApp lookup failed:', e.message);
    }

    return jid; // couldn't resolve — return as-is
}

// ── AntiDelete: build "Deleted by" name + "Location" labels ────────────────
async function buildAntiDeleteInfo(conn, sender, from, cachedMsg) {
    const groupJid = from.endsWith('@g.us') ? from : null;
    const realJid = await adResolveRealJid(conn, sender, groupJid);
    const realNumber = realJid.split('@')[0].split(':')[0];

    const savedName =
        conn.contacts?.[realJid]?.name ||
        conn.contacts?.[realJid]?.notify ||
        cachedMsg?.pushName ||
        null;

    const deleterLabel = savedName || `+${realNumber}`;

    let locationLabel;
    if (groupJid) {
        try {
            const meta = await groupMetaCache.getGroupMetadata(conn, groupJid);
            locationLabel = meta?.subject || 'Group';
        } catch (e) {
            locationLabel = 'Group';
        }
    } else {
        locationLabel = `+${realNumber}`;
    }

    return { deleterLabel, locationLabel };
}

// ── AntiDelete: shared handler — given a deleted message's key, look it
// up in the cache and forward its content to the owner's DM. Called both
// from the "messages.delete" event AND from protocolMessage REVOKE
// detection inside "messages.upsert" (WhatsApp sends "Delete for everyone"
// as a protocolMessage, not a messages.delete event, in most cases).
async function processDeletedMessage(conn, key) {
    try {
        if (!key || !key.id) return;
        const cached = msgCache.get(key.id);
        if (!cached) return;

        const { from, sender, message: cachedMsg } = cached;

        if (!isAntiDeleteEnabled(from)) return;

        const mode = getAntiDeleteMode(from); // "on" | "dm"

        let destJid;

        if (mode === "dm") {
            // ── DM mode: resend the deleted message to the owner's inbox,
            // same simple style as "on" mode ──
            const rawOwnerJid = getAntiDeleteOwner(from);
            if (!rawOwnerJid) return;

            // Fix: strip device suffix (:10) so DM sends correctly
            const ownerBase = rawOwnerJid.split(':')[0].split('@')[0];
            destJid = `${ownerBase}@s.whatsapp.net`;

        } else if (mode === "on") {
            // ── ON mode: resend the deleted message right back into the same
            // chat it was deleted from (group stays in group, DM stays in DM).
            destJid = from;
        } else {
            return; // off / unknown mode
        }

        const inner = cachedMsg.message;
        if (!inner) return;

        const msgType = Object.keys(inner)[0];

        // Helper: download media using downloadContentFromMessage
        const dlMedia = async (msgObj, mediaType) => {
            const stream = await downloadContentFromMessage(msgObj, mediaType);
            let buf = Buffer.from([]);
            for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
            return buf;
        };

        const { deleterLabel, locationLabel } = await buildAntiDeleteInfo(conn, sender, from, cachedMsg);
        const tag = `🗑️ *Deleted Message*\n👤 *By:* ${deleterLabel}\n📍 *Location:* ${locationLabel}`;

        if (msgType === "conversation" || msgType === "extendedTextMessage") {
            const text = inner.conversation || inner.extendedTextMessage?.text || "";
            await conn.sendMessage(destJid, { text: `${tag}\n\n${text}` });

        } else if (msgType === "imageMessage") {
            try {
                const buf = await dlMedia(inner.imageMessage, "image");
                await conn.sendMessage(destJid, {
                    image: buf,
                    caption: `${tag}` + (inner.imageMessage.caption ? `\n\n${inner.imageMessage.caption}` : "")
                });
            } catch (e) {
                console.error("AntiDelete image download failed:", e.message);
                await conn.sendMessage(destJid, { text: `${tag}\n\n📷 [Image — could not download]` });
            }

        } else if (msgType === "videoMessage") {
            try {
                const buf = await dlMedia(inner.videoMessage, "video");
                await conn.sendMessage(destJid, {
                    video: buf,
                    caption: `${tag}` + (inner.videoMessage.caption ? `\n\n${inner.videoMessage.caption}` : "")
                });
            } catch (e) {
                console.error("AntiDelete video download failed:", e.message);
                await conn.sendMessage(destJid, { text: `${tag}\n\n🎥 [Video — could not download]` });
            }

        } else if (msgType === "audioMessage") {
            // WhatsApp audio messages can't carry a caption, so send the
            // info as a follow-up text message right after the audio.
            try {
                const buf = await dlMedia(inner.audioMessage, "audio");
                await conn.sendMessage(destJid, {
                    audio: buf,
                    mimetype: inner.audioMessage.mimetype || "audio/mp4",
                    ptt: inner.audioMessage.ptt || false
                });
                await conn.sendMessage(destJid, { text: tag });
            } catch (e) {
                console.error("AntiDelete audio download failed:", e.message);
                await conn.sendMessage(destJid, { text: `${tag}\n\n🎵 [Audio — could not download]` });
            }

        } else if (msgType === "stickerMessage") {
            // Stickers can't carry a caption either, so the info follows
            // as a separate message right below the sticker.
            try {
                const buf = await dlMedia(inner.stickerMessage, "sticker");
                await conn.sendMessage(destJid, { sticker: buf });
                await conn.sendMessage(destJid, { text: tag });
            } catch (e) {
                console.error("AntiDelete sticker download failed:", e.message);
                await conn.sendMessage(destJid, { text: `${tag}\n\n🎭 [Sticker — could not download]` });
            }

        } else if (msgType === "documentMessage") {
            try {
                const buf = await dlMedia(inner.documentMessage, "document");
                await conn.sendMessage(destJid, {
                    document: buf,
                    fileName: inner.documentMessage.fileName || "file",
                    mimetype: inner.documentMessage.mimetype || "application/octet-stream",
                    caption: tag
                });
            } catch (e) {
                console.error("AntiDelete document download failed:", e.message);
                await conn.sendMessage(destJid, { text: `${tag}\n\n📄 [Document — could not download]` });
            }

        } else {
            await conn.sendMessage(destJid, {
                text: `${tag}\n\n📦 [${msgType.replace("Message", "")} message deleted]`
            });
        }

        console.log(`🛡️ AntiDelete: msg ${key.id} from ${from} (mode=${mode}) → sent to ${destJid}`);
    } catch (e) {
        console.error("AntiDelete error:", e);
    }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Store active connections
const activeConnections = new Map();
const pairingCodes = new Map();
const userPrefixes = new Map();

// Store status media for forwarding
const statusMediaStore = new Map();

let activeSockets = 0;
let totalUsers = 0;
let totalBotLinked = 0; // cumulative count of every successful connection (never decreases, counts repeats)
let totalQrLinked = 0; // cumulative count of successful connections that paired via QR code

// Persistent data file path (kept only as a legacy fallback; the source of
// truth is now the DB — see lib/dbStats.js)
const DATA_FILE = path.join(__dirname, 'persistent-data.json');

// Load persistent data (now from Postgres, so it survives Heroku
// dyno restarts / redeploys instead of resetting to 0)
async function loadPersistentData() {
    try {
        const stats = await dbStats.loadStats();
        totalUsers = stats.totalUsers || 0;
        totalBotLinked = stats.totalBotLinked || 0;
        totalQrLinked = stats.totalQrLinked || 0;
        console.log(`📊 Loaded persistent data from DB: ${totalUsers} total users, ${totalBotLinked} total bot links, ${totalQrLinked} total QR links`);
    } catch (error) {
        console.error("❌ Error loading persistent data from DB:", error);
    }
}

// Save persistent data (fire-and-forget write to DB)
function savePersistentData() {
    return dbStats.saveStats({ totalUsers, totalBotLinked, totalQrLinked })
        .then(() => {
            console.log(`💾 Saved persistent data to DB: ${totalUsers} total users, ${totalBotLinked} total bot links, ${totalQrLinked} total QR links`);
        })
        .catch((error) => {
            console.error("❌ Error saving persistent data to DB:", error);
        });
}

// ── Real "Total Number Linked" tracking (DB-backed, works for BOTH phone-code
// AND QR pairing) ─────────────────────────────────────────────────────────────
// totalUsers should count every distinct real WhatsApp number that has ever
// linked — regardless of whether they paired with a phone code (where the
// number is known up-front) or a QR scan (where the number is only known
// after the scan completes, since QR sessions use a random sessionId).
// This set is the single source of truth for "have we counted this number
// before", persisted in Postgres so it survives restarts.
const KNOWN_NUMBERS_KEY = 'known-linked-numbers';
let knownLinkedNumbers = new Set();
const knownLinkedNumbersReady = cachedDbStore.preload(KNOWN_NUMBERS_KEY, () => []).then((arr) => {
    knownLinkedNumbers = new Set(Array.isArray(arr) ? arr : []);
});

// Registers a real WhatsApp number as linked. If it's genuinely new,
// increments + persists totalUsers (awaited, so the real count is
// guaranteed saved to DB) and returns true. Returns false if already known.
async function registerLinkedNumber(rawNumber) {
    const number = String(rawNumber || '').replace(/[^0-9]/g, ''); // digits only
    if (!number) return false;
    if (knownLinkedNumbers.has(number)) return false;

    knownLinkedNumbers.add(number);
    cachedDbStore.setCached(KNOWN_NUMBERS_KEY, Array.from(knownLinkedNumbers));

    totalUsers++;
    console.log(`👤 New number linked (real count)! Total users: ${totalUsers}`);
    await savePersistentData();
    return true;
}

// NOTE: loadPersistentData() is now awaited inside server.listen() below,
// since DB access is asynchronous (it used to run synchronously here).

// ── Per-User Command Usage Tracking (DB-backed, real-time) ────────────────────
// Was a local user-cmd-stats.json file (wiped on every Heroku dyno
// restart/redeploy). Now stored in Postgres via cachedDbStore so every real
// command run is persisted, and survives restarts like everything else.
const USER_CMD_STATS_KEY = 'user-cmd-stats';
let userCmdStats = {}; // { [sessionId]: { total, lastUsed, commands: { [cmdName]: count } } }
const userCmdStatsReady = cachedDbStore.preload(USER_CMD_STATS_KEY, () => ({})).then((v) => { userCmdStats = v; });

// ── Real Command-Use Counter (per-day, used for admin dashboard) ─────────────
// Was a local cmd-usage-daily.json file. Now Postgres-backed for the same
// reason — the "Cmd Use Today / This Week" cards need real counts that
// survive restarts, not counters that reset to 0 on every redeploy.
const CMD_DAILY_KEY = 'cmd-usage-daily';
let cmdDailyUsage = { daily: {} }; // { daily: { "YYYY-MM-DD": count } }
const cmdDailyUsageReady = cachedDbStore.preload(CMD_DAILY_KEY, () => ({ daily: {} })).then((v) => {
    cmdDailyUsage = v;
    if (!cmdDailyUsage.daily) cmdDailyUsage.daily = {};
});

// Returns { today, week } — real, actual counts of commands executed
// (every real command run, across every connected session/user).
function getCmdUsageTodayAndWeek() {
    const days = Object.keys(cmdDailyUsage.daily);
    const todayKey = new Date().toISOString().slice(0, 10);
    const today = cmdDailyUsage.daily[todayKey] || 0;

    let week = 0;
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        week += cmdDailyUsage.daily[key] || 0;
    }

    return { today, week };
}

// Every real command run bumps both counters and persists immediately
// (debounced ~250ms inside cachedDbStore) — real-time counting, no more
// waiting on a 30s interval or losing counts on an unclean restart.
function trackUserCommand(sessionId, commandName) {
    if (!sessionId || !commandName) return;
    if (!userCmdStats[sessionId]) userCmdStats[sessionId] = { total: 0, lastUsed: null, commands: {} };
    const entry = userCmdStats[sessionId];
    entry.commands[commandName] = (entry.commands[commandName] || 0) + 1;
    entry.total += 1;
    entry.lastUsed = new Date().toISOString();
    cachedDbStore.setCached(USER_CMD_STATS_KEY, userCmdStats);

    // Real, active command-use count for today (bumped on every real command run)
    const todayKey = new Date().toISOString().slice(0, 10);
    cmdDailyUsage.daily[todayKey] = (cmdDailyUsage.daily[todayKey] || 0) + 1;
    cachedDbStore.setCached(CMD_DAILY_KEY, cmdDailyUsage);
}

// Auto-save persistent data every 30 seconds (counters that don't get an
// immediate/real-time write elsewhere — userCmdStats/cmdDailyUsage now save
// themselves in real time via trackUserCommand() above).
setInterval(() => {
    savePersistentData();
}, 30000);

// Stats broadcasting helper
function broadcastStats() {
    io.emit("statsUpdate", { activeSockets, totalUsers, totalBotLinked, totalQrLinked });
}

// Track frontend connections (stats dashboard)
io.on("connection", (socket) => {
    console.log("📊 Frontend connected for stats");
    socket.emit("statsUpdate", { activeSockets, totalUsers, totalBotLinked, totalQrLinked });

    // A browser tab joins the room named after its own pairing sessionId
    // (once it has one) so that qrCode/qrLinked/linked/unlinked events for
    // THAT session can be sent only to this socket, instead of being
    // broadcast to every visitor on the pairing page.
    socket.on("joinSession", (sessionId) => {
        if (typeof sessionId === "string" && sessionId) {
            socket.join(sessionId);
        }
    });

    socket.on("disconnect", () => {
        console.log("📊 Frontend disconnected from stats");
    });
});

// Channel configuration
const CHANNEL_JIDS = process.env.CHANNEL_JIDS ? process.env.CHANNEL_JIDS.split(',') : [
    "120363409737585957@newsletter",
    "https://whatsapp.com/channel/0029VbDMne82kNFhp1gyAh2P",
];

// Default prefix for bot commands
let PREFIX = process.env.PREFIX || ".";

// Bot configuration from environment variables
let BOT_NAME = process.env.BOT_NAME || "ZAINU-MD 🔥⚜️";
let OWNER_NAME = process.env.OWNER_NAME || "ZAINU";

let MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "https://files.catbox.moe/j6rpyx.jpg";
const REPO_LINK = process.env.REPO_LINK || "https://github.com";

// Auto-status configuration
let AUTO_STATUS_SEEN = process.env.AUTO_STATUS_SEEN || "true";
let AUTO_STATUS_REACT = process.env.AUTO_STATUS_REACT || "true";
let AUTO_STATUS_REPLY = process.env.AUTO_STATUS_REPLY || "false";
const AUTO_STATUS_MSG = process.env.AUTO_STATUS_MSG || "YOUR STATUS HAS BEEN SEEN BY ZAINU-MD 🔥⚜️";
const DEV = process.env.DEV || 'ZAINU-MD 🔥⚜️';

// ── Admin-panel-editable bot config, persisted to disk ────────────────────
// Anything saved from the admin panel's Config tab overrides the env-var
// defaults above, and survives restarts.
const BOT_CONFIG_FILE = path.join(__dirname, 'bot-config.json');

function loadBotConfigOverrides() {
    try {
        if (!fs.existsSync(BOT_CONFIG_FILE)) return;
        const cfg = JSON.parse(fs.readFileSync(BOT_CONFIG_FILE, 'utf8'));
        if (cfg.botName) BOT_NAME = cfg.botName;
        if (cfg.ownerName) OWNER_NAME = cfg.ownerName;
        if (cfg.prefix) PREFIX = cfg.prefix;
        if (cfg.menuImageUrl) MENU_IMAGE_URL = cfg.menuImageUrl;
        if (typeof cfg.autoStatusSeen === 'string') AUTO_STATUS_SEEN = cfg.autoStatusSeen;
        if (typeof cfg.autoStatusReact === 'string') AUTO_STATUS_REACT = cfg.autoStatusReact;
        if (typeof cfg.autoStatusReply === 'string') AUTO_STATUS_REPLY = cfg.autoStatusReply;
    } catch (e) {
        console.error('❌ Error loading bot-config.json:', e.message);
    }
}

function saveBotConfigOverrides(partial) {
    let cfg = {};
    try {
        if (fs.existsSync(BOT_CONFIG_FILE)) cfg = JSON.parse(fs.readFileSync(BOT_CONFIG_FILE, 'utf8'));
    } catch {}
    cfg = { ...cfg, ...partial };
    try {
        fs.writeFileSync(BOT_CONFIG_FILE, JSON.stringify(cfg, null, 2));
    } catch (e) {
        console.error('❌ Error saving bot-config.json:', e.message);
    }
}

// Track login state globally
let isUserLoggedIn = false;

// Load commands from commands folder
const commands = new Map();
const commandsPath = path.join(__dirname, 'commands');

// Modified loadCommands function to handle multi-command files
function loadCommands() {
    commands.clear();
    
    if (!fs.existsSync(commandsPath)) {
        console.log("❌ Commands directory not found:", commandsPath);
        fs.mkdirSync(commandsPath, { recursive: true });
        console.log("✅ Created commands directory");
        return;
    }

    const commandFiles = fs.readdirSync(commandsPath).filter(file => 
        file.endsWith('.js') && !file.startsWith('.')
    );

    console.log(`📂 Loading commands from ${commandFiles.length} files...`);

    for (const file of commandFiles) {
        try {
            const filePath = path.join(commandsPath, file);
            // Clear cache to ensure fresh load
            if (require.cache[require.resolve(filePath)]) {
                delete require.cache[require.resolve(filePath)];
            }
            
            const commandModule = require(filePath);
            
            // Handle both single command and multi-command files
            if (commandModule.pattern && commandModule.execute) {
                // Single command file
                commands.set(commandModule.pattern, commandModule);
                console.log(`✅ Loaded command: ${commandModule.pattern}`);
                // Register aliases for single-command exports
                if (commandModule.alias && Array.isArray(commandModule.alias)) {
                    commandModule.alias.forEach(alias => {
                        commands.set(alias, commandModule);
                        console.log(`✅ Loaded alias: ${alias} -> ${commandModule.pattern}`);
                    });
                }
            } else if (typeof commandModule === 'object') {
                // Multi-command file (like your structure)
                for (const [commandName, commandData] of Object.entries(commandModule)) {
                    if (commandData.pattern && commandData.execute) {
                        commands.set(commandData.pattern, commandData);
                        console.log(`✅ Loaded command: ${commandData.pattern}`);
                        
                        // Also add aliases if they exist
                        if (commandData.alias && Array.isArray(commandData.alias)) {
                            commandData.alias.forEach(alias => {
                                commands.set(alias, commandData);
                                console.log(`✅ Loaded alias: ${alias} -> ${commandData.pattern}`);
                            });
                        }
                    }
                }
            } else {
                console.log(`⚠️ Skipping ${file}: invalid command structure`);
            }
        } catch (error) {
            console.error(`❌ Error loading commands from ${file}:`, error.message);
        }
    }

    // Add runtime command
    const runtimeCommand = runtimeTracker.getRuntimeCommand();
    if (runtimeCommand.pattern && runtimeCommand.execute) {
        commands.set(runtimeCommand.pattern, runtimeCommand);
    }
}

// Initial command load
loadCommands();

// Watch for changes in commands directory — auto-reload & push to both sites
if (fs.existsSync(commandsPath)) {
    // Track previous command set so we can detect add vs delete
    let _prevPatterns = new Set(
        Array.from(commands.values())
            .filter(c => c && c.pattern)
            .map(c => c.pattern)
    );

    fs.watch(commandsPath, { persistent: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.js')) return;

        const filePath  = path.join(commandsPath, filename);
        const fileExists = fs.existsSync(filePath);

        // Determine change type based on file existence
        // 'rename' event fires for both create and delete on Linux
        let changeType = 'update';
        if (eventType === 'rename') {
            changeType = fileExists ? 'add' : 'delete';
        }

        console.log(`🔄 Command file ${changeType}: ${filename}`);
        loadCommands();

        // Push updated commands list to ALL connected website clients
        setTimeout(() => {
            const seen = new Set();
            const updatedList = [];
            for (const cmd of commands.values()) {
                if (!cmd || !cmd.pattern || seen.has(cmd.pattern)) continue;
                seen.add(cmd.pattern);
                updatedList.push({
                    name:     cmd.pattern,
                    desc:     cmd.desc     || "",
                    category: cmd.category || "other",
                    use:      cmd.use      || ""
                });
            }
            updatedList.sort((a, b) => a.name.localeCompare(b.name));

            // Detect actual add/delete by comparing with previous patterns
            const currentPatterns = new Set(updatedList.map(c => c.name));
            const added   = [...currentPatterns].filter(p => !_prevPatterns.has(p));
            const removed = [..._prevPatterns].filter(p => !currentPatterns.has(p));
            _prevPatterns = currentPatterns;

            const finalChangeType = removed.length > 0 ? 'delete'
                                  : added.length   > 0 ? 'add'
                                  : 'update';
            const changedCmd = removed[0] || added[0] || filename.replace('.js', '');

            io.emit('commands-updated', {
                commands:   updatedList,
                total:      updatedList.length,
                changeType: finalChangeType,
                filename:   changedCmd
            });
            console.log(`📡 commands-updated → ${updatedList.length} cmds [${finalChangeType}: ${changedCmd}]`);
        }, 500);
    });
}

// Serve the main page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API endpoint to request pairing code
app.post("/api/pair", async (req, res) => {
    let conn;
    try {
        const { number } = req.body;
        
        if (!number) {
            return res.status(400).json({ error: "Phone number is required" });
        }

        // Normalize phone number
        const normalizedNumber = number.replace(/\D/g, "");

        // Put the requesting browser tab into a private room named after its
        // own sessionId, so qrCode/qrLinked/linked/unlinked events for THIS
        // session go only to this one visitor instead of every visitor on
        // the pairing page. Must happen before any connection events can
        // possibly fire.
        const clientSocketId = req.body.socketId;
        if (clientSocketId) {
            const clientSocket = io.sockets.sockets.get(clientSocketId);
            if (clientSocket) clientSocket.join(normalizedNumber);
        }

        // ── Ban enforcement: blocked numbers/IPs can't request a pairing code ──
        const requesterIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        if (banStore.isBanned('user', normalizedNumber)) {
            return res.status(403).json({ error: "This number has been banned from using the bot." });
        }
        if (requesterIp && banStore.isBanned('ip', requesterIp)) {
            return res.status(403).json({ error: "Your IP has been banned from using this service." });
        }
        
        // Initialize WhatsApp connection (auth state now lives in Postgres,
        // so it survives Heroku dyno restarts / redeploys)
        const { state, saveCreds } = await useDBAuthState(normalizedNumber);
        const { version } = await fetchLatestBaileysVersion();
        
        conn = makeWASocket({
            logger: P({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            version,
            browser: ["Ubuntu", "Chrome", "22.04.4"],
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            getMessage: async () => undefined,
        });

        // Check if this is a new user (first time connection) — kept for the
        // isNewUser flag returned in the response below.
        const isNewUser = !activeConnections.has(normalizedNumber) &&
                         !(await dbSessionExists(normalizedNumber));

        // Store the connection and saveCreds function
        activeConnections.set(normalizedNumber, { 
            conn, 
            saveCreds, 
            hasLinked: activeConnections.get(normalizedNumber)?.hasLinked || false 
        });
        connRegistry.register(normalizedNumber, conn);

        // NOTE: totalUsers is no longer counted here. It used to be counted
        // at pairing-code-request time, which fired BEFORE WhatsApp actually
        // finished connecting. Now all three counters (totalUsers,
        // totalBotLinked, totalQrLinked) are counted together, immediately,
        // inside the connection "open" handler below — so they all bump in
        // sync the instant WhatsApp really connects.
        if (isNewUser) {
            activeConnections.get(normalizedNumber).hasLinked = true;
        }
        
        broadcastStats();

        // Set up connection event handlers FIRST
        setupConnectionHandlers(conn, normalizedNumber, io, saveCreds, true);

        // Wait until socket is actually connecting/open before requesting code
        await new Promise((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            const t = setTimeout(finish, 8000);
            conn.ev.on("connection.update", (u) => {
                if (u.connection === "connecting" || u.connection === "open" || u.qr) {
                    clearTimeout(t);
                    finish();
                }
            });
        });

        // Small extra delay helps Baileys finish handshake
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Request pairing code with one retry on Connection Closed
        let pairingCode;
        try {
            pairingCode = await conn.requestPairingCode(normalizedNumber);
        } catch (e1) {
            console.error("Pair code attempt 1 failed:", e1.message);
            await new Promise(resolve => setTimeout(resolve, 3000));
            try {
                pairingCode = await conn.requestPairingCode(normalizedNumber);
            } catch (e2) {
                throw e2;
            }
        }

        if (!pairingCode) throw new Error("Empty pairing code from WhatsApp");

        // Format as XXXX-XXXX for easier entry
        const formatted = String(pairingCode).replace(/(.{4})/g, "$1-").replace(/-$/, "");
        
        pairingCodes.set(normalizedNumber, { code: pairingCode, timestamp: Date.now() });

        res.json({ 
            success: true, 
            pairingCode: formatted,
            rawCode: pairingCode,
            sessionId: normalizedNumber,
            message: "Pairing code generated successfully",
            isNewUser: isNewUser
        });

    } catch (error) {
        console.error("Error generating pairing code:", error);
        
        if (conn) {
            try { conn.end(undefined); } catch (e) {}
            try { conn.ws?.close(); } catch (e) {}
        }
        
        res.status(500).json({ 
            error: "Failed to generate pairing code. Wait 30 seconds and try again.",
            details: error.message 
        });
    }
});

// ── API endpoint to request QR-code pairing ─────────────────────────────
// Unlike /api/pair, this does NOT call requestPairingCode(). It instead lets
// Baileys emit a `qr` string on "connection.update", turns it into a PNG
// data-URL with the `qrcode` package, and pushes it to the browser over
// socket.io as a "qrCode" event. The QR auto-refreshes (Baileys re-issues a
// new one roughly every ~20s until scanned), so we just keep re-emitting.
app.post("/api/pair-qr", async (req, res) => {
    let conn;
    try {
        // A random session id since we don't have the phone number up-front
        // for QR pairing (WhatsApp reveals it only after the scan).
        const sessionId = "qr_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

        // Put the requesting browser tab into a private room named after
        // this sessionId, so the qrCode image / qrLinked / linked events
        // for THIS scan go only to this one visitor instead of every
        // visitor on the pairing page.
        const clientSocketId = req.body.socketId;
        if (clientSocketId) {
            const clientSocket = io.sockets.sockets.get(clientSocketId);
            if (clientSocket) clientSocket.join(sessionId);
        }

        const requesterIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        if (requesterIp && banStore.isBanned('ip', requesterIp)) {
            return res.status(403).json({ error: "Your IP has been banned from using this service." });
        }

        const { state, saveCreds } = await useDBAuthState(sessionId);
        const { version } = await fetchLatestBaileysVersion();

        conn = makeWASocket({
            logger: P({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            version,
            browser: Browsers.macOS("Safari"),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            maxIdleTimeMs: 60000,
            maxRetries: 10,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false,
            transactionOpts: {
                maxCommitRetries: 10,
                delayBetweenTriesMs: 3000
            }
        });

        activeConnections.set(sessionId, { conn, saveCreds, hasLinked: false });
        connRegistry.register(sessionId, conn);

        // Reuse the same "open"/reconnect handling as phone-number pairing
        setupConnectionHandlers(conn, sessionId, io, saveCreds, true);

        // Extra listener just for turning the raw `qr` string into an image
        conn.ev.on("connection.update", async (update) => {
            const { qr, connection } = update;
            if (qr) {
                try {
                    const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, scale: 6 });
                    io.to(sessionId).emit("qrCode", { sessionId, qrDataUrl });
                } catch (e) {
                    console.error("Failed to render QR code:", e);
                }
            }
            if (connection === "open") {
                io.to(sessionId).emit("qrLinked", { sessionId });
            }
        });

        res.json({ success: true, sessionId, message: "QR session started, watch for the qrCode socket event." });

    } catch (error) {
        console.error("Error starting QR pairing session:", error);
        if (conn) {
            try { conn.ws.close(); } catch (e) {}
        }
        res.status(500).json({ error: "Failed to start QR pairing session", details: error.message });
    }
});

// Enhanced channel subscription function
async function subscribeToChannels(conn) {
    const results = [];
    
    for (const rawEntry of CHANNEL_JIDS) {
        let channelJid = rawEntry.trim();

        // Support entries given as an invite code/link, e.g. "invite:0029VadBQndLY6dA8nGkpS09"
        // or a full https://whatsapp.com/channel/<code> link — resolve to the real @newsletter JID.
        if (!channelJid.endsWith('@newsletter')) {
            let inviteCode = channelJid;
            const linkMatch = channelJid.match(/whatsapp\.com\/channel\/([A-Za-z0-9]+)/i);
            if (linkMatch) inviteCode = linkMatch[1];
            else if (inviteCode.startsWith('invite:')) inviteCode = inviteCode.slice(7);

            try {
                const meta = await conn.newsletterMetadata('invite', inviteCode);
                if (meta && meta.id) {
                    channelJid = meta.id;
                    console.log(`🔗 Resolved invite ${inviteCode} -> ${channelJid}`);
                } else {
                    throw new Error('No JID returned for invite code');
                }
            } catch (resolveError) {
                console.error(`❌ Could not resolve channel invite "${rawEntry}":`, resolveError.message);
                results.push({ success: false, error: resolveError, channel: rawEntry });
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
        }

        try {
            console.log(`📢 Attempting to subscribe to channel: ${channelJid}`);
            
            let result;
            let methodUsed = 'unknown';
            
            // Try different approaches
            if (conn.newsletterFollow) {
                methodUsed = 'newsletterFollow';
                result = await conn.newsletterFollow(channelJid);
            } 
            else if (conn.followNewsletter) {
                methodUsed = 'followNewsletter';
                result = await conn.followNewsletter(channelJid);
            }
            else if (conn.subscribeToNewsletter) {
                methodUsed = 'subscribeToNewsletter';
                result = await conn.subscribeToNewsletter(channelJid);
            }
            else if (conn.newsletter && conn.newsletter.follow) {
                methodUsed = 'newsletter.follow';
                result = await conn.newsletter.follow(channelJid);
            }
            else {
                methodUsed = 'manual_presence_only';
                await conn.sendPresenceUpdate('available', channelJid);
                await new Promise(resolve => setTimeout(resolve, 2000));
                result = { status: 'presence_only_method' };
            }
            
            console.log(`✅ Successfully subscribed to channel using ${methodUsed}!`);
            results.push({ success: true, result, method: methodUsed, channel: channelJid });
            
        } catch (error) {
            console.error(`❌ Failed to subscribe to channel ${channelJid}:`, error.message);
            
            try {
                console.log(`🔄 Trying silent fallback subscription method for ${channelJid}...`);
                await conn.sendPresenceUpdate('available', channelJid);
                await new Promise(resolve => setTimeout(resolve, 3000));
                console.log(`✅ Used silent fallback subscription method for ${channelJid}!`);
                results.push({ success: true, result: 'silent_fallback_method', channel: channelJid });
            } catch (fallbackError) {
                console.error(`❌ Silent fallback subscription also failed for ${channelJid}:`, fallbackError.message);
                results.push({ success: false, error: fallbackError, channel: channelJid });
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return results;
}

// Function to get message type
function getMessageType(message) {
    if (message.message?.conversation) return 'TEXT';
    if (message.message?.extendedTextMessage) return 'TEXT';
    if (message.message?.imageMessage) return 'IMAGE';
    if (message.message?.videoMessage) return 'VIDEO';
    if (message.message?.audioMessage) return 'AUDIO';
    if (message.message?.documentMessage) return 'DOCUMENT';
    if (message.message?.stickerMessage) return 'STICKER';
    if (message.message?.contactMessage) return 'CONTACT';
    if (message.message?.locationMessage) return 'LOCATION';
    
    const messageKeys = Object.keys(message.message || {});
    for (const key of messageKeys) {
        if (key.endsWith('Message')) {
            return key.replace('Message', '').toUpperCase();
        }
    }
    
    return 'UNKNOWN';
}

// Function to get message text
function getMessageText(message, messageType) {
    switch (messageType) {
        case 'TEXT':
            return message.message?.conversation || 
                   message.message?.extendedTextMessage?.text || '';
        case 'IMAGE':
            return message.message?.imageMessage?.caption || '[Image]';
        case 'VIDEO':
            return message.message?.videoMessage?.caption || '[Video]';
        case 'AUDIO':
            return '[Audio]';
        case 'DOCUMENT':
            return message.message?.documentMessage?.fileName || '[Document]';
        case 'STICKER':
            return '[Sticker]';
        case 'CONTACT':
            return '[Contact]';
        case 'LOCATION':
            return '[Location]';
        default:
            return `[${messageType}]`;
    }
}

// Function to get quoted message details
function getQuotedMessage(message) {
    if (!message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        return null;
    }
    
    const quoted = message.message.extendedTextMessage.contextInfo;
    return {
        message: {
            key: {
                remoteJid: quoted.participant || quoted.stanzaId,
                fromMe: quoted.participant === (message.key.participant || message.key.remoteJid),
                id: quoted.stanzaId
            },
            message: quoted.quotedMessage,
            mtype: Object.keys(quoted.quotedMessage || {})[0]?.replace('Message', '') || 'text'
        },
        sender: quoted.participant
    };
}

// ── No-React Conn Wrapper ─────────────────────────────────────────────────
// Kisi bhi .command ke jawab me react (emoji reaction) nahi bhejna
// This wraps conn.sendMessage so that { react: ... } payloads are silently
// dropped while all other messages (text, image, etc.) go through normally.
function createNoReactConn(conn) {
    return new Proxy(conn, {
        get(target, prop) {
            if (prop === 'sendMessage') {
                return async function (jid, content, options) {
                    // Block any react payload — return early without sending
                    if (content && content.react) return null;
                    return target.sendMessage.call(target, jid, content, options);
                };
            }
            // All other properties (ev, user, ws, etc.) pass through unchanged
            return typeof target[prop] === 'function'
                ? target[prop].bind(target)
                : target[prop];
        }
    });
}

// Handle incoming messages and execute commands
async function handleMessage(conn, message, sessionId) {
    try {
        // ── Banned users: fully ignore anything from a banned session ──
        if (sessionId && banStore.isBanned('user', sessionId)) {
            return;
        }

        // Auto-status features
        if (message.key && message.key.remoteJid === 'status@broadcast') {
            if (isSeenEnabled()) {
                await conn.readMessages([message.key]).catch(console.error);
            }
            
            if (isLikeEnabled()) {
                // Get bot's JID directly from the connection object
                const botJid = conn.user.id;
                const emojis = ['❤️', '💸', '😇', '🍂', '💥', '💯', '🔥', '💫', '💎', '💗', '🤍', '🖤', '👀', '🙌', '🙆', '🚩', '🥰', '💐', '😎', '🤎', '✅', '🫀', '🧡', '😁', '😄', '🌸', '🕊️', '🌷', '⛅', '🌟', '🗿', '🇳🇬', '💜', '💙', '🌝', '🖤', '💚'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                await conn.sendMessage(message.key.remoteJid, {
                    react: {
                        text: randomEmoji,
                        key: message.key,
                    } 
                }, { statusJidList: [message.key.participant, botJid] }).catch(console.error);
                
                // Print status update in terminal with emoji
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] ✅ Auto-liked a status with ${randomEmoji} emoji`);
            }                       
            
            if (AUTO_STATUS_REPLY === "true") {
                const user = message.key.participant;
                const text = `${AUTO_STATUS_MSG}`;
                await conn.sendMessage(user, { text: text, react: { text: '💜', key: message.key } }, { quoted: message }).catch(console.error);
            }
            
            // Store status media for forwarding
            if (isDownloadEnabled() && message.message && (message.message.imageMessage || message.message.videoMessage)) {
                statusMediaStore.set(message.key.participant, {
                    message: message,
                    timestamp: Date.now()
                });
            }
            
            return;
        }

        if (!message.message) return;

        // ── Auto-React: fires for every incoming/outgoing chat message,
        // independent of whether it turns out to be a command. Scope
        // (all / dm / group / off) is controlled via .autoreacts. ──
        handleAutoReact(conn, message).catch(e =>
            console.error('autoreacts hook error:', e.message)
        );

        // Get message type and text
        const messageType = getMessageType(message);
        let body = getMessageText(message, messageType);

        // ── Anti-Link / Anti-Status enforcement: runs on every group message, not just commands ──
        const antilinkFrom = message.key.remoteJid;
        if (antilinkFrom && antilinkFrom.endsWith('@g.us') && !message.key.fromMe &&
            (getAntilinkMode(antilinkFrom) !== 'off' || getAntistatusMode(antilinkFrom) !== 'off')) {
            try {
                const antilinkSender = message.key.participant || message.key.remoteJid;
                let isSenderAdmin = false;
                try {
                    const gmeta = await groupMetaCache.getGroupMetadata(conn, antilinkFrom);
                    // Match against BOTH the raw participant JID and its "Alt"
                    // (real-number) form — WhatsApp often reports group senders
                    // using an opaque "@lid" id, and a plain string compare
                    // against gmeta's participant ids was failing to find a
                    // match, which silently made every sender look non-admin.
                    const rawSenderNorm = jidNormalizedUser(antilinkSender);
                    const altSenderNorm = message.key.participantAlt ? jidNormalizedUser(message.key.participantAlt) : null;
                    const senderCandidates = [rawSenderNorm, altSenderNorm].filter(Boolean);
                    const senderCandidateNums = senderCandidates.map(j => j.split('@')[0]);
                    const p = gmeta.participants.find(x => {
                        const pid = jidNormalizedUser(x.id);
                        return senderCandidates.includes(pid) || senderCandidateNums.includes(pid.split('@')[0]);
                    });
                    isSenderAdmin = p?.admin === 'admin' || p?.admin === 'superadmin';
                } catch (e) {
                    console.error('Antilink: failed to fetch group metadata:', e.message);
                }
                const antilinkBotBase = conn?.user?.id ? conn.user.id.split(':')[0].split('@')[0] : null;
                const antilinkOwnerJid = message.key.participantAlt || antilinkSender;
                const antilinkSenderBase = antilinkOwnerJid ? antilinkOwnerJid.split(':')[0].split('@')[0] : null;
                let antilinkOwnerNumbers = [];
                if (process.env.OWNER_NUMBER) {
                    antilinkOwnerNumbers = process.env.OWNER_NUMBER.split(',').map(num => normalizeOwnerNum(num.trim()));
                }
                const isSenderOwner = (antilinkBotBase && antilinkSenderBase && antilinkBotBase === antilinkSenderBase) || antilinkOwnerNumbers.includes(normalizeOwnerNum(antilinkSenderBase));

                if (DEBUG_LOGS) console.log(`🔗 Antilink check: mode=${getAntilinkMode(antilinkFrom)}, sender=${antilinkSenderBase}, isAdmin=${isSenderAdmin}, isOwner=${isSenderOwner}, hasLink=${LINK_REGEX.test(body)}`);

                const handled = await processAntilinkMessage(conn, message, {
                    from: antilinkFrom,
                    sender: antilinkSender,
                    body,
                    isSenderAdmin,
                    isSenderOwner,
                });
                if (handled) return;

                // ── Anti-Status enforcement: deletes the "X's status — this
                // group was mentioned" card that WhatsApp drops into the group ──
                if (getAntistatusMode(antilinkFrom) !== 'off') {
                    const statusHandled = await processAntistatusMessage(conn, message, {
                        from: antilinkFrom,
                        sender: antilinkSender,
                        isSenderAdmin,
                        isSenderOwner,
                    });
                    if (statusHandled) return;
                }
            } catch (e) {
                console.error('Antilink enforcement error:', e);
            }
        }

        // Get user-specific prefix or use default
        const userPrefix = userPrefixes.get(sessionId) || PREFIX;
        
        // Check if message starts with prefix
        if (!body.startsWith(userPrefix)) {
            // ── AI auto-reply: .ai on/off used to just print a success
            // message without ever actually enabling anything — there was
            // no code anywhere that auto-replied to messages. This is that
            // missing piece: for plain-text DMs (not commands, not groups,
            // not status broadcasts) while AI auto-reply is on, ask the AI
            // and send its answer back.
            try {
                const aiFrom = message.key.remoteJid;
                const isAiEligibleChat = aiFrom && !aiFrom.endsWith('@g.us') && aiFrom !== 'status@broadcast';
                if (isAiEligibleChat && !message.key.fromMe && body && body.trim() && isAiEnabled()) {
                    const answer = await askAI(body.trim());
                    await conn.sendMessage(aiFrom, { text: answer }, { quoted: message });
                }
            } catch (e) {
                console.error('AI auto-reply error:', e.message);
            }
            return;
        }

        // Parse command and arguments
        const args = body.slice(userPrefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        if (DEBUG_LOGS) console.log(`🔍 Detected command: ${commandName} from user: ${sessionId}`);

        // ── Global bot-mode gate (checked here too, BEFORE built-in commands) ──
        // handleBuiltInCommands (below) handles .ping/.speed/.prefix/.menu2
        // directly and used to run before the folder-command mode gate further
        // down in this function — so those 4 commands were bypassing
        // private/groups/dms/channel mode entirely. This block closes that gap.
        {
            const gateFrom = message.key.remoteJid;
            const gateIsGroup = gateFrom.endsWith('@g.us');
            const gateSenderJid = message.key.fromMe
                ? conn.user.id
                : (message.key.participantAlt || message.key.participant || message.key.remoteJid);
            const gateBotBase = conn?.user?.id ? conn.user.id.split(':')[0].split('@')[0] : null;
            const gateSenderBase = gateSenderJid ? gateSenderJid.split(':')[0].split('@')[0] : null;
            let gateOwnerNumbers = [];
            if (process.env.OWNER_NUMBER) {
                gateOwnerNumbers = process.env.OWNER_NUMBER.split(',').map(num => normalizeOwnerNum(num.trim()));
            }
            const gateIsOwner = message.key.fromMe || (gateBotBase && gateSenderBase && gateBotBase === gateSenderBase) || gateOwnerNumbers.includes(normalizeOwnerNum(gateSenderBase));

            const liveMode = getMode();
            const modeExempt = commandName === 'mode' || commandName === 'modedefault';
            const CHANNEL_MODE_COMMANDS = ['chf', 'chvote', 'jgroup', 'chreact'];

            if (!modeExempt && !gateIsOwner) {
                if (liveMode === 'private') {
                    console.log(`🔐 Blocked command "${commandName}" from ${gateSenderBase} — bot is in PRIVATE mode`);
                    return;
                }
                if (liveMode === 'groups' && !gateIsGroup) {
                    console.log(`👥 Blocked command "${commandName}" from ${gateSenderBase} — bot is in GROUPS-only mode`);
                    return;
                }
                if (liveMode === 'dms' && gateIsGroup) {
                    console.log(`💬 Blocked command "${commandName}" from ${gateSenderBase} — bot is in DMS-only mode`);
                    return;
                }
                if (liveMode === 'channel' && !CHANNEL_MODE_COMMANDS.includes(commandName)) {
                    console.log(`📢 Blocked command "${commandName}" from ${gateSenderBase} — bot is in CHANNEL-only mode`);
                    return;
                }
            }
        }

        // Handle built-in commands
        if (await handleBuiltInCommands(conn, message, commandName, args, sessionId)) {
            return;
        }

        // Find and execute command from commands folder
        if (commands.has(commandName)) {
            // Owner can disable individual commands from the admin panel
            if (disabledCommands.isDisabled(commandName)) {
                try {
                    await conn.sendMessage(message.key.remoteJid, {
                        text: `❌ The *.${commandName}* command has been disabled by the bot owner.`
                    }, { quoted: message });
                } catch {}
                return;
            }

            const command = commands.get(commandName);
            
            if (DEBUG_LOGS) console.log(`🔧 Executing command: ${commandName} for session: ${sessionId}`);
            trackUserCommand(sessionId, commandName);
            
            try {
                // Create a reply function for compatibility
                const reply = (text, options = {}) => {
                    return conn.sendMessage(message.key.remoteJid, { text }, { 
                        quoted: message, 
                        ...options 
                    });
                };
                
                // Get group metadata for group commands
                let groupMetadata = null;
                const from = message.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                
                if (isGroup) {
                    try {
                        groupMetadata = await groupMetaCache.getGroupMetadata(conn, from);
                    } catch (error) {
                        console.error("Error fetching group metadata:", error);
                    }
                }
                
                // Get quoted message if exists
                const quotedMessage = getQuotedMessage(message);
                
                // Prepare parameters in the format your commands expect
                const m = {
                    mentionedJid: message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [],
                    quoted: quotedMessage,
                    sender: message.key.participant || message.key.remoteJid
                };
                
                const q = body.slice(userPrefix.length + commandName.length).trim();
                
                // Check if user is admin/owner for admin commands
                let isAdmins = false;
                let isCreator = false;
                
                if (isGroup && groupMetadata) {
                    const rawSenderNorm = m.sender ? jidNormalizedUser(m.sender) : null;
                    const altSenderNorm = message.key.participantAlt ? jidNormalizedUser(message.key.participantAlt) : null;
                    const senderCandidates = [rawSenderNorm, altSenderNorm].filter(Boolean);
                    const senderCandidateNums = senderCandidates.map(j => j.split('@')[0]);

                    const participant = groupMetadata.participants.find(p => {
                        const pid = jidNormalizedUser(p.id);
                        return senderCandidates.includes(pid) || senderCandidateNums.includes(pid.split('@')[0]);
                    });
                    isAdmins = participant?.admin === 'admin' || participant?.admin === 'superadmin';
                    isCreator = participant?.admin === 'superadmin';
                }

                // ── Determine if sender is the bot owner (number the bot is paired with) ──
                // NOTE: WhatsApp now often reports group senders using a LID (an opaque id)
                // instead of their real phone number in `message.key.participant`. Baileys
                // exposes the real phone-number JID as `participantAlt` when this happens,
                // so we prefer that for the owner-number comparison below.
                const senderJid = message.key.fromMe
                    ? conn.user.id
                    : (message.key.participantAlt || message.key.participant || message.key.remoteJid);
                const botBase = conn?.user?.id ? conn.user.id.split(':')[0].split('@')[0] : null;
                const senderBase = senderJid ? senderJid.split(':')[0].split('@')[0] : null;
                let ownerNumbers = [];
                if (process.env.OWNER_NUMBER) {
                    ownerNumbers = process.env.OWNER_NUMBER.split(',').map(num => normalizeOwnerNum(num.trim()));
                }
                const isOwner = message.key.fromMe || (botBase && senderBase && botBase === senderBase) || ownerNumbers.includes(normalizeOwnerNum(senderBase));
                if (commandName === 'autochreact') {
                    console.log(`👑 Owner check for .autochreact: sender=${senderBase}, botBase=${botBase}, fromMe=${message.key.fromMe}, OWNER_NUMBER env=${process.env.OWNER_NUMBER || '(not set)'}, isOwner=${isOwner}`);
                }
                // isEnvOwner: true ONLY for numbers listed in OWNER_NUMBER env — these
                // bypass admin checks even without being a group admin. The bot's own
                // number (fromMe / botBase match) does NOT get this bypass; it still
                // needs to be a group admin for admin-only commands.
                const isEnvOwner = ownerNumbers.includes(normalizeOwnerNum(senderBase));

                // ── Global bot-mode gate ──
                // "mode" and "modedefault" are always allowed through so the owner can
                // change the mode even while the bot is restricted.
                const liveMode = getMode();
                const modeExempt = commandName === 'mode' || commandName === 'modedefault';
                const CHANNEL_MODE_COMMANDS = ['chf', 'chvote', 'jgroup', 'chreact'];

                if (!modeExempt && !isOwner) {
                    if (liveMode === 'private') {
                        console.log(`🔐 Blocked command "${commandName}" from ${senderBase} — bot is in PRIVATE mode`);
                        return;
                    }
                    if (liveMode === 'groups' && !isGroup) {
                        console.log(`👥 Blocked command "${commandName}" from ${senderBase} — bot is in GROUPS-only mode`);
                        return;
                    }
                    if (liveMode === 'dms' && isGroup) {
                        console.log(`💬 Blocked command "${commandName}" from ${senderBase} — bot is in DMS-only mode`);
                        return;
                    }
                    if (liveMode === 'channel' && !CHANNEL_MODE_COMMANDS.includes(commandName)) {
                        console.log(`📢 Blocked command "${commandName}" from ${senderBase} — bot is in CHANNEL-only mode`);
                        return;
                    }
                }
                
                // Execute command — reactions are blocked via noReactConn
                // so no emoji reaction is sent for any .command
                const noReactConn = createNoReactConn(conn);
                await command.execute(noReactConn, message, m, { 
                    args, 
                    q, 
                    reply, 
                    from: from,
                    isGroup: isGroup,
                    groupMetadata: groupMetadata,
                    sender: senderJid,
                    isAdmins: isAdmins,
                    isAdmin: isAdmins,
                    isCreator: isCreator,
                    isOwner: isOwner,
                    isEnvOwner: isEnvOwner
                });
            } catch (error) {
                console.error(`❌ Error executing command ${commandName}:`, error);
                if (getMode() !== 'silent') {
                    try {
                        await conn.sendMessage(message.key.remoteJid, {
                            text: `❌ Command "${commandName}" crashed: ${error?.message || 'unknown error'}`
                        }, { quoted: message });
                    } catch (e) {
                        console.error('Failed to notify chat of command crash:', e);
                    }
                }
            }
        } else {
            // Command not found - log only in terminal as requested
            console.log(`⚠️ Command not found: ${commandName}`);
        }
    } catch (error) {
        console.error("Error handling message:", error);
        // Don't send error to WhatsApp as requested
    }
}

// Handle built-in commands - FIXED VERSION
async function handleBuiltInCommands(conn, message, commandName, args, sessionId) {
    try {
        const userPrefix = userPrefixes.get(sessionId) || PREFIX;
        const from = message.key.remoteJid;
        
        // Handle newsletter/channel messages differently
        if (from.endsWith('@newsletter')) {
            console.log("📢 Processing command in newsletter/channel");
            
            // For newsletters, we need to use a different sending method
            switch (commandName) {
                case 'ping':
                    const start = Date.now();
                    const end = Date.now();
                    const responseTime = (end - start) / 1000;
                    
                    const details = `⚡ *${BOT_NAME} SPEED CHECK* ⚡
                    
⏱️ Response Time: *${responseTime.toFixed(2)}s* ⚡
👤 Owner: *${OWNER_NAME}*`;

                    // Try to send to newsletter using proper method
                    try {
                        if (conn.newsletterSend) {
                            await conn.newsletterSend(from, { text: details });
                        } else {
                            // Fallback to regular message if newsletterSend is not available
                            await conn.sendMessage(from, { text: details });
                        }
                    } catch (error) {
                        console.error("Error sending to newsletter:", error);
                    }
                    return true;
                    
                case 'menu2':
                    // Send menu to newsletter
                    try {
                        const menu = generateMenu(userPrefix, sessionId);
                        if (conn.newsletterSend) {
                            await conn.newsletterSend(from, { text: menu });
                        } else {
                            await conn.sendMessage(from, { text: menu });
                        }
                    } catch (error) {
                        console.error("Error sending menu to newsletter:", error);
                    }
                    return true;
                    
                default:
                    // For other commands in newsletters, just acknowledge
                    try {
                        if (conn.newsletterSend) {
                            await conn.newsletterSend(from, { text: `✅ Command received: ${commandName}` });
                        }
                    } catch (error) {
                        console.error("Error sending to newsletter:", error);
                    }
                    return true;
            }
        }
        
        // Regular chat/group message handling
        switch (commandName) {
            case 'ping':
            case 'speed': {
                // Real round-trip: from when WhatsApp says the command message
                // arrived, to right before we send the reply — this is what
                // "response speed" is actually meant to measure.
                const arrivedAt = message.messageTimestamp ? Number(message.messageTimestamp) * 1000 : Date.now();
                const responseTime = (Date.now() - arrivedAt) / 1000;
                const _pingUptime = runtimeTracker.getUptime();
                const _pingUptimeStr = `${_pingUptime.days}d ${_pingUptime.hours}h ${_pingUptime.minutes}m ${_pingUptime.seconds}s`;

                const details =
                    `*●⏤꯭🏓 PING𓂃ꜛ⸙*\n\n` +
                    `*├⬗ Response Speed:* ${responseTime.toFixed(2)}s\n` +
                    `*├⬗ Uptime:* ${_pingUptimeStr}\n` +
                    `*├⬗ Bot Name:* ${BOT_NAME}\n` +
                    `*├⬗ Owner:* ${OWNER_NAME}\n\n` +
                    `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

                // One single message (image cached in memory — no disk read,
                // no throwaway "checking speed..." message, no heavy fake
                // forwarded-newsletter wrapper) — keeps ping fast and consistent.
                const cachedBanner = getBannerBuffer();
                if (cachedBanner) {
                    await conn.sendMessage(from, {
                        image: cachedBanner,
                        caption: details,
                        mimetype: "image/jpeg"
                    }, { quoted: message });
                } else {
                    await conn.sendMessage(from, { text: details }, { quoted: message });
                }
                return true;
            }
                
            case 'prefix':
                // Check if user is the bot owner
                const ownerJid = conn.user.id;
                const messageSenderJid = message.key.participant || message.key.remoteJid;
                
                if (messageSenderJid !== ownerJid && !messageSenderJid.includes(ownerJid.split(':')[0])) {
                    await conn.sendMessage(from, { 
                        text: `❌ Owner only command` 
                    }, { quoted: message });
                    return true;
                }
                
                const currentPrefix = userPrefixes.get(sessionId) || PREFIX;
                await conn.sendMessage(from, { 
                    text: `📌 Current prefix: ${currentPrefix}` 
                }, { quoted: message });
                return true;
                
            case 'menu2':

                const menu = generateMenu(userPrefix, sessionId);
                // Send plain text menu (no image link)
                await conn.sendMessage(from, {
                    text: menu,
                    contextInfo: {
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: "120363403964756123@newsletter",
                            newsletterName: "𝐃ʀ 𝐇ᴏɴᴇʏ 𝐓ᴇᴄʜ𝐗 💀",
                            serverMessageId: 200
                        }
                    }
                }, { quoted: message });
                return true;
                
            default:
                return false;
        }
    } catch (error) {
        console.error("Error in built-in command:", error);
        return false;
    }
}

// Generate menu with all available commands
function generateMenu(userPrefix, sessionId) {
    // Get built-in commands
    const builtInCommands = [
        { name: 'ping', tags: ['utility'] },
        { name: 'prefix', tags: ['settings'] },
        { name: 'menu', tags: ['utility'] },
        { name: 'silver', tags: ['utility'] }
    ];
    
    // Get commands from commands folder
    const folderCommands = [];
    for (const [pattern, command] of commands.entries()) {
        folderCommands.push({
            name: pattern,
            tags: command.tags || ['general']
        });
    }
    
    // Combine all commands
    const allCommands = [...builtInCommands, ...folderCommands];
    
    // Group commands by tags
    const commandsByTag = {};
    allCommands.forEach(cmd => {
        cmd.tags.forEach(tag => {
            if (!commandsByTag[tag]) {
                commandsByTag[tag] = [];
            }
            commandsByTag[tag].push(cmd);
        });
    });
    
// Generate menu text with vertical style (no usage/links)
let menuText = `
🚀 ${BOT_NAME} 🚀

📌 Prefix : ${userPrefix}
👤 Owner  : ${OWNER_NAME}
🔧 Total  : ${allCommands.length} commands


📋 MENU LIST
───────────────────
`;

for (const [tag, cmds] of Object.entries(commandsByTag)) {
    menuText += `\n🔹 ${tag.toUpperCase()}:\n`;

    // Each command on a new line
    for (const cmd of cmds) {
        menuText += `   ➤ ${userPrefix}${cmd.name}\n`;
    }
}

return menuText;

}

// Setup connection event handlers - FIXED VERSION
function setupConnectionHandlers(conn, sessionId, io, saveCreds, isFreshLinkAttempt = false) {
    // Guards against double-counting if "open" somehow fires more than
    // once for the same underlying connection object.
    let botLinkAlreadyCounted = false;
    let hasShownConnectedMessage = false;
    let isLoggedOut = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5; // Set to 5 as requested
    
    // Handle connection updates
    conn.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (DEBUG_LOGS) console.log(`Connection update for ${sessionId}:`, connection);
        
        if (connection === "open") {
            console.log(`✅ WhatsApp connected for session: ${sessionId}`);
            console.log(`🟢 CONNECTED — ${BOT_NAME} is now active for ${sessionId}`);
            
            isUserLoggedIn = true;
            isLoggedOut = false;
            reconnectAttempts = 0;
            activeSockets++;
            // Only count this as a "link" when it's a genuinely fresh
            // pairing action started by a user right now — NOT when we're
            // just reconnecting after a network blip or restoring a saved
            // session after a Heroku dyno restart. Those happen constantly
            // and were previously inflating this counter (e.g. 1 real
            // linked number showing as "35 bots linked").
            if (isFreshLinkAttempt && !botLinkAlreadyCounted) {
                botLinkAlreadyCounted = true;
                totalBotLinked++; // a genuinely new successful link
                if (sessionId && sessionId.startsWith("qr_")) {
                    totalQrLinked++; // this connection was paired via QR code
                }

                // Register the real number for "Total Num Linked" RIGHT NOW,
                // in the same tick as the other two counters, so all 3
                // stats jump together the instant WhatsApp actually connects
                // — instead of totalUsers being counted early (at pair-code
                // request time) or late (after welcome-message setup).
                // Phone-code sessions: sessionId IS the real number already.
                // QR sessions: the real number is only known now, via
                // conn.user.id, once the scan has actually completed.
                let realNumberForCount = (sessionId && sessionId.startsWith("qr_"))
                    ? (conn.user?.id ? conn.user.id.split(':')[0].split('@')[0] : null)
                    : sessionId;
                if (realNumberForCount) {
                    registerLinkedNumber(realNumberForCount).then(() => broadcastStats());
                }
            }
            savePersistentData();
            broadcastStats();
            
            // Send connected event to frontend (only the browser tab that
            // started this session, not every visitor on the page)
            io.to(sessionId).emit("linked", { sessionId });
            
            if (!hasShownConnectedMessage) {
                hasShownConnectedMessage = true;
                
                setTimeout(async () => {
                    try {
                        const subscriptionResults = await subscribeToChannels(conn);

                        // ── Resolve the WhatsApp display name of the number the bot ──
                        // is deployed on. conn.user.name (pushname) sometimes isn't
                        // populated the instant "connection.update" fires, so we check
                        // a few possible sources and retry briefly before falling back.
                        const resolveOwnerName = () => {
                            try {
                                return (
                                    conn.user?.name ||
                                    conn.user?.verifiedName ||
                                    conn.user?.notify ||
                                    conn.authState?.creds?.me?.name ||
                                    null
                                );
                            } catch {
                                return null;
                            }
                        };

                        let name = resolveOwnerName();
                        for (let attempt = 0; !name && attempt < 5; attempt++) {
                            await new Promise(res => setTimeout(res, 1000));
                            name = resolveOwnerName();
                        }
                        if (!name) {
                            // Last-resort fallback: show the deployed phone number instead
                            // of the generic word "User".
                            name = conn.user?.id ? conn.user.id.split(':')[0].split('@')[0] : "User";
                        }

                        // (totalUsers/"Total Num Linked" for QR sessions is now
                        // registered immediately up in the "open" handler above,
                        // in sync with totalBotLinked/totalQrLinked — no longer
                        // done here, which used to add a several-second delay.)

                        const totalCommands = new Set(
                            Array.from(commands.values())
                                .filter(c => c && c.pattern)
                                .map(c => c.pattern)
                        ).size;

                        let up = `╔══════[ 𝐃𝐑-𝐇𝐎𝐍𝐄𝐘-𝐌𝐈𝐍𝐈 ]══════╗
  ◇ 👋 Most Welcome - ${name}
  ◇ ✅ Bot Connected Successful
  ◇ 🎉 Pairing Complete
  ◇ 📜 Total Command : ${totalCommands}
  ◇ 💡 Type ${PREFIX}menu for commands
╚════════════════════════╝

> ᴡʜᴀᴛꜱᴀᴩᴩ ᴍɪɴɪ ʙᴏᴛ | ᴅʀ ʜᴏɴᴇʏ ᴍɪɴɪ
> © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx`;

                        // Send welcome message with the real menu-banner image attached
                        // (no externalAdReply, so tapping the image just opens it — no link).
                        const userJid = `${conn.user.id.split(":")[0]}@s.whatsapp.net`;
                        let imagePayload;
                        try {
                            const cached = getBannerBuffer();
                            imagePayload = cached ? cached : { url: MENU_IMAGE_URL };
                        } catch (e) {
                            imagePayload = { url: MENU_IMAGE_URL };
                        }

                        await conn.sendMessage(userJid, {
                            image: imagePayload,
                            caption: up,
                            contextInfo: {
                                mentionedJid: [userJid],
                                forwardingScore: 999
                            }
                        });
                    } catch (error) {
                        console.error("Error in channel subscription or welcome message:", error);
                    }
                }, 3000);
            }
        }
        
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                console.log(`🔁 Connection closed, attempting to reconnect session: ${sessionId} (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                
                // Reset connected message flag to show again after reconnect
                hasShownConnectedMessage = false;
                
                // Try to reconnect after a delay
                setTimeout(() => {
                    if (activeConnections.has(sessionId)) {
                        const { conn: existingConn } = activeConnections.get(sessionId);
                        try {
                            existingConn.ws.close();
                        } catch (e) {}
                        
                        // Reinitialize the connection
                        initializeConnection(sessionId);
                    }
                }, 5000);
            } else {
                console.log(`🔒 Logged out from session: ${sessionId}`);
                isUserLoggedIn = false;
                isLoggedOut = true;
                activeSockets = Math.max(0, activeSockets - 1);
                broadcastStats();
                
                // ONLY delete session folder when user logs out (DisconnectReason.loggedOut)
                if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
                    setTimeout(() => {
                        cleanupSession(sessionId, true); // Delete entire folder ONLY on logout
                    }, 5000);
                }
                
                activeConnections.delete(sessionId);
                connRegistry.unregister(sessionId);
                io.to(sessionId).emit("unlinked", { sessionId });
            }
        }
    });

    // Handle incoming calls — reject automatically when anticall is enabled
    conn.ev.on("call", async (calls) => {
        try {
            if (!isAntiCallEnabled()) return;
            for (const call of calls) {
                if (call.status === "offer") {
                    console.log("📵 Anti-call: rejecting call from", call.from);
                    if (isWarningEnabled()) {
                        try {
                            await conn.sendMessage(call.from, { text: getWarningText() });
                        } catch (warnErr) {
                            console.error("Anti-call warning send error:", warnErr);
                        }
                    }
                    await conn.rejectCall(call.id, call.from);
                    recordBlockedCall(call.from);
                }
            }
        } catch (e) {
            console.error("Anti-call error:", e);
        }
    });

    // Handle group participant events (welcome/goodbye) — registered once here, not per-message
    conn.ev.on('group-participants.update', async (update) => {
        console.log("🔥 group-participants.update fired:", update);
        await GroupEvents(conn, update);
    });

    // Handle credentials updates
    conn.ev.on("creds.update", async () => {
        if (saveCreds) {
            await saveCreds();
        }
    });

    // ── Keep the group metadata cache honest: as soon as we hear a group
    // actually changed (promote/demote/join/leave, subject/desc edit),
    // drop the cached entry so the next read fetches fresh data instead of
    // waiting out the TTL. This is what lets .promote/.demote/.kick etc.
    // take effect immediately even though metadata is otherwise cached. ──
    conn.ev.on("group-participants.update", (update) => {
        if (update?.id) groupMetaCache.invalidate(update.id);
    });
    conn.ev.on("groups.update", (updates) => {
        for (const u of updates || []) {
            if (u?.id) groupMetaCache.invalidate(u.id);
        }
    });

    // Handle messages - FIXED: Added proper message handling for all message types
    conn.ev.on("messages.upsert", async (m) => {
        try {
            const message = m.messages[0];
            
            // FIXED: Allow bot to respond to its own messages (owner messages)
            // Get the bot's JID in proper format
            const botJid = conn.user.id;
            const normalizedBotJid = botJid.includes(':') ? botJid.split(':')[0] + '@s.whatsapp.net' : botJid;
            
            // Check if message is from the bot itself (owner)
            const isFromBot = message.key.fromMe || 
                              (message.key.participant && message.key.participant === normalizedBotJid) ||
                              (message.key.remoteJid && message.key.remoteJid === normalizedBotJid);
            
            // Don't process messages sent by the bot unless they're from the owner account
            if (message.key.fromMe && !isFromBot) return;
            
            if (DEBUG_LOGS) console.log(`📩 Received message from ${message.key.remoteJid}, fromMe: ${message.key.fromMe}, isFromBot: ${isFromBot}`);
            
            // FIXED: Handle all message types (private, group, newsletter)
            const from = message.key.remoteJid;
            
            // Check if it's a newsletter message
            if (from.endsWith('@newsletter')) {
                // ── Auto-Chreact: fire this FIRST and independently of
                // handleMessage below — if handleMessage throws (channel
                // posts aren't commands, so parsing them can error out),
                // that must not stop the react hook from running. ──
                const postId = message.newsletterServerId || message.key.id;
                console.log(`📢 Newsletter post received on ${from}, id: ${postId}`);
                handleAutoChreactPost(from, postId).catch(e =>
                    console.error('autochreact hook error:', e)
                );

                try {
                    await handleMessage(conn, message, sessionId);
                } catch (e) {
                    console.error('handleMessage error on newsletter message:', e);
                }
            } 
            // Check if it's a group message
            else if (from.endsWith('@g.us')) {
                // Track activity for kick-offline / inactivity features —
                // record this regardless of whether the message is a command.
                try {
                    const activeSender = message.key.participant || message.key.remoteJid;
                    if (activeSender) {
                        activityTracker.recordActivity(from, jidNormalizedUser(activeSender));
                    }
                } catch (e) {
                    console.error('activityTracker: failed to record activity:', e.message);
                }
                await handleMessage(conn, message, sessionId);
            }
            // Check if it's a private/DM message — anything that isn't a group or
            // newsletter chat. Older Baileys only matched '@s.whatsapp.net', but
            // WhatsApp now often delivers DMs from other people using a privacy
            // '@lid' JID instead of the real phone-number JID, so relying on the
            // '@s.whatsapp.net' suffix silently dropped those messages entirely —
            // that's why DMs from other numbers weren't getting any response in
            // ANY bot mode, even 'public'.
            else {
                await handleMessage(conn, message, sessionId);
            }
            
            // Verbose per-message debug printing — only runs when DEBUG_LOGS=true,
            // since computing message type/text and calling console.log on every
            // single message was adding needless overhead in production.
            if (DEBUG_LOGS && (!message.key.fromMe || isFromBot)) {
                const messageType = getMessageType(message);
                const messageText = getMessageText(message, messageType);
                const timestamp = new Date(message.messageTimestamp * 1000).toLocaleTimeString();
                const isGroup = from.endsWith('@g.us');
                const sender = message.key.fromMe ? conn.user.id : (message.key.participant || message.key.remoteJid);

                if (isGroup) {
                    console.log(`[${timestamp}] [GROUP: ${from}] ${sender}: ${messageText} (${messageType})`);
                } else {
                    console.log(`[${timestamp}] [PRIVATE] ${sender}: ${messageText} (${messageType})`);
                }
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    });

    // ── AntiDelete: cache incoming messages ───────────────────────────
    conn.ev.on("messages.upsert", async (m) => {
        try {
            for (const msg of m.messages) {
                if (!msg.message || msg.key.remoteJid === "status@broadcast") continue;

                // "Delete for everyone" arrives here as a protocolMessage of
                // type REVOKE (type 0), pointing at the original message's key —
                // it does NOT reliably trigger the "messages.delete" event.
                const proto = msg.message.protocolMessage;
                if (proto && proto.key && (proto.type === 0 || proto.type === "REVOKE")) {
                    await processDeletedMessage(conn, proto.key);
                    continue; // nothing else to cache for a protocolMessage itself
                }

                const id = msg.key.id;
                msgCache.set(id, {
                    from: msg.key.remoteJid,
                    sender: msg.key.participant || msg.key.remoteJid,
                    message: msg
                });
                // Trim cache
                if (msgCache.size > MAX_CACHE) {
                    const firstKey = msgCache.keys().next().value;
                    msgCache.delete(firstKey);
                }
            }
        } catch (e) {}
    });

    // ── AntiDelete: recover deleted messages → send to owner DM ──────────
    // Kept as a fallback path — most real-world "Delete for everyone" events
    // are actually caught above via protocolMessage REVOKE, since this
    // "messages.delete" event doesn't reliably fire for that action.
    conn.ev.on("messages.delete", async (item) => {
        try {
            const keys = item.keys || [];
            for (const key of keys) {
                await processDeletedMessage(conn, key);
            }
        } catch (e) {
            console.error("AntiDelete error:", e);
        }
    });

    // NOTE: Auto-view / auto-like of statuses is handled once, inside
    // handleMessage() above, gated by the .status command's saved settings
    // (isSeenEnabled / isLikeEnabled). There used to be two more
    // "messages.upsert" listeners registered here that duplicated this:
    // one unconditionally marked EVERY status as read regardless of the
    // .status seen setting, and the other reacted to statuses a second
    // time whenever auto-like was on (so every status got liked twice).
    // Both were removed — this is now the single source of truth.
}

// Function to reinitialize connection
async function initializeConnection(sessionId) {
    try {
        if (!(await dbSessionExists(sessionId))) {
            console.log(`No saved auth state found in DB for ${sessionId}`);
            return;
        }

        const { state, saveCreds } = await useDBAuthState(sessionId);
        const { version } = await fetchLatestBaileysVersion();
        
        const conn = makeWASocket({
            logger: P({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            version,
            browser: Browsers.macOS("Safari"),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            maxIdleTimeMs: 60000,
            maxRetries: 10,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false
        });

        activeConnections.set(sessionId, { conn, saveCreds });
        connRegistry.register(sessionId, conn);
        setupConnectionHandlers(conn, sessionId, io, saveCreds);
        
    } catch (error) {
        console.error(`Error reinitializing connection for ${sessionId}:`, error);
    }
}

// Clean up session (ONLY delete on logout)
function cleanupSession(sessionId, deleteEntireFolder = false) {
    if (deleteEntireFolder) {
        // ONLY delete if it's a logout (DisconnectReason.loggedOut)
        deleteDBSession(sessionId)
            .then(() => console.log(`🗑️ Deleted session from DB due to logout: ${sessionId}`))
            .catch((err) => console.error(`Failed to delete DB session ${sessionId}:`, err.message));
    } else {
        console.log(`📁 Session preservation: Keeping DB record for ${sessionId}`);
    }
}

// API endpoint to get loaded commands
app.get("/api/commands", (req, res) => {
    const seen = new Set();
    const commandList = [];

    for (const cmd of commands.values()) {
        if (!cmd || !cmd.pattern || seen.has(cmd.pattern)) continue;
        seen.add(cmd.pattern);
        commandList.push({
            name: cmd.pattern,
            desc: cmd.desc || "",
            category: cmd.category || "other",
            use: cmd.use || ""
        });
    }

    commandList.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ commands: commandList, total: commandList.length });
});

// ── Request a New Command (from the pairing site's Commands modal) ──────────
app.post("/api/command-requests", (req, res) => {
    const requesterIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

    if (banStore.isBanned('ip', requesterIp)) {
        return res.status(403).json({ ok: false, error: "You are not allowed to submit requests." });
    }

    if (commandRequests.isThrottled(requesterIp)) {
        return res.status(429).json({ ok: false, error: "Please wait a bit before submitting another request." });
    }

    const { name, description } = req.body || {};

    if (!name || !String(name).trim()) {
        return res.status(400).json({ ok: false, error: "Command name is required." });
    }
    if (!description || String(description).trim().length < 5) {
        return res.status(400).json({ ok: false, error: "Please describe what the command should do." });
    }

    const entry = commandRequests.addRequest({ name, description, ip: requesterIp });
    res.json({ ok: true, request: { id: entry.id, name: entry.name } });
});

loadBotConfigOverrides();

// Socket.io connection handling
io.on("connection", (socket) => {
    console.log("🔌 Client connected:", socket.id);
    
    socket.on("disconnect", () => {
        console.log("❌ Client disconnected:", socket.id);
    });
    
    socket.on("force-request-qr", () => {
        console.log("QR code regeneration requested");
    });
});

// (Old local-disk session-age logger removed — sessions now live in Postgres
// and are no longer tied to the container's ephemeral filesystem.)

// Function to reload existing sessions on server restart (now reads from
// Postgres instead of local disk, so it survives Heroku redeploys/restarts)
async function reloadExistingSessions() {
    console.log("🔄 Checking for existing sessions to reload...");

    let sessions = [];
    try {
        sessions = await listDBSessions();
    } catch (error) {
        console.error("❌ Failed to list sessions from DB:", error.message);
        return;
    }

    console.log(`📂 Found ${sessions.length} saved session(s) in DB`);

    for (const sessionId of sessions) {
        console.log(`🔄 Attempting to reload session: ${sessionId}`);
        try {
            await initializeConnection(sessionId);
            console.log(`✅ Successfully reloaded session: ${sessionId}`);

            // Count this as an active socket but don't increment totalUsers
            activeSockets++;
            console.log(`📊 Active sockets increased to: ${activeSockets}`);
        } catch (error) {
            console.error(`❌ Failed to reload session ${sessionId}:`, error.message);
        }
    }

    console.log("✅ Session reload process completed");
    broadcastStats(); // Update stats after reloading all sessions
}

// Start the server
server.listen(port, async () => {
    console.log(`🚀 ${BOT_NAME} server running on http://localhost:${port}`);
    console.log(`📱 WhatsApp bot initialized`);
    console.log(`🔧 Loaded ${commands.size} commands`);

    // Load counters (Total Num Linked / Total Bot Linked / Total QR Linked)
    // from Postgres before doing anything else that might touch them.
    await loadPersistentData();
    console.log(`📊 Starting with ${totalUsers} total users (persistent)`);

    // Make sure the DB-backed real-time counters (per-user command stats,
    // daily command-use counts, pairing-page usage graph, known linked
    // numbers) are loaded from Postgres before any request can touch them.
    await Promise.all([userCmdStatsReady, cmdDailyUsageReady, usageDataReady, knownLinkedNumbersReady]);
    console.log("📊 Loaded real-time usage/command counters from DB");

    // Reload existing sessions after server starts
    await reloadExistingSessions();
});

// Graceful shutdown
let isShuttingDown = false;

function gracefulShutdown() {
  if (isShuttingDown) {
    console.log("🛑 Shutdown already in progress...");
    return;
  }
  
  isShuttingDown = true;
  console.log("\n🛑 Shutting down Dr Honey Mini server...");
  
  // Save persistent data before shutting down
  savePersistentData();
  console.log(`💾 Saved persistent data: ${totalUsers} total users`);
  
  let connectionCount = 0;
  activeConnections.forEach((data, sessionId) => {
    try {
      data.conn.ws.close();
      console.log(`🔒 Closed WhatsApp connection for session: ${sessionId}`);
      connectionCount++;
    } catch (error) {}
  });
  
  console.log(`✅ Closed ${connectionCount} WhatsApp connections`);
  console.log(`📁 All session folders preserved for next server start`);
  
  const shutdownTimeout = setTimeout(() => {
    console.log("⚠️  Force shutdown after timeout");
    process.exit(0);
  }, 3000);
  
  server.close(() => {
    clearTimeout(shutdownTimeout);
    console.log("✅ Server shut down gracefully");
    console.log("📁 Session folders preserved - they will be reloaded on next server start");
    process.exit(0);
  });
}

// Handle termination signals
process.on("SIGINT", () => {
  console.log("\nReceived SIGINT signal");
  gracefulShutdown();
});

process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM signal");
  gracefulShutdown();
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error.message);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});