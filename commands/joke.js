const axios = require('axios');

module.exports = {
    pattern: "joke",
    desc: "Get a random joke",
    react: "😂",
    category: "fun",
    use: ".joke",
    filename: __filename,

    execute: async (conn, mek, m, { from, reply }) => {
        try {
            await conn.sendMessage(from, { react: { text: '😂', key: mek.key } });

            const response = await axios.get('https://icanhazdadjoke.com/', {
                headers: { Accept: 'application/json' }
            });
            const joke = response.data.joke;

            const caption =
                `*●⏤꯭😂 JOKE𓂃ꜛ⸙*\n\n` +
                `*├⬗ Joke:* ${joke}\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

            await conn.sendMessage(from, { text: caption }, { quoted: mek });

        } catch (error) {
            console.error('Joke error:', error);
            await conn.sendMessage(from, {
                react: { text: "❌", key: mek.key }
            });
            await reply('⚠️ Could not fetch a joke right now. Try again!');
        }
    }
};
