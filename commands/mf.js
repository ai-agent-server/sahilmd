const axios = require('axios');
const cheerio = require('cheerio');

module.exports = {
    pattern: "mf",
    desc: "Download file from MediaFire link",
    react: "🔥",
    category: "download",
    use: ".mf <mediafire link>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply("❌ Please provide a MediaFire link.\n\n📌 *Usage:* `.mf <link>`\n\n> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀");

        await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
        await reply("⏳ *Analyzing MediaFire link...*");

        try {
            const res = await axios.get(q, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            const $ = cheerio.load(res.data);
            const downloadUrl = $('#downloadButton').attr('href');
            const fileName = $('.dl-info .promo_ss_file_name').text().trim() || $('.dl-btn-label').attr('title') || 'mediafire_file';
            const fileSize = $('.dl-info .promo_ss_file_size').text().trim() || 'Unknown';

            if (downloadUrl) {
                const caption = `╭━━━〔 🔥 *MEDIAFIRE DL* 〕━━━┈⊷\n` +
                    `┃ 📝 *File:* ${fileName}\n` +
                    `┃ ⚖️ *Size:* ${fileSize}\n` +
                    `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                    `> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀`;

                await conn.sendMessage(from, {
                    document: { url: downloadUrl },
                    mimetype: 'application/octet-stream',
                    fileName: fileName,
                    caption: caption
                }, { quoted: mek });

                await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
            } else {
                await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
                await reply("❌ Failed to fetch MediaFire file. Make sure the link is correct.");
            }
        } catch (e) {
            console.error("MediaFire Error:", e);
            await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
            await reply("❌ Error: " + e.message);
        }
    }
};
