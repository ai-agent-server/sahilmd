module.exports = {
    pattern: "setname",
    desc: "Set the bot's WhatsApp display name",
    react: "✏️",
    category: "owner",
    use: ".setname <name>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, isOwner, isEnvOwner, reply }) => {
        if (!isOwner && !isEnvOwner) return reply(
            `*●⏤꯭✏️ SETNAME𓂃ꜛ⸙*\n\n` +
            `*├⬗ Error:* ❌ Only the bot owner can use this command.\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
        );

        if (!q) return reply(
            `*●⏤꯭✏️ SETNAME𓂃ꜛ⸙*\n\n` +
            `*├⬗ Usage:* \`.setname <name>\`\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
        );

        await conn.sendMessage(from, { react: { text: '✏️', key: mek.key } });

        try {
            // This is the part that was missing — the command was only ever
            // echoing "Name set to: X" back in chat, it never actually told
            // WhatsApp to change the bot's profile name, so nothing changed.
            await conn.updateProfileName(q);
            await reply(
                `*●⏤꯭✏️ SETNAME𓂃ꜛ⸙*\n\n` +
                `*├⬗ Result:* ✅ Bot name changed to: ${q}\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
            );
        } catch (e) {
            console.error('Setname error:', e.message);
            await reply(
                `*●⏤꯭✏️ SETNAME𓂃ꜛ⸙*\n\n` +
                `*├⬗ Error:* ❌ Failed to change bot name.\n` +
                `*├⬗ Reason:* ${e.message}\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
            );
        }
    }
};
