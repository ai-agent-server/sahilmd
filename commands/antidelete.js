const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../data/antidelete.json');

// config shape: { mode: "off" | "on" | "dm", owner: "<jid>" }
function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { mode: "off", owner: null };
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH));
        // migrate old { enabled: bool } configs
        if (typeof cfg.mode === "undefined") {
            return { mode: cfg.enabled ? "on" : "off", owner: cfg.owner || null };
        }
        return cfg;
    } catch { return { mode: "off", owner: null }; }
}

function saveConfig(config) {
    try {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) { console.error('Antidelete save error:', e); }
}

// ── Exported helpers used by server.js ──────────────────────────────────
function isAntiDeleteEnabled(from) {
    const config = loadConfig();
    if (config.mode === "off" || !config.owner) return false;
    if (config.mode === "on" || config.mode === "dm") return true; // monitors all chats (group + DM)
    return false;
}

function getAntiDeleteOwner(from) {
    const config = loadConfig();
    return config.owner || null;
}

function getAntiDeleteMode(from) {
    const config = loadConfig();
    return config.mode || "off";
}

module.exports = {
    pattern: "antidelete",
    desc: "Enable/Disable anti-delete (sends deleted messages to owner)",
    react: "🔍",
    category: "owner",
    use: ".antidelete (on/off/dm)",
    filename: __filename,

    execute: async (conn, mek, m, { from, sender, args, isOwner, reply }) => {
        const send = async (lines) => {
            const caption =
                `*●⏤꯭➕ ANTIDELETE𓂃ꜛ⸙*\n\n` +
                lines.map(l => `*├⬗ ${l}*`).join('\n') + `\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;
            await conn.sendMessage(from, { text: caption }, { quoted: mek });
        };

        if (!isOwner) return send(['Error: ❌ Only owner can use this command.']);

        await conn.sendMessage(from, { react: { text: '🔍', key: mek.key } });

        const action = args[0]?.toLowerCase();
        const config = loadConfig();

        if (action === 'on') {
            config.mode = "on";
            config.owner = sender;
            saveConfig(config);
            return send([
                'Result: ✅ Anti-Delete enabled.',
                'Mode: Same Chat',
                'Deleted messages will be resent in the same chat/group they were deleted from.'
            ]);
        } else if (action === 'off') {
            config.mode = "off";
            saveConfig(config);
            return send(['Result: ❌ Anti-Delete disabled.']);
        } else if (action === 'dm') {
            config.mode = "dm";
            config.owner = sender;
            saveConfig(config);
            return send([
                'Result: ✅ Anti-Delete enabled.',
                'Mode: DM',
                'Deleted messages from any chat or group will be resent directly to your inbox.'
            ]);
        } else {
            const statusLabel = config.mode === "on" ? "✅ ON (resend in same chat)"
                : config.mode === "dm" ? "✅ ON (resend → your DM)"
                : "❌ OFF";
            return send([
                `Status: ${statusLabel}`,
                'Usage: .antidelete on',
                'Usage: .antidelete off',
                'Usage: .antidelete dm'
            ]);
        }
    },

    isAntiDeleteEnabled,
    getAntiDeleteOwner,
    getAntiDeleteMode,
};
