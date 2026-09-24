// === goodbye.js ===
const fs = require('fs');
const path = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const groupMetaCache = require('../lib/groupMetadataCache');

const SETTINGS_DIR = './database';
const GOODBYE_FILE = path.join(SETTINGS_DIR, 'goodbye.json');

// Ensure directory exists
if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

// Load goodbye settings
function loadSettings() {
    try {
        if (fs.existsSync(GOODBYE_FILE)) {
            return JSON.parse(fs.readFileSync(GOODBYE_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

// Save goodbye settings
function saveSettings(settings) {
    try {
        fs.writeFileSync(GOODBYE_FILE, JSON.stringify(settings, null, 2));
        return true;
    } catch (e) {
        return false;
    }
}

// Check if goodbye enabled for group
function isGoodbyeEnabled(groupId) {
    const settings = loadSettings();
    return settings[jidNormalizedUser(groupId)] === true;
}

// Set goodbye enabled for group
function setGoodbyeEnabled(groupId, status) {
    const settings = loadSettings();
    settings[jidNormalizedUser(groupId)] = status;
    return saveSettings(settings);
}

module.exports = {
    pattern: "goodbye",
    desc: "Toggle goodbye messages for this group",
    category: "group",
    react: "🚤",
    use: ".goodbye on/off",
    filename: __filename,

    execute: async (conn, message, m, { q, reply, from, isGroup, sender }) => {
        const send = async (lines) => {
            const caption =
                `*●⏤꯭🚤 GOODBYE𓂃ꜛ⸙*\n\n` +
                lines.map(l => `*├⬗ ${l}*`).join('\n') + `\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;
            await conn.sendMessage(from, { text: caption }, { quoted: message });
        };

        try {
            if (!isGroup) {
                return send(['Error: ❌ This command only works in groups.']);
            }

            const jidToBase = (jid) => String(jid).split("@")[0].split(":")[0];
            const senderBase = jidToBase(sender);
            const botBase = jidToBase(conn?.user?.id || "");

            // Owner check
            let owners = [];
            if (process.env.OWNER_NUMBER) {
                owners = process.env.OWNER_NUMBER.split(",").map(num => num.trim());
            }
            const isOwner = botBase === senderBase || owners.includes(senderBase);

            // Admin check — WhatsApp groups sometimes list participants using a privacy
            // "@lid" address instead of the real phone-number JID (or vice-versa).
            // `sender` and `m.sender` can be in different formats, so check both
            // against the group's participant list (matching by full jid or number only).
            let isAdmin = false;
            try {
                const metadata = await groupMetaCache.getGroupMetadata(conn, from);
                const candidates = [m.sender, sender]
                    .filter(Boolean)
                    .map(j => jidNormalizedUser(j));
                const candidateNums = candidates.map(j => j.split('@')[0]);

                const participant = metadata.participants.find(p => {
                    const pid = jidNormalizedUser(p.id);
                    return candidates.includes(pid) || candidateNums.includes(pid.split('@')[0]);
                });
                isAdmin = participant?.admin === "admin" || participant?.admin === "superadmin";
            } catch {
                return send(['Error: ❌ Failed to get group information.']);
            }

            if (!isOwner && !isAdmin) {
                return send(['Error: ❌ Only group admins or owner can toggle goodbye messages.']);
            }

            const currentStatus = isGoodbyeEnabled(from);

            if (!q) {
                return send([
                    `Group: ${from.split('@')[0]}`,
                    `Status: ${currentStatus ? '✅ ON' : '❌ OFF'}`,
                    `Usage: .goodbye on / .goodbye off`
                ]);
            }

            if (q.toLowerCase() === "on") {
                setGoodbyeEnabled(from, true);
                await conn.sendMessage(from, { react: { text: "✅", key: message.key } });
                return send(['Result: ✅ Goodbye messages ENABLED for this group.']);
            }
            
            if (q.toLowerCase() === "off") {
                setGoodbyeEnabled(from, false);
                await conn.sendMessage(from, { react: { text: "❌", key: message.key } });
                return send(['Result: ❌ Goodbye messages DISABLED for this group.']);
            }
            
            return send(['⚙️ Usage: .goodbye on or .goodbye off']);

        } catch (e) {
            console.error("Goodbye command error:", e);
            send(['⚠️ Failed to toggle goodbye messages.']);
        }
    }
};