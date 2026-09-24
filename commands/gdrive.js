const axios = require('axios');

module.exports = {
    pattern: "gdrive",
    desc: "Download file from Google Drive link",
    react: "📂",
    category: "download",
    use: ".gdrive <google drive link>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply("❌ Please provide a Google Drive link.\n\n📌 *Usage:* `.gdrive <link>`\n\n> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀");

        try {
            await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
            await reply("⏳ *Analyzing Google Drive link...*");

            let fileId = "";
            const patterns = [
                /\/file\/d\/([a-zA-Z0-9_-]{25,})/,
                /id=([a-zA-Z0-9_-]{25,})/,
                /([a-zA-Z0-9_-]{33,})/
            ];

            for (let pattern of patterns) {
                const match = q.match(pattern);
                if (match) { fileId = match[1]; break; }
            }

            if (!fileId) return reply("❌ Could not extract file ID from the link.");

            const downloadUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;

            let fileName = `gdrive_file_${fileId}`;
            let fileSize = "Unknown";

            try {
                const headRes = await axios.head(downloadUrl, {
                    maxRedirects: 5,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                const disposition = headRes.headers['content-disposition'];
                if (disposition) {
                    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                    if (match) fileName = match[1].replace(/['"]/g, '').trim();
                }
                const contentLen = headRes.headers['content-length'];
                if (contentLen) {
                    const sizeKB = Math.round(parseInt(contentLen) / 1024);
                    fileSize = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(2)} MB` : `${sizeKB} KB`;
                }
            } catch {}

            const caption = `╭━━━〔 📂 *GOOGLE DRIVE DL* 〕━━━┈⊷\n┃ 📝 *File:* ${fileName}\n┃ ⚖️ *Size:* ${fileSize}\n╰━━━━━━━━━━━━━━━━━━┈⊷\n\n> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀`;

            await conn.sendMessage(from, {
                document: { url: downloadUrl },
                mimetype: 'application/octet-stream',
                fileName: fileName,
                caption: caption
            }, { quoted: mek });

            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });

        } catch (e) {
            console.error('GDrive Error:', e.message);
            await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
            await reply('❌ Error downloading Google Drive file. Make sure the file is public.');
        }
    }
};
