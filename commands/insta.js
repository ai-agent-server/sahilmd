const axios = require('axios');

function extractError(e) {
    if (e.response) {
        return `HTTP ${e.response.status} - ${JSON.stringify(e.response.data).slice(0, 300)}`;
    }
    return e.message;
}

function normalizeMedia(raw) {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr
        .map(item => {
            const url = item.url || item.video_url || item.download_url || item.hd || item.sd;
            if (!url) return null;
            const type = item.type === 'image' || /\.(jpe?g|png|webp)(\?|$)/i.test(url) ? 'image' : 'video';
            return { type, url };
        })
        .filter(Boolean);
}

function extractShortcode(link) {
    const m = link.match(/instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/i);
    return m ? m[1] : null;
}

function unescapeJs(s) {
    return s
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '');
}

function extractFromContextJSON(html) {
    // Instagram's embed page ships the real post data inside a
    // `"contextJSON":"..."` escaped-JSON blob. This is Instagram's own
    // official embed payload, so it's far more stable than scraping
    // individual video_url/display_url substrings.
    const m = html.match(/"contextJSON":"((?:[^"\\]|\\.)*)"/);
    if (!m) return null;
    let data;
    try {
        data = JSON.parse(unescapeJs(m[1]));
    } catch (_) {
        return null;
    }
    const media = data.shortcode_media || data.media || data.graphql?.shortcode_media;
    if (!media) return null;

    // Carousel (multiple photos/videos in one post)
    const children = media.edge_sidecar_to_children?.edges;
    if (children?.length) {
        const items = children
            .map(e => e.node)
            .filter(Boolean)
            .map(node => node.is_video
                ? { type: 'video', url: node.video_url }
                : { type: 'image', url: node.display_url })
            .filter(x => x.url);
        if (items.length) return items;
    }

    if (media.is_video && media.video_url) {
        return [{ type: 'video', url: media.video_url }];
    }
    if (media.display_url) {
        return [{ type: 'image', url: media.display_url }];
    }
    return null;
}

function extractFromLooseRegex(html) {
    const videoMatch = html.match(/"video_url":"([^"]+)"/);
    if (videoMatch) return [{ type: 'video', url: unescapeJs(videoMatch[1]) }];

    const videoTagMatch = html.match(/<video[^>]+src="([^"]+)"/);
    if (videoTagMatch) return [{ type: 'video', url: videoTagMatch[1].replace(/&amp;/g, '&') }];

    const displayMatch = html.match(/"display_url":"([^"]+)"/)
        || html.match(/<img[^>]+class="[^"]*EmbeddedMediaImage[^"]*"[^>]+src="([^"]+)"/);
    if (displayMatch) return [{ type: 'image', url: unescapeJs(displayMatch[1]).replace(/&amp;/g, '&') }];

    // og:video / og:image meta tags are the most basic level Instagram
    // still reliably renders server-side, so try them last.
    const ogVideo = html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/i)
        || html.match(/<meta\s+content="([^"]+)"\s+property="og:video"/i);
    if (ogVideo) return [{ type: 'video', url: ogVideo[1].replace(/&amp;/g, '&') }];

    const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
        || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
    if (ogImage) return [{ type: 'image', url: ogImage[1].replace(/&amp;/g, '&') }];

    return null;
}

async function fetchViaEmbed(link) {
    const shortcode = extractShortcode(link);
    if (!shortcode) throw new Error('could not parse shortcode from link');

    // Try both embed variants — some post types/ages only render one of them.
    const embedUrls = [
        `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
        `https://www.instagram.com/p/${shortcode}/embed/`,
        `https://www.instagram.com/reel/${shortcode}/embed/captioned/`
    ];

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    };

    let lastStatus;
    for (const embedUrl of embedUrls) {
        const res = await axios.get(embedUrl, { timeout: 20000, headers, validateStatus: () => true });
        lastStatus = res.status;
        if (res.status >= 400) continue;
        const html = res.data;

        const fromContext = extractFromContextJSON(html);
        if (fromContext?.length) return fromContext;

        const fromLoose = extractFromLooseRegex(html);
        if (fromLoose?.length) return fromLoose;
    }

    throw new Error(`no media markers found in embed page (post may be private, age-restricted, or Instagram changed the embed HTML) [last status ${lastStatus}]`);
}

