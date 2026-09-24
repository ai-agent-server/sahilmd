const axios = require('axios');
const yts = require('yt-search');

const BASE = 'https://apis.davidcyriltech.my.id';

module.exports = {
    pattern: "song",
    desc: "Download audio/song from YouTube",
    react: "🎵",
    category: "music",
    use: ".song <song name or YouTube link>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply(
            `*●⏤꯭🎵 SONG𓂃ꜛ⸙*\n\n` +
            `*├⬗ Usage:* \`.song <name or link>\`\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
        );

        try {
            for (const emoji of ['📥', '⏳', '🎵']) {
                await conn.sendMessage(from, { react: { text: emoji, key: mek.key } });
            }

            let videoUrl, videoTitle = 'YouTube Audio', videoThumbnail, videoDuration = 'N/A';

            if (q.includes('youtube.com') || q.includes('youtu.be')) {
                videoUrl = q;
            } else {
                const { videos } = await yts(q);
                if (!videos?.length) return reply(
                    `*●⏤꯭🎵 SONG𓂃ꜛ⸙*\n\n` +
                    `*├⬗ Result:* ❌ No results found. Try a different name.\n\n` +
                    `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
                );
                videoUrl = videos[0].url;
                videoTitle = videos[0].title;
                videoThumbnail = videos[0].thumbnail;
                videoDuration = videos[0].timestamp || 'N/A';
            }

            await conn.sendMessage(from, {
                image: { url: videoThumbnail || 'https://i.imgur.com/2wzGhpF.jpeg' },
                caption:
                    `*●⏤꯭🎵 SONG𓂃ꜛ⸙*\n\n` +
                    `*├⬗ Title:* ${videoTitle}\n` +
                    `*├⬗ Duration:* ${videoDuration}\n\n` +
                    `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
            }, { quoted: mek });

            let data, retries = 3;
            while (retries > 0) {
                try {
                    const response = await axios.get(`${BASE}/download/ytmp3?url=${encodeURIComponent(videoUrl)}`, { timeout: 30000 });
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
                audio: { url: downloadUrl },
                mimetype: 'audio/mpeg',
                fileName: `${(data?.result?.title || videoTitle).replace(/[^\w\s-]/g, '')}.mp3`,
                ptt: false
            }, { quoted: mek });

            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });

        } catch (err) {
            console.error('Song error:', err);
            await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
            await reply(`❌ Error: ${err.message}`);
        }
    }
};
