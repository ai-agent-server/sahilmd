const { getMode, setMode, VALID_MODES } = require('../lib/botMode');

// Strictly checks whether the sender IS the number the bot is deployed/paired on.
// This is combined with the global `isOwner` (fromMe + OWNER_NUMBER env list)
// check in execute(), so both the configured owner AND the bot's own
// deployed number can use this command.
function isDeployedNumber(conn, sender) {
    try {
        const botBase = conn?.user?.id ? conn.user.id.split(':')[0].split('@')[0] : null;
        const senderBase = sender ? sender.split('@')[0] : null;
        return !!(botBase && senderBase && botBase === senderBase);
    } catch (error) {
        return false;
    }
}

const MODE_INFO = {
    private: { emoji: '🔐', label: 'PRIVATE', desc: 'Only the owner/bot number can use commands.' },
    public: { emoji: '🌍', label: 'PUBLIC', desc: 'Everyone can use every command.' },
    groups: { emoji: '👥', label: 'GROUPS', desc: 'Commands only work inside groups.' },
    dms: { emoji: '💬', label: 'DMS', desc: 'Commands only work in private chats.' },
    silent: { emoji: '🤫', label: 'SILENT', desc: "Bot won't post its own crash/error text in chat." },
    buttons: { emoji: '🔘', label: 'BUTTONS', desc: 'Bot prefers interactive buttons where supported.' },
    channel: { emoji: '📢', label: 'CHANNEL', desc: 'Bot only responds to .chf/.chvote/.jgroup/.chreact.' }
};

module.exports = {
    pattern: 'mode',
    desc: 'Set the bot operating mode (private/public/groups/dms/silent/buttons/channel)',
    react: '⚙️',
    category: 'user',
    use: '.mode [private/public/groups/dms/silent/buttons/channel]',
    filename: __filename,

    execute: async (conn, mek, m, { from, args, q, reply, sender, isOwner }) => {
        const senderJid = sender || m?.sender;
        // Allow: configured owner (OWNER_NUMBER env) OR the bot's own deployed number
        const ownerCheck = mek?.key?.fromMe || isDeployedNumber(conn, senderJid) || !!isOwner;

        if (!ownerCheck) {
            return reply('❌ Only the owner or the bot number can use this command.');
        }

        const box = (lines) =>
            `*●⏤꯭⚙️ MODE𓂃ꜛ⸙*\n\n` +
            lines.map(l => `*├⬗ ${l}*`).join('\n') + `\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        await conn.sendMessage(from, { react: { text: '⚙️', key: mek.key } });

        const choice = (args && args[0] ? args[0] : q || '').toString().trim().toLowerCase();

        if (!choice) {
            const current = getMode();
            const info = MODE_INFO[current];
            return reply(box([
                `Current mode: ${info.emoji} ${info.label}`,
                `Commands: .mode private / public / groups / dms / silent / buttons / channel`,
                `Reset: .modedefault — back to public`
            ]));
        }

        if (!VALID_MODES.includes(choice)) {
            return reply(box([
                'Error: ❌ Invalid option. Use .mode to see all options.'
            ]));
        }

        setMode(choice);
        const info = MODE_INFO[choice];
        await conn.sendMessage(from, { react: { text: info.emoji, key: mek.key } });
        return reply(box([
            `Result: ${info.emoji} Bot is now in ${info.label} mode.`,
            info.desc
        ]));
    }
};
