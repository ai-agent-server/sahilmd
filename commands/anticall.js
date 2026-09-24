const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../data/anticall.json');

// config shape: { enabled: bool, warning: bool, warningText: string, totalBlocked: number, lastBlocked: { number, time } | null }
function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return defaultConfig();
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH));
        return { ...defaultConfig(), ...cfg };
    } catch { return defaultConfig(); }
}

function defaultConfig() {
    return {
        enabled: false,
        warning: true,
        warningText: "📵 Calls are not allowed on this number. Please send a text message instead.",
        totalBlocked: 0,
        lastBlocked: null,
    };
}

function saveConfig(config) {
    try {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) { console.error('Anticall save error:', e); }
}

// ── Exported helpers used by server.js ──────────────────────────────────
function isAntiCallEnabled() {
    return loadConfig().enabled === true;
}

function isWarningEnabled() {
    return loadConfig().warning === true;
}

function getWarningText() {
    return loadConfig().warningText;
}

// Called by server.js every time a call is rejected, to update stats
function recordBlockedCall(number) {
    const config = loadConfig();
    config.totalBlocked = (config.totalBlocked || 0) + 1;
    config.lastBlocked = { number, time: new Date().toISOString() };
    saveConfig(config);
}

// ── box formatter, matching .status command's style ─────────────────────
const box = (title, lines) =>
    `*●⏤꯭📵 ${title}𓂃ꜛ⸙*\n\n` +
    lines.map(l => `*├⬗* ${l}`).join('\n') + `\n\n` +
    `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

function statusLines(config) {
    const lastBlockedLine = config.lastBlocked
        ? `Last Blocked: ${config.lastBlocked.number.split('@')[0]} (${new Date(config.lastBlocked.time).toLocaleString()})`
        : `Last Blocked: —`;

    return [
        config.enabled ? '✅ *Anti-Call: ON*' : '❌ *Anti-Call: OFF*',
        config.warning ? '◇ Warning Message: ✅' : '◇ Warning Message: ❌',
        `◇ Total Calls Blocked: ${config.totalBlocked || 0}`,
        `◇ ${lastBlockedLine}`
    ];
}

module.exports = {
    pattern: "anticall",
    desc: "Enable/Disable anti-call feature, with status and warning message",
    react: "📵",
    category: "user",
    use: ".anticall [on/off/status/warn on/warn off]",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, isOwner, reply }) => {
        if (!isOwner) return reply("❌ Only owner can use this command.");

        await conn.sendMessage(from, { react: { text: "📵", key: mek.key } });

        const action = args[0]?.toLowerCase();
        const sub = args[1]?.toLowerCase();
        const config = loadConfig();

        if (!action) {
            return reply(box('ANTICALL SETTINGS', [
                '*Commands:*',
                '.anticall on — Enable',
                '.anticall off — Disable',
                '.anticall status — View status',
                '.anticall warn on/off — Toggle warning message'
            ]));
        }

        if (action === 'on') {
            config.enabled = true;
            saveConfig(config);
            return reply(box('ANTICALL SETTINGS', [
                '✅ *Anti-Call: ON*',
                'All incoming calls will be rejected automatically.'
            ]));
        }

        if (action === 'off') {
            config.enabled = false;
            saveConfig(config);
            return reply(box('ANTICALL SETTINGS', [
                '❌ *Anti-Call: OFF*'
            ]));
        }

        if (action === 'status') {
            return reply(box('ANTICALL STATUS', statusLines(config)));
        }

        if (action === 'warn') {
            if (sub === 'on') {
                config.warning = true;
                saveConfig(config);
                return reply(box('ANTICALL SETTINGS', [
                    '✅ *Warning Message: ON*',
                    'Callers will get a text before being rejected.'
                ]));
            }
            if (sub === 'off') {
                config.warning = false;
                saveConfig(config);
                return reply(box('ANTICALL SETTINGS', [
                    '❌ *Warning Message: OFF*',
                    'Callers will be silently rejected.'
                ]));
            }
            return reply(box('ANTICALL SETTINGS', [
                '❌ *Invalid option.* Use `.anticall warn on` or `.anticall warn off`.'
            ]));
        }

        return reply(box('ANTICALL SETTINGS', [
            '❌ *Invalid option.* Use `.anticall` to see all options.'
        ]));
    },

    isAntiCallEnabled,
    isWarningEnabled,
    getWarningText,
    recordBlockedCall,
};
