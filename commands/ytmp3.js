const axios = require('axios');
const yts = require('yt-search');

const BASE = 'https://apis.davidcyriltech.my.id';

async function fetchAudioUrl(youtubeUrl) {
    let data, retries = 3;
    while (retries > 0) {
        try {
            const response = await axios.get(`${BASE}/download/ytmp3?url=${encodeURIComponent(youtubeUrl)}`, { timeout: 30000 });
            data = response.data;
            const audioUrl = data?.result?.download_url || data?.result?.downloadUrl || data?.result?.url || data?.url || data?.link;
            if (audioUrl) return { audioUrl, meta: data?.result || {} };
            throw new Error('Invalid response from API');
        } catch (err) {
            retries--;
            if (retries === 0) throw err;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

module.exports = {
    pattern: "ytmp3",
    alias: ["ytaudio", "ytmp3dl"],
    desc: "Download YouTube audio as MP3 (by link or search name)",
    react: "🎵",
    category: "downloader",
    use: ".ytmp3 <song name or YouTube link>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply(
            `*●⏤꯭🎵 YTMP3𓂃ꜛ⸙*\n\n` +
            `*├⬗ Usage:* \`.ytmp3 <name or link>\`\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
        );

        try {
            await conn.sendMessage(from, { react: { text: "🎵", key: mek.key } });

            let videoUrl, title = 'Audio', channel = 'Unknown', duration = '';

            if (q.includes('youtube.com') || q.includes('youtu.be')) {
                videoUrl = q;
            } else {
                const { videos } = await yts(q);
                if (!videos?.length) return reply(
                    `*●⏤꯭🎵 YTMP3𓂃ꜛ⸙*\n\n` +
                    `*├⬗ Result:* ❌ No results found. Try a different name.\n\n` +
                    `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
                );
                videoUrl = videos[0].url;
                title = videos[0].title;
                channel = videos[0].author?.name || channel;
                duration = videos[0].timestamp || '';
            }

            await reply(
                `*●⏤꯭🎵 YTMP3𓂃ꜛ⸙*\n\n` +
                `*├⬗ Status:* Fetching audio...\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
            );

            const { audioUrl, meta } = await fetchAudioUrl(videoUrl);
            title = meta.title || title;
            duration = meta.duration || duration;

            await conn.sendMessage(from, {
                audio: { url: audioUrl },
                mimetype: 'audio/mpeg',
                fileName: `${title.replace(/[^\w\s-]/g, '')}.mp3`,
                ptt: false
            }, { quoted: mek });

            await reply(
                `*●⏤꯭🎵 YTMP3𓂃ꜛ⸙*\n\n` +
                `*├⬗ Title:* ${title}\n` +
                `*├⬗ Channel:* ${channel}\n` +
                `*├⬗ Duration:* ${duration}\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
            );

        } catch (err) {
            console.error('ytmp3 error:', err.message);
            await reply(`❌ Audio download failed: ${err.message}`);
        }
    }
};
