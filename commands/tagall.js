const groupMetaCache = require('../lib/groupMetadataCache');

module.exports = {
    pattern: "tagall",
    desc: "Tag all members in the group",
    react: "📢",
    category: "admin",
    use: ".tagall [message]",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, isAdmin, reply }) => {
        const box = (lines) =>
            `*●⏤꯭📢 TAG ALL𓂃ꜛ⸙*\n\n` +
            lines.map(l => `◇ ${l}`).join('\n') + `\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        if (!isAdmin) return reply(box(['❌ Only admin can use this command in groups.']));
        if (!from.endsWith('@g.us')) return reply(box(['❌ This command can only be used in groups.']));

        await conn.sendMessage(from, { react: { text: '📢', key: mek.key } });

        const groupMetadata = await groupMetaCache.getGroupMetadata(conn, from);
        const participants = groupMetadata.participants;

        let tagText = `*●⏤꯭📢 TAG ALL𓂃ꜛ⸙*\n\n`;
        if (q) tagText += `◇ 📝 *Message:* ${q}\n`;
        tagText += `◇ 👥 *Members:* ${participants.length}\n\n`;

        participants.forEach((mem, i) => {
            tagText += `◇ ${i + 1}. @${mem.id.split('@')[0]}\n`;
        });

        tagText += `\n> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        await conn.sendMessage(from, {
            text: tagText,
            mentions: participants.map(p => p.id)
        }, { quoted: mek });
    }
};
