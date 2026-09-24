const axios = require('axios');
const yts = require('yt-search');

const BASE = 'https://apis.davidcyriltech.my.id';

module.exports = {
    pattern: "video",
    alias: ["vid"],
    desc: "Download video from YouTube",
    react: "🎥",
    category: "media",
    use: ".video <name or YouTube link>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply(`❌ Please provide a video name or YouTube link.\n📌 *Usage:* \`.video <name or link>\`\n\n> ᴡʜᴀᴛꜱᴀᴩᴩ ᴍɪɴɪ ʙᴏᴛ | ᴅʀ ʜᴏɴᴇʏ ᴍɪɴɪ\n> © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx`);

        try {
            for (const emoji of ['📥', '⏳', '🎥']) {
                await conn.sendMessage(from, { react: { text: emoji, key: mek.key } });
            }

            let videoUrl, videoTitle = 'YouTube Video', videoThumbnail;

            if (q.includes('youtube.com') || q.includes('youtu.be')) {
                videoUrl = q;
            } else {
                const { videos } = await yts(q);
                if (!videos?.length) return reply('❌ No videos found! Try a different name.');
                videoUrl = videos[0].url;
                videoTitle = videos[0].title;
                videoThumbnail = videos[0].thumbnail;
            }

            await conn.sendMessage(from, {
                image: { url: videoThumbnail || 'https://i.imgur.com/2wzGhpF.jpeg' },
                caption: `🎥 *Downloading:* ${videoTitle}`
            }, { quoted: mek });

            let data, retries = 3;
            while (retries > 0) {
                try {
                    const response = await axios.get(`${BASE}/download/ytmp4?url=${encodeURIComponent(videoUrl)}`, { timeout: 30000 });
                    data = response.data;
                    const downloadUrl = data?.result?.download_url || data?.result?.downloadUrl || data?.result?.url || data?.url || data?.link;
                    if (downloadUrl) break;
                    throw new Error('Invalid response from API');
                } catch (err) {
                    retries--;
                    if (retries === 0) throw err;
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            const downloadUrl = data?.result?.download_url || data?.result?.downloadUrl || data?.result?.url || data?.url || data?.link;
            if (!downloadUrl) throw new Error('Could not retrieve download link after multiple attempts');

            await conn.sendMessage(from, {
                video: { url: downloadUrl },
                mimetype: 'video/mp4',
                fileName: `${(data?.result?.title || videoTitle).replace(/[^\w\s-]/g, '')}.mp4`,
                caption: `*${data?.result?.title || videoTitle}*\n\n> ᴡʜᴀᴛꜱᴀᴩᴩ ᴍɪɴɪ ʙᴏᴛ | ᴅʀ ʜᴏɴᴇʏ ᴍɪɴɪ
> © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx`
            }, { quoted: mek });

            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });

        } catch (error) {
            console.error('Video error:', error);
            await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
            await reply(`❌ Error: ${error.message}`);
        }
    }
};
