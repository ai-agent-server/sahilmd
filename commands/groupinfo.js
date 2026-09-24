const groupMetaCache = require('../lib/groupMetadataCache');

module.exports = {
    pattern: "groupinfo",
    alias: ["ginfo"],
    desc: "Get information about the current group",
    react: "ℹ️",
    category: "group",
    use: ".groupinfo",
    filename: __filename,

    execute: async (conn, mek, m, { from, reply }) => {
        if (!from.endsWith('@g.us')) return reply('❌ This command can only be used in groups.');

        try {
            await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });

            const groupMetadata = await groupMetaCache.getGroupMetadata(conn, from);
            const participants = groupMetadata.participants;
            const groupAdmins = participants.filter(p => p.admin);
            const listAdmin = groupAdmins.map((v, i) => `  ${i + 1}. @${v.id.split('@')[0]}`).join('\n');

            const owner = groupMetadata.owner ||
                groupMetadata.subjectOwner ||
                (participants.find(p => p.admin === 'superadmin')?.id) ||
                'Not found';
            const ownerDisplay = owner !== 'Not found' ? `@${owner.split('@')[0]}` : 'Not found';

            let pp;
            try {
                pp = await conn.profilePictureUrl(from, 'image');
            } catch {
                pp = 'https://i.imgur.com/2wzGhpF.jpeg';
            }

            const text = `*●⏤꯭ℹ️ GROUP INFO𓂃ꜛ⸙*\n\n` +
                `*├⬗ Name:* ${groupMetadata.subject}\n` +
                `*├⬗ ID:* ${groupMetadata.id}\n` +
                `*├⬗ Members:* ${participants.length}\n` +
                `*├⬗ Owner:* ${ownerDisplay}\n` +
                `*├⬗ Admins:* ${groupAdmins.length}\n` +
                `*├⬗ Desc:* ${groupMetadata.desc?.toString().slice(0, 100) || 'No description'}\n\n` +
                `*Admins:*\n${listAdmin}\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

            const mentions = groupAdmins.map(v => v.id);
            if (owner !== 'Not found') mentions.push(owner);

            await conn.sendMessage(from, {
                image: { url: pp },
                caption: text,
                mentions: mentions
            }, { quoted: mek });

        } catch (error) {
            console.error('Groupinfo Error:', error);
            await reply('❌ Failed to get group info!');
        }
    }
};
