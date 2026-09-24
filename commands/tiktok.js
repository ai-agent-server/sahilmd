const axios = require('axios');

// chatId -> { type, qualities?, images?, music?, author, title, stats, duration, size, cachedAt }
const CHAT_CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Periodic sweep so old cache entries don't sit in memory forever.
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of CHAT_CACHE.entries()) {
        if (now - val.cachedAt > CACHE_TTL_MS) CHAT_CACHE.delete(key);
    }
}, 5 * 60 * 1000).unref?.();

function extractTikTokLinks(text) {
    if (!text) return [];
    const regex = /https?:\/\/(?:vm\.|vt\.|www\.)?tiktok\.com\/[^\s]+/gi;
    return text.match(regex) || [];
}

function formatNumber(n) {
    if (n === undefined || n === null) return null;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
}

function formatBytes(bytes) {
    if (!bytes) return null;
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function formatDuration(seconds) {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

async function fetchTikTokData(link) {
    // tikwm gives quality links, audio, stats, and slideshow (photo post) support.
    try {
        const res = await axios.get(`https://tikwm.com/api/?url=${encodeURIComponent(link)}`, { timeout: 20000 });
        const data = res.data?.data;
        if (data) {
            const author = data.author?.unique_id || 'unknown';
            const title = data.title || '';
            const stats = {
                plays: data.play_count,
                likes: data.digg_count,
                comments: data.comment_count,
                shares: data.share_count
            };

            // Slideshow / photo post — no video, just images (+ background music).
            if (Array.isArray(data.images) && data.images.length > 0) {
                return {
                    type: 'slideshow',
                    images: data.images,
                    music: data.music || null,
                    author, title, stats
                };
            }

            if (data.play) {
                const qualities = [];
                if (data.hdplay) qualities.push({ label: 'HD (No Watermark)', url: data.hdplay, type: 'video' });
                qualities.push({ label: 'SD (No Watermark)', url: data.play, type: 'video' });
                if (data.wmplay) qualities.push({ label: 'Watermarked', url: data.wmplay, type: 'video' });
                if (data.music) qualities.push({ label: 'Audio Only (MP3)', url: data.music, type: 'audio' });

                return {
                    type: 'video',
                    qualities,
                    author, title, stats,
                    duration: data.duration,
                    size: data.size,
                    hdSize: data.hd_size
                };
            }
        }
    } catch (e) {
        console.error('TikTok DL (tikwm) failed:', e.message);
    }

    // Fallback APIs — single video link, no stats/audio/slideshow support.
    const fallbackSources = [
        {
            name: 'giftedtech',
            run: async () => {
                const res = await axios.get(`https://api.giftedtech.co.ke/api/download/tiktok?apikey=gifted&url=${encodeURIComponent(link)}`, { timeout: 20000 });
                const result = res.data?.result;
                const url = result?.video_url || result?.url || result?.play;
                if (!url) throw new Error('no play url');
                return { url, author: result?.author?.nickname || result?.author || 'unknown' };
            }
        },
        {
            name: 'davidcyriltech',
            run: async () => {
                const res = await axios.get(`https://apis.davidcyriltech.my.id/download/tiktok?url=${encodeURIComponent(link)}`, { timeout: 20000 });
                const result = res.data?.result || res.data;
                const url = result?.video || result?.url || result?.play;
                if (!url) throw new Error('no play url');
                return { url, author: result?.author || 'unknown' };
            }
        }
    ];

    let lastError = null;
    for (const source of fallbackSources) {
        try {
            const { url, author } = await source.run();
            return {
                type: 'video',
                qualities: [{ label: 'Standard', url, type: 'video' }],
                author, title: '', stats: {}
            };
        } catch (e) {
            lastError = e;
            console.error(`TikTok DL (${source.name}) failed:`, e.message);
        }
    }
    throw lastError || new Error('All TikTok download sources failed');
}

function statsLines(stats) {
    if (!stats) return [];
    const lines = [];
    const parts = [];
    if (stats.plays !== undefined) parts.push(`▶️ ${formatNumber(stats.plays)}`);
    if (stats.likes !== undefined) parts.push(`❤️ ${formatNumber(stats.likes)}`);
    if (stats.comments !== undefined) parts.push(`💬 ${formatNumber(stats.comments)}`);
    if (stats.shares !== undefined) parts.push(`🔁 ${formatNumber(stats.shares)}`);
    if (parts.length) lines.push(`📊 *Stats:* ${parts.join('  ')}`);
    return lines;
}

module.exports = {
    pattern: "tiktok",
    alias: ["tt"],
    desc: "Download TikTok video/slideshow/audio — pick quality, batch links, stats included",
    react: "📱",
    category: "download",
    use: ".tiktok <url> (or reply to a message with a link)  then  .tiktok <number> to choose quality",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, q, reply }) => {
        const box = (lines) =>
            `*●⏤꯭📱 TIKTOK𓂃ꜛ⸙*\n\n` +
            lines.map(l => `◇ ${l}`).join('\n') + `\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        const chatId = from || m.chat || mek.key?.remoteJid || "global";

        const sendSlideshow = async (data, targetFrom) => {
            await conn.sendMessage(targetFrom, {
                image: { url: data.images[0] },
                caption: box([
                    '✅ Slideshow Downloaded!',
                    `👤 *Author:* @${data.author}`,
                    data.title ? `📝 *Title:* ${data.title}` : null,
                    `🖼️ *Photos:* ${data.images.length}`,
                    ...statsLines(data.stats)
                ].filter(Boolean))
            }, { quoted: mek });
            for (let i = 1; i < data.images.length; i++) {
                await conn.sendMessage(targetFrom, { image: { url: data.images[i] } }, { quoted: mek });
            }
            if (data.music) {
                await conn.sendMessage(targetFrom, { audio: { url: data.music }, mimetype: 'audio/mpeg' }, { quoted: mek });
            }
        };

        const sendVideoQuality = async (data, chosen, targetFrom) => {
            const infoLines = [
                chosen.type === 'audio' ? '✅ Audio Downloaded!' : '✅ Video Downloaded!',
                `👤 *Author:* @${data.author}`,
                data.title ? `📝 *Title:* ${data.title}` : null,
                `🎚️ *Quality:* ${chosen.label}`,
                formatDuration(data.duration) ? `⏱️ *Duration:* ${formatDuration(data.duration)}` : null,
                formatBytes(chosen.type === 'audio' ? null : (chosen.label.startsWith('HD') ? data.hdSize : data.size)) ?
                    `💾 *Size:* ${formatBytes(chosen.label.startsWith('HD') ? data.hdSize : data.size)}` : null,
                ...statsLines(data.stats)
            ].filter(Boolean);

            if (chosen.type === 'audio') {
                await conn.sendMessage(targetFrom, {
                    audio: { url: chosen.url },
                    mimetype: 'audio/mpeg'
                }, { quoted: mek });
                await conn.sendMessage(targetFrom, { text: box(infoLines) }, { quoted: mek });
            } else {
                await conn.sendMessage(targetFrom, {
                    video: { url: chosen.url },
                    caption: box(infoLines)
                }, { quoted: mek });
            }
        };

        // ".tiktok <number>" — pick a quality from the last link fetched in this chat
        if (args?.length === 1 && !isNaN(args[0])) {
            const styleNumber = parseInt(args[0], 10);
            const cached = CHAT_CACHE.get(chatId);
            if (!cached) return reply(box(['⚠️ No recent TikTok link found in this chat.', 'Send `.tiktok <url>` first.']));
            if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
                CHAT_CACHE.delete(chatId);
                return reply(box(['⚠️ That link expired. Send `.tiktok <url>` again.']));
            }
            if (cached.type !== 'video') return reply(box(['⚠️ Nothing to pick a quality for — that was a slideshow post.']));
            if (styleNumber < 1 || styleNumber > cached.qualities.length) {
                return reply(box([`⚠️ Invalid choice. Pick between 1 and ${cached.qualities.length}.`]));
            }
            const chosen = cached.qualities[styleNumber - 1];

            try {
                for (const emoji of ['📥', '⏳', '📱']) {
                    await conn.sendMessage(from, { react: { text: emoji, key: mek.key } });
                }
                await sendVideoQuality(cached, chosen, from);
                await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
            } catch (e) {
                console.error('TikTok download error:', e.message);
                await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
                await reply(box(['❌ Failed to download that quality. Try again.']));
            }
            return;
        }

        // Gather link(s): typed text, or fall back to a replied message's text.
        let sourceText = q || "";
        if (!extractTikTokLinks(sourceText).length) {
            const qm = m?.quoted?.message || mek?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const quotedText = qm?.conversation || qm?.extendedTextMessage?.text || qm?.imageMessage?.caption || qm?.videoMessage?.caption || "";
            if (extractTikTokLinks(quotedText).length) sourceText = quotedText;
        }

        const links = extractTikTokLinks(sourceText);
        if (links.length === 0) {
            return reply(box(['❌ Please provide a TikTok URL.', 'Usage: `.tiktok <url>` or reply to a message containing one.']));
        }

        // Multiple links -> batch mode: auto-download the best quality for each,
        // no quality menu (asking per-item would be unwieldy).
        if (links.length > 1) {
            await reply(box([`📦 Batch mode: found ${links.length} links.`, 'Downloading each one now...']));
            for (const [i, link] of links.entries()) {
                try {
                    await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
                    const data = await fetchTikTokData(link);
                    if (data.type === 'slideshow') {
                        await sendSlideshow(data, from);
                    } else {
                        const best = data.qualities.find(qd => qd.type === 'video' && qd.label.startsWith('HD'))
                            || data.qualities.find(qd => qd.type === 'video');
                        await sendVideoQuality(data, best, from);
                    }
                } catch (e) {
                    console.error(`TikTok batch item ${i + 1} failed:`, e.message);
                    await conn.sendMessage(from, { text: box([`❌ Link ${i + 1} failed to download.`]) }, { quoted: mek });
                }
            }
            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
            return;
        }

        // Single link -> normal flow (quality menu / slideshow / cache for later pick).
        try {
            for (const emoji of ['📥', '⏳', '🔎']) {
                await conn.sendMessage(from, { react: { text: emoji, key: mek.key } });
            }

            const data = await fetchTikTokData(links[0]);
            CHAT_CACHE.set(chatId, { ...data, cachedAt: Date.now() });

            if (data.type === 'slideshow') {
                await sendSlideshow(data, from);
                await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
                return;
            }

            if (data.qualities.length === 1) {
                // Only one option available — download right away.
                await sendVideoQuality(data, data.qualities[0], from);
                await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
                return;
            }

            const lines = [
                `👤 *Author:* @${data.author}`
            ];
            if (data.title) lines.push(`📝 *Title:* ${data.title}`);
            if (formatDuration(data.duration)) lines.push(`⏱️ *Duration:* ${formatDuration(data.duration)}`);
            lines.push(...statsLines(data.stats));
            lines.push('', 'Type `.tiktok <number>` to choose:');
            data.qualities.forEach((qlt, i) => lines.push(`${i + 1}. ${qlt.label}`));

            await reply(box(lines));

        } catch (e) {
            console.error('TikTok error:', e.message);
            await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
            await reply(box(['❌ Error downloading TikTok. Make sure the link is valid.']));
        }
    }
};
