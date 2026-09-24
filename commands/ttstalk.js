const axios = require('axios');

module.exports = {
    pattern: "ttstalk",
    desc: "Get TikTok user profile information",
    react: "🕵️",
    category: "utility",
    use: ".ttstalk <@username>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply(`❌ Please provide a TikTok username.\n\n📌 *Usage:* \`.ttstalk <@username>\`\n\n> ᴡʜᴀᴛꜱᴀᴩᴩ ᴍɪɴɪ ʙᴏᴛ | ᴅʀ ʜᴏɴᴇʏ ᴍɪɴɪ\n> © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx`);

        try {
            await conn.sendMessage(from, { react: { text: '🕵️', key: mek.key } });

            const username = q.replace('@', '');
            const res = await axios.get(`https://api.tiklydown.eu.org/api/user/${username}`);
            const data = res.data;

            if (!data || !data.user) throw new Error("User not found");

            const user = data.user;
            const text = `╭━━━〔 🕵️ *TT STALK* 〕━━━┈⊷\n` +
                `┃ 👤 *Username:* @${user.username || username}\n` +
                `┃ 📝 *Nickname:* ${user.nickname || 'N/A'}\n` +
                `┃ ❤️ *Followers:* ${user.followerCount || 'N/A'}\n` +
                `┃ 👥 *Following:* ${user.followingCount || 'N/A'}\n` +
                `┃ ❤️ *Likes:* ${user.heartCount || 'N/A'}\n` +
                `┃ 📹 *Videos:* ${user.videoCount || 'N/A'}\n` +
                `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                `> ᴡʜᴀᴛꜱᴀᴩᴩ ᴍɪɴɪ ʙᴏᴛ | ᴅʀ ʜᴏɴᴇʏ ᴍɪɴɪ
> © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx`;

            await conn.sendMessage(from, { text }, { quoted: mek });

        } catch (e) {
            console.error('TT Stalk error:', e.message);
            await reply('❌ Failed to fetch TikTok profile. Check username and try again.');
        }
    }
};
