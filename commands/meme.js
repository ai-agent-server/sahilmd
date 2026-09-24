const axios = require('axios');

module.exports = {
    pattern: "meme",
    desc: "Get a random meme",
    react: "🎭",
    category: "fun",
    use: ".meme",
    filename: __filename,

    execute: async (conn, mek, m, { from, reply }) => {
        try {
            await conn.sendMessage(from, { react: { text: '🎭', key: mek.key } });

            const response = await axios.get('https://meme-api.com/gimme', { timeout: 10000 });
            const data = response.data;

            if (!data || !data.url) throw new Error("No meme found");

            const caption =
                `*●⏤꯭🎭 MEME𓂃ꜛ⸙*\n\n` +
                `*├⬗ Title:* ${data.title || 'Meme'}\n` +
                `*├⬗ Upvotes:* ${data.ups || 0}\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

            await conn.sendMessage(from, {
                image: { url: data.url },
                caption
            }, { quoted: mek });

        } catch (error) {
            console.error('Meme error:', error);
            await reply('❌ Failed to fetch meme. Please try again later.');
        }
    }
};
