const axios = require('axios');

module.exports = {
    pattern: "emojimix",
    desc: "Mix two emojis together",
    react: "🎴",
    category: "fun",
    use: ".emojimix 😎+🥰",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply(
            `*●⏤꯭🎴 EMOJIMIX𓂃ꜛ⸙*\n\n` +
            `*├⬗ Usage:* \`.emojimix 😎+🥰\`\n` +
            `*├⬗ Note:* Separate emojis with a *+* sign\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
        );
        if (!q.includes('+')) return reply(
            `*●⏤꯭🎴 EMOJIMIX𓂃ꜛ⸙*\n\n` +
            `*├⬗ Error:* Separate the emojis with a *+* sign\n` +
            `*├⬗ Example:* \`.emojimix 😎+🥰\`\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
        );

        try {
            await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });

            let [emoji1, emoji2] = q.split('+').map(e => e.trim());

            // Free, keyless Emoji Kitchen mirror — returns the mixed sticker
            // image directly, no API key/quota to expire like the old Tenor endpoint.
            const url = `https://emojik.vercel.app/s/${encodeURIComponent(emoji1)}_${encodeURIComponent(emoji2)}?size=256`;

            const res = await axios.get(url, {
                responseType: 'arraybuffer',
                validateStatus: () => true
            });

            const contentType = res.headers?.['content-type'] || '';
            const isImage = contentType.startsWith('image/');

            if (res.status !== 200 || !isImage || !res.data || res.data.length === 0) {
                return reply(
                    `*●⏤꯭🎴 EMOJIMIX𓂃ꜛ⸙*\n\n` +
                    `*├⬗ Result:* ❌ No mix found for these emojis. Try different ones!\n\n` +
                    `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
                );
            }

            const buffer = Buffer.from(res.data);

            await conn.sendMessage(from, {
                sticker: buffer
            }, { quoted: mek });

            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });

        } catch (e) {
            console.error('Emojimix error:', e.message);
            await reply('❌ Error mixing emojis. Try a different combination!');
        }
    }
};
