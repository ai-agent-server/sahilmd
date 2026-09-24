// === GroupEvents.js ===
const { isJidGroup, jidNormalizedUser } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

// ========== TRACK SENT MESSAGES ==========
// NOTE: this used to be a plain Set that entries were added to and NEVER
// removed. That meant the first time a given participant left/was removed
// from a group, that exact (group, action, participant) combo was recorded
// forever — so if the same person left again later (or was kicked again),
// the goodbye message would be silently skipped for the rest of the
// process's lifetime. This is why goodbye looked "broken" after the first
// test. We now use a short TTL window (a few seconds) purely to absorb
// Baileys occasionally re-firing the same event on reconnect, and expire
// entries automatically so real future leaves are never blocked.
const sentTracker = new Map();
const DEDUPE_TTL_MS = 10_000;

function alreadyHandled(msgKey) {
    const ts = sentTracker.get(msgKey);
    if (ts && Date.now() - ts < DEDUPE_TTL_MS) return true;
    sentTracker.set(msgKey, Date.now());
    // opportunistic cleanup so the map doesn't grow forever
    if (sentTracker.size > 500) {
        const cutoff = Date.now() - DEDUPE_TTL_MS;
        for (const [key, time] of sentTracker) {
            if (time < cutoff) sentTracker.delete(key);
        }
    }
    return false;
}

// ========== SETTINGS FILES ==========
const SETTINGS_DIR = './database';
const WELCOME_FILE = path.join(SETTINGS_DIR, 'welcome.json');
const GOODBYE_FILE = path.join(SETTINGS_DIR, 'goodbye.json');

// Ensure database directory exists
if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

// Load settings
function loadSettings(file) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (e) {}
    return {};
}

// Check if enabled
function isEnabled(groupId, file) {
    const settings = loadSettings(file);
    return settings[groupId] === true;
}

module.exports = async (conn, update) => {
    try {
        let { id, participants, action } = update;
        console.log(`👥 group-participants.update: action=${action}, group=${id}, participants=${JSON.stringify(participants)}`);
        if (!id || !isJidGroup(id) || !participants) return;

        // Normalize so the group-id key always matches what goodbye.js/welcome.js save
        id = jidNormalizedUser(id);

        for (const participant of participants) {
            const userName = participant.split("@")[0];
            
            // Duplicate check — only blocks the same event firing twice in
            // quick succession (e.g. on reconnect), not future real leaves.
            const msgKey = `${id}_${action}_${participant}`;
            if (alreadyHandled(msgKey)) {
                console.log(`⏭️ Already sent ${action} for ${userName} recently, skipping...`);
                continue;
            }

            // Small helper: try sending with @mention first, and if WhatsApp
            // rejects the mention (e.g. a privacy "@lid" participant JID that
            // doesn't resolve to a taggable contact), fall back to plain text
            // so the goodbye/welcome message still goes out instead of
            // silently failing.
            const sendWithFallback = async (text) => {
                try {
                    await conn.sendMessage(id, { text, mentions: [participant] });
                } catch (e) {
                    console.error(`⚠️ Mentioned send failed for ${userName}, retrying without mention:`, e.message);
                    await conn.sendMessage(id, { text });
                }
            };

            // ========== WELCOME ==========
            if (action === "add") {
                if (!isEnabled(id, WELCOME_FILE)) {
                    console.log(`⏭️ Welcome disabled for ${id}`);
                    continue;
                }

                const welcomeText = `@${userName} *𝐖ᴇʟᴄᴏᴍᴇ 𝐇ᴏ 𝐆ᴀʏᴀ 𝐀ᴀᴘ 𝐊ᴀ 𝐌ᴀɴɪɪ 𝟎𝟓 𝐊ɪ 𝐓ᴀʀᴀғ 𝐒ʏʏ  💗👀🥹*`;

                try {
                    await sendWithFallback(welcomeText);
                    console.log(`✅ Welcome sent to ${userName}`);
                } catch (e) {
                    console.error(`❌ Welcome send failed for ${userName}:`, e.message);
                }
            }

            // ========== GOODBYE ==========
            // WhatsApp/Baileys reports BOTH an admin-kick and a self-leave
            // using the same "remove" action — there's no separate event for
            // "left on their own". So this one branch already covers both
            // cases; "leave" is kept too in case a future Baileys version
            // starts sending it explicitly.
            else if (action === "remove" || action === "leave") {
                if (!isEnabled(id, GOODBYE_FILE)) {
                    console.log(`⏭️ Goodbye disabled for ${id}`);
                    continue;
                }

                const goodbyeText = `@${userName} *_left us we will miss😔💗_*`;

                try {
                    await sendWithFallback(goodbyeText);
                    console.log(`✅ Goodbye sent to ${userName}`);
                } catch (e) {
                    console.error(`❌ Goodbye send failed for ${userName}:`, e.message);
                }
            }
        }

    } catch (err) {
        console.error("GroupEvents error:", err.message, err.stack);
    }
};