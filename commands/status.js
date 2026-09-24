const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../data/status.json');

// config shape: { seen: bool, like: bool, download: bool }
function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return defaultConfig();
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH));
        return { ...defaultConfig(), ...cfg };
    } catch { return defaultConfig(); }
}

function defaultConfig() {
    // Matches the bot's previous always-on env-var defaults
    // (AUTO_STATUS_SEEN / AUTO_STATUS_REACT were both "true" by default).
    return { seen: true, like: true, download: true };
}

function saveConfig(config) {
    try {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) { console.error('Status save error:', e); }
}

// ── Exported helpers used by server.js ──────────────────────────────────
function isSeenEnabled() { return loadConfig().seen === true; }
function isLikeEnabled() { return loadConfig().like === true; }
function isDownloadEnabled() { return loadConfig().download === true; }

// Setters — used by the admin panel's /api/admin/config endpoint so both
// the .status chat command and the web UI read/write the same source of
// truth instead of drifting out of sync.
function setSeenEnabled(val) { const c = loadConfig(); c.seen = !!val; saveConfig(c); }
function setLikeEnabled(val) { const c = loadConfig(); c.like = !!val; saveConfig(c); }
function setDownloadEnabled(val) { const c = loadConfig(); c.download = !!val; saveConfig(c); }

module.exports = {
    pattern: "status",
    desc: "Manage auto-status settings (seen, like, download)",
    react: "📊",
    category: "user",
    use: ".status [on/off/seen/like/download]",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, isOwner, reply }) => {

        await conn.sendMessage(from, { react: { text: '📊', key: mek.key } });

        const action = args[0]?.toLowerCase();
        const config = loadConfig();

        const box = (title, lines) =>
            `*●⏤꯭📊 ${title}𓂃ꜛ⸙*\n\n` +
            lines.map(l => `*├⬗* ${l}`).join('\n') + `\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        if (!action) {
            return reply(box('STATUS SETTINGS', [
                `Auto Seen: ${config.seen ? '✅' : '❌'}`,
                `Auto Like: ${config.like ? '✅' : '❌'}`,
                `Auto Download: ${config.download ? '✅' : '❌'}`,
                '',
                'Commands:',
                '.status on — Enable All',
                '.status off — Disable All',
                '.status seen on/off',
                '.status like on/off',
                '.status download on/off'
            ]));
        }

        const val = args[1]?.toLowerCase();

        if (action === 'on') {
            config.seen = true; config.like = true; config.download = true;
            saveConfig(config);
            return reply(box('STATUS SETTINGS', [
                '✅ *ALL STATUS FEATURES: ON*',
                '◇ Auto Seen: ✅',
                '◇ Auto Like: ✅',
                '◇ Auto Download: ✅'
            ]));
        }

        if (action === 'off') {
            config.seen = false; config.like = false; config.download = false;
            saveConfig(config);
            return reply(box('STATUS SETTINGS', [
                '❌ *ALL STATUS FEATURES: OFF*'
            ]));
        }

        if (action === 'seen') {
            if (val !== 'on' && val !== 'off') return reply(box('STATUS SETTINGS', ['❌ Usage: `.status seen on` or `.status seen off`']));
            config.seen = val === 'on';
            saveConfig(config);
            return reply(box('STATUS SETTINGS', [config.seen ? '✅ *Auto Seen: ON*' : '❌ *Auto Seen: OFF*']));
        }

        if (action === 'like') {
            if (val !== 'on' && val !== 'off') return reply(box('STATUS SETTINGS', ['❌ Usage: `.status like on` or `.status like off`']));
            config.like = val === 'on';
            saveConfig(config);
            return reply(box('STATUS SETTINGS', [config.like ? '✅ *Auto Like: ON*' : '❌ *Auto Like: OFF*']));
        }

        if (action === 'download') {
            if (val !== 'on' && val !== 'off') return reply(box('STATUS SETTINGS', ['❌ Usage: `.status download on` or `.status download off`']));
            config.download = val === 'on';
            saveConfig(config);
            return reply(box('STATUS SETTINGS', [config.download ? '✅ *Auto Download: ON*' : '❌ *Auto Download: OFF*']));
        }

        return reply(box('STATUS SETTINGS', [
            '❌ *Invalid option.* Use `.status` to see all options.'
        ]));
    },

    isSeenEnabled,
    isLikeEnabled,
    isDownloadEnabled,
    setSeenEnabled,
    setLikeEnabled,
    setDownloadEnabled,
};
