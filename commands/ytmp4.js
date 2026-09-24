const axios = require('axios');
const yts = require('yt-search');

const BASE = 'https://apis.davidcyriltech.my.id';
const MAX_DURATION_SEC = 600; // 10 minutes

async function fetchVideoUrl(youtubeUrl) {
    let data, retries = 3;
    while (retries > 0) {
        try {
            const response = await axios.get(`${BASE}/download/ytmp4?url=${encodeURIComponent(youtubeUrl)}`, { timeout: 30000 });
            data = response.data;
            const videoUrl = data?.result?.download_url || data?.result?.downloadUrl || data?.result?.url || data?.url || data?.link;
            if (videoUrl) return { videoUrl, meta: data?.result || {} };
            throw new Error('Invalid response from API');
        } catch (err) {
            retries--;
            if (retries === 0) throw err;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

module.exports = {
    pattern: "ytmp4",
    alias: ["ytvideo", "ytv"],
    desc: "Download YouTube video as MP4 (by link or search name)",
    react: "🎬",
    category: "downloader",
    use: ".ytmp4 <video name or YouTube link>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply(`❌ Please provide a video name or YouTube link.\n📌 *Usage:* \`.ytmp4 <name or link>\`\n\n> ᴡʜᴀᴛꜱᴀᴩᴩ ᴍɪɴɪ ʙᴏᴛ | ᴅʀ ʜᴏɴᴇʏ ᴍɪɴɪ\n> © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx`);

        try {
            await conn.sendMessage(from, { react: { text: "🎬", key: mek.key } });

            let videoUrl, title = 'Video', channel = 'Unknown', duration = '', durationSec = 0;

            if (q.includes('youtube.com') || q.includes('youtu.be')) {
                videoUrl = q;
            } else {
                const { videos } = await yts(q);
                if (!videos?.length) return reply("❌ No results found. Try a different name.");
                videoUrl = videos[0].url;
                title = videos[0].title;
                channel = videos[0].author?.name || channel;
                duration = videos[0].timestamp || '';
                durationSec = videos[0].seconds || 0;
            }

            if (durationSec > MAX_DURATION_SEC) {
                return reply("❌ Video too long (max 10 minutes). Try `.ytmp3` for audio only.");
            }

            await reply("⏳ Fetching video...");

            const { videoUrl: downloadUrl, meta } = await fetchVideoUrl(videoUrl);
            title = meta.title || title;
            duration = meta.duration || duration;

            await conn.sendMessage(from, {
                video: { url: downloadUrl },
                mimetype: 'video/mp4',
                fileName: `${title.replace(/[^\w\s-]/g, '')}.mp4`,
                caption: `▶️ *${title}*\n👤 ${channel}  •  ⏱ ${duration}\n\n> ᴡʜᴀᴛꜱᴀᴩᴩ ᴍɪɴɪ ʙᴏᴛ | ᴅʀ ʜᴏɴᴇʏ ᴍɪɴɪ
> © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx`
            }, { quoted: mek });

        } catch (err) {
            console.error('ytmp4 error:', err.message);
            await reply(`❌ Video download failed: ${err.message}`);
        }
    }
};
