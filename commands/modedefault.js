const { resetMode, DEFAULT_MODE } = require('../lib/botMode');

function isDeployedNumber(conn, sender) {
    try {
        const botBase = conn?.user?.id ? conn.user.id.split(':')[0].split('@')[0] : null;
        const senderBase = sender ? sender.split('@')[0] : null;
        return !!(botBase && senderBase && botBase === senderBase);
    } catch (error) {
        return false;
    }
}

module.exports = {
    pattern: 'modedefault',
    desc: 'Reset the bot mode back to the default (public)',
    react: '⚙️',
    category: 'user',
    use: '.modedefault',
    filename: __filename,

    execute: async (conn, mek, m, { from, reply, sender, isOwner }) => {
        const senderJid = sender || m?.sender;
        const ownerCheck = mek?.key?.fromMe || isDeployedNumber(conn, senderJid) || !!isOwner;

        if (!ownerCheck) {
            return reply('❌ Only the owner or the bot number can use this command.');
        }

        resetMode();
        await conn.sendMessage(from, { react: { text: '🌍', key: mek.key } });
        return reply(
            `╭━━━〔 ⚙️ *BOT MODE* 〕━━━┈⊷\n` +
            `┃ 🌍 *Mode reset to default: PUBLIC*\n` +
            `┃ Everyone can use every command.\n` +
            `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
            `> ᴡʜᴀᴛꜱᴀᴩᴩ ᴍɪɴɪ ʙᴏᴛ | ᴅʀ ʜᴏɴᴇʏ ᴍɪɴɪ\n> © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx`
        );
    }
};
