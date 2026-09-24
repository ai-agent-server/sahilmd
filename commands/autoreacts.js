const { preload, getCached, setCached } = require('../lib/cachedDbStore');

const CONFIG_KEY = 'autoreacts-config';

// ── Valid modes ───────────────────────────────────────────────────────
// off   → never auto-react
// all   → react to every incoming AND outgoing message (DMs + groups)
// dm    → react only to incoming/outgoing messages in private chats
// group → react only to incoming/outgoing messages in groups
const VALID_MODES = ['off', 'all', 'dm', 'group'];
const DEFAULT_MODE = 'off';

const EMOJIS = ['❤️', '💸', '😇', '🍂', '💥', '💯', '🔥', '💫', '💎', '💗', '🤍', '🖤', '👀', '🙌', '🙆', '🥰', '💐', '😎', '🤎', '✅', '🫀', '🧡', '😁', '😄', '🌸', '🕊️', '🌷', '⛅', '🌟', '💜', '💙', '🌝', '💚', '😍', '🤩', '👍'];

const ready = preload(CONFIG_KEY, () => ({ mode: DEFAULT_MODE }));

function loadConfig() {
    const data = getCached(CONFIG_KEY, () => ({ mode: DEFAULT_MODE }));
    if (!VALID_MODES.includes(data.mode)) data.mode = DEFAULT_MODE;
    return data;
}

function saveConfig(config) {
    setCached(CONFIG_KEY, config);
}

function getAutoReactMode() {
    return loadConfig().mode;
}

function setAutoReactMode(mode) {
    if (!VALID_MODES.includes(mode)) return false;
    saveConfig({ mode, updatedAt: new Date().toISOString() });
    return true;
}

// Decide whether a message in `remoteJid` should get an auto-react,
// based on the currently configured mode.
function shouldAutoReact(remoteJid) {
    const mode = getAutoReactMode();
    if (mode === 'off') return false;
    if (!remoteJid) return false;
    const isGroup = remoteJid.endsWith('@g.us');
    if (mode === 'all') return true;
    if (mode === 'group') return isGroup;
    if (mode === 'dm') return !isGroup;
    return false;
}

function pickAutoReactEmoji() {
    return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

// ── Core hook, called by server.js for every incoming/outgoing message ──
async function handleAutoReact(conn, message) {
    try {
        const remoteJid = message.key?.remoteJid;
        if (!shouldAutoReact(remoteJid)) return;

        // Never react to reactions, deletions, or other protocol/system events
        if (!message.message) return;
        if (message.message.reactionMessage) return;
        if (message.message.protocolMessage) return;
        if (remoteJid === 'status@broadcast') return;
        if (remoteJid.endsWith('@newsletter')) return;

        const emoji = pickAutoReactEmoji();
        await conn.sendMessage(remoteJid, { react: { text: emoji, key: message.key } });
    } catch (e) {
        console.error('Autoreacts hook error:', e.message);
    }
}

module.exports = {
    pattern: "autoreacts",
    desc: "Enable/Disable auto-react to messages",
    react: "😍",
    category: "user",
    use: ".autoreacts [on/off/dm/group]",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, isOwner, reply }) => {
        const send = async (lines) => {
            const caption =
                `*●⏤꯭➕ AUTOREACTS𓂃ꜛ⸙*\n\n` +
                lines.map(l => `*├⬗ ${l}*`).join('\n') + `\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;
            await conn.sendMessage(from, { text: caption }, { quoted: mek });
        };

        if (!isOwner) return send(['Error: ❌ Only owner can use this command.']);

        await conn.sendMessage(from, { react: { text: '😍', key: mek.key } });

        const action = args[0]?.toLowerCase();

        if (action === 'on') {
            setAutoReactMode('all');
            return send([
                'Result: ✅ Auto-React enabled.',
                'Bot will react to all incoming & outgoing messages.'
            ]);
        } else if (action === 'off') {
            setAutoReactMode('off');
            return send(['Result: ❌ Auto-React disabled.']);
        } else if (action === 'dm') {
            setAutoReactMode('dm');
            return send([
                'Result: ✅ Auto-React set to DM only.',
                'Bot will react to incoming & outgoing private messages only.'
            ]);
        } else if (action === 'group') {
            setAutoReactMode('group');
            return send([
                'Result: ✅ Auto-React set to Group only.',
                'Bot will react to incoming & outgoing group messages only.'
            ]);
        } else {
            const current = getAutoReactMode();
            return send([
                `Current mode: *${current}*`,
                'Usage: .autoreacts on',
                'Usage: .autoreacts off',
                'Usage: .autoreacts dm',
                'Usage: .autoreacts group'
            ]);
        }
    },

    // exported for server.js
    getAutoReactMode,
    setAutoReactMode,
    shouldAutoReact,
    handleAutoReact,
    ready,
};
