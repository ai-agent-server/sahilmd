function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    pattern: "hack",
    desc: "Fake hack animation (just for fun!)",
    react: "💻",
    category: "fun",
    use: ".hack <name or number>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, isOwner, reply }) => {
        if (!isOwner) return reply('❌ Only the bot owner can use this command.');

        // Resolve the target JID, same priority as .ship / .character / .aura:
        // 1) a user tagged/mentioned in the message
        // 2) a user being replied to
        // 3) the person in the DM (private chat)
        let targetJid = null;

        if (mek.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetJid = mek.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (mek.message?.extendedTextMessage?.contextInfo?.participant) {
            targetJid = mek.message.extendedTextMessage.contextInfo.participant;
        } else if (!from.endsWith('@g.us')) {
            targetJid = from; // private chat: the other person in the DM
        }

        // Display name: prefer the saved contact name for that JID, then
        // fall back to "@number" (same style used by ship/character/aura)
        // so we never accidentally show the command sender's own pushName.
        let target = q || "Target";
        if (targetJid) {
            let name = null;
            try {
                if (conn.contacts?.[targetJid]) {
                    name = conn.contacts[targetJid].notify || conn.contacts[targetJid].name || null;
                }
            } catch (e) { /* ignore, fall back below */ }
            target = name || q || `@${targetJid.split('@')[0]}`;
        }

        try {
            await conn.sendMessage(from, { react: { text: '💻', key: mek.key } });

            const firstLine = `💻 *HACK STARTING...* 💻\n🎯 Target: *${target}*`;
            await conn.sendMessage(from, {
                text: firstLine,
                mentions: targetJid ? [targetJid] : []
            }, { quoted: mek });
            await sleep(Math.floor(Math.random() * 1200) + 500);

            const steps = [
                '*Initializing hacking tools...* 🛠️',
                '*Connecting to remote servers...* 🌐',
                '```[█▒▒▒▒] 10%``` ⏳',
                '```[██▒▒▒▒] 30%``` ⏳',
                '```[████▒▒▒] 50%``` ⏳',
                '```[██████▒] 70%``` ⏳',
                '```[████████] 90%``` ⏳',
                '```[████████] 100%``` ✅',
                '🔒 *System Breach: Successful!* 🔓',
                '🚀 *Executing final commands...* 🎯',
                '*📡 Transmitting data...* 📤',
                '_🕵️‍♂️ Covering tracks..._ 🤫',
                '*🔧 Finalizing operations...* 🏁',
                `*_COMPLETE HACKED DONE ☠️_*\n> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
            ];

            for (const line of steps) {
                await conn.sendMessage(from, { text: line }, { quoted: mek });
                const delay = Math.floor(Math.random() * 1200) + 500;
                await sleep(delay);
            }
        } catch (err) {
            console.error('hackCommand error:', err);
            await reply(`❌ Error: ${err.message}`);
        }
    }
};
