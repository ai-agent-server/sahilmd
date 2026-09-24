const { preload, getCached, setCached } = require('../lib/cachedDbStore');

const CONFIG_KEY = 'antistatus-config';
const WARN_KEY = 'antistatus-warnings';

const FOOTER = "\n\n> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*";
const MAX_WARNINGS = 3;

// Same caption style used by .joke / .add / .antilink — header + bullet lines + footer
function box(lines) {
    return `*●⏤꯭📵 ANTISTATUS𓂃ꜛ⸙*\n\n` +
        lines.map(l => `*├⬗ ${l}*`).join('\n') +
        FOOTER;
}

// A "status mention" is the auto-forwarded card WhatsApp drops into a group
// when someone tags/mentions that group in their status update — it shows up
// as its own message type (varies by Baileys/WA build), so we check every
// known key instead of trusting a single one.
function isGroupStatusMention(message) {
    const msg = message.message || {};
    if (msg.groupStatusMentionMessage || msg.groupStatusMentionMesage || msg.statusMentionMessage) return true;
    const keys = Object.keys(msg);
    return keys.some(k => /statusmention/i.test(k));
}

const ready = Promise.all([preload(CONFIG_KEY, {}), preload(WARN_KEY, {})]);

// ── group mode config: { [groupId]: "off" | "on" | "warn" | "kick" } ──
function loadConfig() {
    return getCached(CONFIG_KEY, {});
}

function saveConfig(config) {
    setCached(CONFIG_KEY, config);
}

function getAntistatusMode(groupId) {
    const config = loadConfig();
    return config[groupId] || 'off';
}

function setAntistatusMode(groupId, mode) {
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

// ── Core enforcement, called by server.js for every group message ──
async function processAntistatusMessage(conn, message, { from, sender, isSenderAdmin, isSenderOwner }) {
    const mode = getAntistatusMode(from);
    if (mode === 'off') return false;
    if (!isGroupStatusMention(message)) return false;

    // Admins and the bot owner are exempt from anti-status enforcement
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
        console.error('Antistatus: failed to delete message:', e.message);
    }

    if (mode === 'on') {
        return true;
    }

    if (mode === 'kick') {
        try {
            await conn.groupParticipantsUpdate(from, [sender], 'remove');
            await conn.sendMessage(from, {
                text: box([
                    '📵 Status detected!',
                    `📱 @${sender.split('@')[0]} has been removed for sharing a status.`
                ]),
                mentions: [sender],
            });
        } catch (e) {
            console.error('Antistatus: failed to kick user:', e.message);
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
                        '📵 Status detected!',
                        `📱 @${sender.split('@')[0]} exceeded ${MAX_WARNINGS} warnings and has been removed.`
                    ]),
                    mentions: [sender],
                });
            } catch (e) {
                console.error('Antistatus: failed to kick user after warnings:', e.message);
            }
        } else {
            try {
                await conn.sendMessage(from, {
                    text: box([
                        '⚠️ Status detected!',
                        `📱 @${sender.split('@')[0]} — Warning ${count}/${MAX_WARNINGS}.`,
                        'Next violations after this may get you removed.'
                    ]),
                    mentions: [sender],
                });
            } catch (e) {
                console.error('Antistatus: failed to send warning:', e.message);
            }
        }
        return true;
    }

    return true;
}

module.exports = {
    pattern: "antistatus",
    desc: "Enable/Disable auto-delete of status shares in group",
    react: "📵",
    category: "admin",
    use: ".antistatus [on/off/warn/kick]",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, isAdmin, isEnvOwner, reply }) => {
        if (!from.endsWith('@g.us')) return reply("❌ This command only works in groups.");
        if (!isAdmin && !isEnvOwner) return reply("❌ Only admin can use this command.");

        await conn.sendMessage(from, { react: { text: "📵", key: mek.key } });

        const action = (args[0] || '').toLowerCase();

        if (!action) {
            return reply(box([
                'Commands:',
                '.antistatus on — Delete Status',
                '.antistatus warn — Delete + Warn',
                '.antistatus kick — Delete + Kick',
                '.antistatus off — Disable'
            ]));
        }

        if (action === 'on') {
            setAntistatusMode(from, 'on');
            return reply(box([
                '✅ Anti-Status Enabled!',
                'Status shares in this group will be deleted automatically.'
            ]));
        } else if (action === 'warn' || action === 'war') {
            setAntistatusMode(from, 'warn');
            return reply(box([
                '✅ Anti-Status (Warn) Enabled!',
                'Status shares will be deleted and the sender warned.',
                `After ${MAX_WARNINGS} warnings, they'll be removed.`
            ]));
        } else if (action === 'kick') {
            setAntistatusMode(from, 'kick');
            return reply(box([
                '✅ Anti-Status (Kick) Enabled!',
                'Status shares will be deleted and the sender removed immediately.'
            ]));
        } else if (action === 'off') {
            setAntistatusMode(from, 'off');
            return reply(box([
                '❌ Anti-Status Disabled!'
            ]));
        } else {
            return reply(box([
                '❌ Usage: .antistatus on / off / warn / kick'
            ]));
        }
    },

    // exported for server.js
    getAntistatusMode,
    processAntistatusMessage,
    isGroupStatusMention,
    ready,
};