async function fetchInstagramMedia(link) {
    const sources = [
        {
            name: 'instagram-embed',
            run: async () => fetchViaEmbed(link)
        },
        {
            // NOTE: GiftedTech moved their API host from api.giftedtech.co.ke (now docs-only)
            // to api.gifted.co.ke. The exact instagram endpoint slug isn't published, so we
            // try the most likely candidates in order and use whichever responds with media.
            name: 'giftedtech',
            run: async () => {
                const candidates = ['igdl', 'igdlv2', 'instadl', 'instadlv2', 'instagram'];
                let lastErr;
                for (const slug of candidates) {
                    try {
                        const res = await axios.get(`https://api.gifted.co.ke/api/download/${slug}?apikey=gifted&url=${encodeURIComponent(link)}`, { timeout: 20000 });
                        const result = res.data?.result;
                        const media = normalizeMedia(Array.isArray(result) ? result : (result?.data || result));
                        if (media.length) return media;
                        lastErr = new Error(`no media in response (${slug}): ${JSON.stringify(res.data).slice(0, 200)}`);
                    } catch (e) {
                        lastErr = new Error(`${slug}: ${extractError(e)}`);
                    }
                }
                throw lastErr || new Error('no working giftedtech endpoint found');
            }
        },
        {
            name: 'davidcyriltech',
            run: async () => {
                const res = await axios.get(`https://apis.davidcyriltech.my.id/download/instagram?url=${encodeURIComponent(link)}`, { timeout: 20000 });
                const result = res.data?.result || res.data;
                const media = normalizeMedia(Array.isArray(result) ? result : (result?.data || result));
                if (!media.length) throw new Error(`no media in response: ${JSON.stringify(res.data).slice(0, 300)}`);
                return media;
            }
        },
        {
            name: 'itzpire',
            run: async () => {
                const res = await axios.get(`https://itzpire.com/download/instagram?url=${encodeURIComponent(link)}`, { timeout: 20000 });
                const result = res.data?.result || res.data?.data || res.data;
                const media = normalizeMedia(Array.isArray(result) ? result : (result?.data || result));
                if (!media.length) throw new Error(`no media in response: ${JSON.stringify(res.data).slice(0, 300)}`);
                return media;
            }
        },
    ];

    const attempts = [];
    for (const source of sources) {
        try {
            const media = await source.run();
            console.log(`[insta] success via ${source.name}, ${media.length} item(s)`);
            return { media, source: source.name };
        } catch (e) {
            const reason = extractError(e);
            attempts.push(`${source.name}: ${reason}`);
            console.error(`[insta] source "${source.name}" failed: ${reason}`);
        }
    }
    const summary = attempts.join(' | ');
    const err = new Error(summary || 'All Instagram download sources failed');
    err.summary = summary;
    throw err;
}

module.exports = {
    pattern: "insta",
    alias: ["ig", "instagram"],
    desc: "Download Instagram photo/video",
    react: "📸",
    category: "download",
    use: ".insta <instagram url>",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply }) => {
        if (!q) return reply("❌ Please provide an Instagram URL.\n\n📌 *Usage:* `.insta <url>`\n\n> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀");
        if (!/instagram\.com|instagr\.am/i.test(q)) {
            return reply("❌ That is not a valid Instagram link.\n\n> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀");
        }

        try {
            await conn.sendMessage(from, { react: { text: '📥', key: mek.key } });
            await reply("⏳ *Downloading Instagram content...*");

            const { media } = await fetchInstagramMedia(q);

            for (const item of media) {
                // Download the bytes ourselves with a browser-like Referer/User-Agent
                // instead of handing WhatsApp a raw cdninstagram URL, which it will
                // often refuse with a "something is wrong with the video file" style error.
                const fileRes = await axios.get(item.url, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    maxRedirects: 10,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                        'Referer': 'https://www.instagram.com/'
                    }
                });
                const buffer = Buffer.from(fileRes.data);
                if (!buffer || buffer.length < 5000) {
                    throw new Error(`downloaded ${item.type} too small/invalid (${buffer?.length || 0} bytes) — link likely expired`);
                }

                if (item.type === 'video') {
                    await conn.sendMessage(from, {
                        video: buffer,
                        mimetype: 'video/mp4',
                        caption: "✅ *Instagram Video Downloaded*\n\n> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀"
                    }, { quoted: mek });
                } else {
                    await conn.sendMessage(from, {
                        image: buffer,
                        mimetype: 'image/jpeg',
                        caption: "✅ *Instagram Image Downloaded*\n\n> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀"
                    }, { quoted: mek });
                }
            }
            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });

        } catch (e) {
            const detail = e.summary || extractError(e);
            console.error('[insta] final failure:', detail);
            await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
            await reply(`❌ Error downloading Instagram content.\n🔎 *Reason (per source):*\n${detail.slice(0, 500)}\n\n> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜 | Dr Honey TechX 💀`);
        }
    }
};