const axios = require('axios');

module.exports = {
    pattern: "apk",
    desc: "Download APK from Play Store by app name",
    react: "📦",
    category: "download",
    use: ".apk <app name>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply('⚠️ Please provide an app name.\n📌 *Example:* `.apk whatsapp`\n\n> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀');

        try {
            await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });

            const apiUrl = 'https://api.nexoracle.com/downloader/apk';
            const response = await axios.get(apiUrl, {
                params: { apikey: 'free_key@maher_apis', q }
            });

            if (!response.data || response.data.status !== 200 || !response.data.result) {
                return reply('❌ Unable to find the APK. Please try again later.');
            }

            const { name, lastup, size, icon, dllink } = response.data.result;
            const pkg = response.data.result['package'];

            await conn.sendMessage(from, {
                image: { url: icon },
                caption: `📦 *Downloading ${name}... Please wait.*`
            }, { quoted: mek });

            const apkResponse = await axios.get(dllink, { responseType: 'arraybuffer' });
            const apkBuffer = Buffer.from(apkResponse.data, 'binary');

            const details = `╭━━━〔 📦 *APK DETAILS* 〕━━━┈⊷\n` +
                `┃ 🔖 *Name:* ${name}\n` +
                `┃ 📅 *Last Update:* ${lastup}\n` +
                `┃ 📦 *Package:* ${pkg || 'N/A'}\n` +
                `┃ 📏 *Size:* ${size}\n` +
                `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                `> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀`;

            await conn.sendMessage(from, {
                document: apkBuffer,
                mimetype: 'application/vnd.android.package-archive',
                fileName: `${name}.apk`,
                caption: details
            }, { quoted: mek });

            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });

        } catch (error) {
            console.error('APK Command Error:', error);
            await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
            await reply('❌ Unable to fetch APK. Please try again later.');
        }
    }
};
