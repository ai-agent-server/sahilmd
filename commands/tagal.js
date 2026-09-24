const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const groupMetaCache = require('../lib/groupMetadataCache');

module.exports = {
    pattern: "tagal",
    desc: "Tag members whose device is currently online (message delivered to it) — even if they aren't viewing the group",
    react: "📡",
    category: "admin",
    use: ".tagal [message]",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, isAdmin, reply }) => {
        const box = (lines) =>
            `*●⏤꯭📡 TAG ACTIVE𓂃ꜛ⸙*\n\n` +
            lines.map(l => `◇ ${l}`).join('\n') + `\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        if (!from.endsWith('@g.us')) return reply(box(['❌ This command can only be used in groups.']));
        if (!isAdmin) return reply(box(['❌ Only admin can use this command in groups.']));

        await conn.sendMessage(from, { react: { text: '📡', key: mek.key } });

        try {
            const groupMetadata = await groupMetaCache.getGroupMetadata(conn, from);
            const participants = groupMetadata.participants;

            // This status message doubles as the "probe": WhatsApp delivers it
            // to every member's device the moment that device is online / has
            // internet — even if the group chat isn't open on their end — and
            // we get a delivery receipt back for it. That receipt is what
            // actually tells us who's reachable right now, instead of relying
            // on presence (which only fires if someone has the chat open).
            const statusMsg = await conn.sendMessage(from, {
                text: box([
                    '⏳ *Detecting active members...*',
                    'Waiting up to 10s for delivery confirmations.'
                ])
            }, { quoted: mek });

            const deliveredSet = new Set();
            const collect = (jid) => { if (jid) deliveredSet.add(jidNormalizedUser(jid)); };

            // Fires per-member as their device confirms receipt of our message.
            const onReceiptUpdate = (updates) => {
                try {
                    const list = Array.isArray(updates) ? updates : [updates];
                    for (const u of list) {
                        if (!u?.key || u.key.id !== statusMsg.key.id) continue;
                        collect(u.key.participant || u.key.remoteJid);
                        if (u.receipt?.userJid) collect(u.receipt.userJid);
                    }
                } catch {}
            };

            // Fallback path some Baileys versions use for group delivery acks:
            // status >= 3 (DELIVERY_ACK) means at least one device received it.
            const onMessagesUpdate = (updates) => {
                try {
                    const list = Array.isArray(updates) ? updates : [updates];
                    for (const u of list) {
                        if (!u?.key || u.key.id !== statusMsg.key.id) continue;
                        if ((u.update?.status ?? 0) >= 3) {
                            collect(u.key.participant || u.key.remoteJid);
                        }
                    }
                } catch {}
            };

            conn.ev.on('message-receipt.update', onReceiptUpdate);
            conn.ev.on('messages.update', onMessagesUpdate);

            await new Promise(resolve => setTimeout(resolve, 10000));

            conn.ev.off('message-receipt.update', onReceiptUpdate);
            conn.ev.off('messages.update', onMessagesUpdate);

            const activeMembers = participants.filter(p => deliveredSet.has(jidNormalizedUser(p.id)));

            if (activeMembers.length === 0) {
                return reply(box([
                    '⚠️ No delivery confirmations detected yet.',
                    "Members' devices may still be reconnecting —",
                    'try again in a bit.'
                ]));
            }

            let tagText = `*●⏤꯭📡 TAG ACTIVE𓂃ꜛ⸙*\n\n`;
            if (q) tagText += `◇ 📝 *Message:* ${q}\n`;
            tagText += `◇ 🟢 *Online (message delivered):* ${activeMembers.length}/${participants.length}\n\n`;

            activeMembers.forEach((mem, i) => {
                tagText += `◇ ${i + 1}. @${mem.id.split('@')[0]}\n`;
            });

            tagText += `\n> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

            await conn.sendMessage(from, {
                text: tagText,
                mentions: activeMembers.map(p => p.id)
            }, { quoted: mek });

        } catch (e) {
            console.error("Tagal Error:", e);
            await reply(box([`❌ Error: ${e.message}`]));
        }
    }
};
