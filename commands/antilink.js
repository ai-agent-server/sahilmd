const { preload, getCached, setCached } = require('../lib/cachedDbStore');

const CONFIG_KEY = 'antilink-config';
const WARN_KEY = 'antilink-warnings';

const FOOTER = "\n\n> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*";
const MAX_WARNINGS = 3;

// Same caption style used by .joke / .add — header + bullet lines + footer
function box(lines) {
    return `*●⏤꯭🔗 ANTILINK𓂃ꜛ⸙*\n\n` +
        lines.map(l => `*├⬗ ${l}*`).join('\n') +
        FOOTER;
}

// Matches http(s) links, bare www. links, and common invite-link domains
const LINK_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+\.[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)|(t\.me\/[^\s]+)/i;

const ready = Promise.all([preload(CONFIG_KEY, {}), preload(WARN_KEY, {})]);

// ── group mode config: { [groupId]: "off" | "on" | "warn" | "kick" } ──
function loadConfig() {
    return getCached(CONFIG_KEY, {});
}

function saveConfig(config) {
    setCached(CONFIG_KEY, config);
}

function getAntilinkMode(groupId) {
    const config = loadConfig();
    return config[groupId] || 'off';
}

function setAntilinkMode(groupId, mode) {
    const config = loadConfig();
    config[groupId] = mode;
    saveConfig(config);
}

// ── per-group, per-user warning counts: { [groupId]: { [userJid]: count } } ──
function loadWarnings() {
    return getCached(WARN_KEY, {});
}

function saveWarnings(warnings) {
    setCached(WARN_KEY, warnings);
}

function bumpWarning(groupId, userJid) {
    const warnings = loadWarnings();
    if (!warnings[groupId]) warnings[groupId] = {};
    warnings[groupId][userJid] = (warnings[groupId][userJid] || 0) + 1;
    saveWarnings(warnings);
    return warnings[groupId][userJid];
}

function resetWarning(groupId, userJid) {
    const warnings = loadWarnings();
    if (warnings[groupId]) {
        delete warnings[groupId][userJid];
        saveWarnings(warnings);
    }
}

// ── Core enforcement, called by server.js for every group text message ──
async function processAntilinkMessage(conn, message, { from, sender, body, isSenderAdmin, isSenderOwner }) {
    const mode = getAntilinkMode(from);
    if (mode === 'off') return false;
    if (!body || !LINK_REGEX.test(body)) return false;

    // Admins and the bot owner are exempt from anti-link enforcement
    if (isSenderAdmin || isSenderOwner) return false;

    const deleteKey = {
        remoteJid: from,
        fromMe: false,
        id: message.key.id,
        participant: sender,
    };

    try {
        await conn.sendMessage(from, { delete: deleteKey });
    } catch (e) {
        console.error('Antilink: failed to delete message:', e.message);
    }

    if (mode === 'on') {
        return true;
    }

    if (mode === 'kick') {
        try {
            await conn.groupParticipantsUpdate(from, [sender], 'remove');
            await conn.sendMessage(from, {
                text: box([
                    '🚫 Link detected!',
                    `📱 @${sender.split('@')[0]} has been removed for sharing a link.`
                ]),
                mentions: [sender],
            });
        } catch (e) {
            console.error('Antilink: failed to kick user:', e.message);
        }
        return true;
    }

    if (mode === 'warn' || mode === 'war') {
        const count = bumpWarning(from, sender);
        if (count > MAX_WARNINGS) {
            resetWarning(from, sender);
            try {
                await conn.groupParticipantsUpdate(from, [sender], 'remove');
                await conn.sendMessage(from, {
                    text: box([
                        '🚫 Link detected!',
                        `📱 @${sender.split('@')[0]} exceeded ${MAX_WARNINGS} warnings and has been removed.`
                    ]),
                    mentions: [sender],
                });
            } catch (e) {
                console.error('Antilink: failed to kick user after warnings:', e.message);
            }
        } else {
            try {
                await conn.sendMessage(from, {
                    text: box([
                        '⚠️ Link detected!',
                        `📱 @${sender.split('@')[0]} — Warning ${count}/${MAX_WARNINGS}.`,
                        'Next violations after this may get you removed.'
                    ]),
                    mentions: [sender],
                });
            } catch (e) {
                console.error('Antilink: failed to send warning:', e.message);
            }
        }
        return true;
    }

    return true;
}

module.exports = {
    pattern: "antilink",
    desc: "Enable/Disable anti-link in group",
    react: "🔗",
    category: "admin",
    use: ".antilink [on/off/warn/kick]",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, isOwner, reply }) => {
        if (!from.endsWith('@g.us')) return reply("❌ This command only works in groups.");
        if (!isOwner) return reply("❌ Only the bot owner can use this command.");

        await conn.sendMessage(from, { react: { text: "🔗", key: mek.key } });

        const action = (args[0] || '').toLowerCase();

        if (!action) {
            return reply(box([
                'Commands:',
                '.antilink on — Delete Links',
                '.antilink warn — Delete + Warn',
                '.antilink kick — Delete + Kick',
                '.antilink off — Disable'
            ]));
        }

        if (action === 'on') {
            setAntilinkMode(from, 'on');
            return reply(box([
                '✅ Anti-Link Enabled!',
                'Links will be deleted automatically.'
            ]));
        } else if (action === 'warn' || action === 'war') {
            setAntilinkMode(from, 'warn');
            return reply(box([
                '✅ Anti-Link (Warn) Enabled!',
                'Links will be deleted and the sender warned.',
                `After ${MAX_WARNINGS} warnings, they'll be removed.`
            ]));
        } else if (action === 'kick') {
            setAntilinkMode(from, 'kick');
            return reply(box([
                '✅ Anti-Link (Kick) Enabled!',
                'Links will be deleted and the sender removed immediately.'
            ]));
        } else if (action === 'off') {
            setAntilinkMode(from, 'off');
            return reply(box([
                '❌ Anti-Link Disabled!'
            ]));
        } else {
            return reply(box([
                '❌ Usage: .antilink on / off / warn / kick'
            ]));
        }
    },

    // exported for server.js
    getAntilinkMode,
    processAntilinkMessage,
    LINK_REGEX,
    ready,
};
