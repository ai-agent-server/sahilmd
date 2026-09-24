const axios = require('axios');

// Levenshtein edit distance — used to rank candidate place names by how
// close they are to what the user actually typed.
function editDistance(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[a.length][b.length];
}

// People often aren't sure of the "official" spelling of a small town/area
// (e.g. Roopwal / Ropwal / Rupwal / Rupal are all attempts at the same
// place). We generate a handful of common phonetic rewrites of the query —
// collapsing double letters, oo<->u, w<->v, ph->f, ee->i — and search each
// one, then rank every candidate we find by edit distance to the original
// query so the closest real spelling(s) rise to the top.
function phoneticVariants(name) {
    const v = name.toLowerCase();
    const variants = new Set([v]);
    const rewrites = [
        [/(.)\1+/g, '$1'],   // collapse doubled letters: roopwal -> ropwal
        [/oo/g, 'u'],        // roopwal -> rupwal
        [/oo/g, 'o'],
        [/u/g, 'oo'],        // rupal -> roopal
        [/ee/g, 'i'],
        [/ph/g, 'f'],
        [/w/g, 'v'],
        [/v/g, 'w'],
    ];
    for (const [pattern, replacement] of rewrites) {
        variants.add(v.replace(pattern, replacement));
    }
    return [...variants];
}

async function findSimilarCities(query, apiKey) {
    const tryFetch = async (q) => {
        try {
            const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=10&appid=${apiKey}`;
            const res = await axios.get(url, { timeout: 8000 });
            return Array.isArray(res.data) ? res.data : [];
        } catch {
            return [];
        }
    };

    // Build a set of query attempts: the phonetic variants themselves, plus
    // progressively shorter prefixes of each (the geocoding API only does
    // prefix matching, so shortening helps catch trailing misspellings).
    const attempts = new Set();
    for (const variant of phoneticVariants(query)) {
        attempts.add(variant);
        for (let len = variant.length - 1; len >= 3; len--) {
            attempts.add(variant.slice(0, len));
        }
    }

    const seen = new Map(); // "name,state,country" -> result
    for (const attempt of attempts) {
        const results = await tryFetch(attempt);
        for (const r of results) {
            const key = `${r.name}|${r.state || ''}|${r.country}`;
            if (!seen.has(key)) seen.set(key, r);
        }
        // Enough raw candidates to rank from — no need to keep hammering the API.
        if (seen.size >= 25) break;
    }

    if (seen.size === 0) return [];

    // Rank by closeness to what the user actually typed, keep the best few.
    const maxDistance = Math.max(3, Math.floor(query.length / 2));
    const ranked = [...seen.values()]
        .map(r => ({ r, dist: editDistance(query, r.name) }))
        .filter(x => x.dist <= maxDistance)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5);

    return ranked.map(({ r }) => {
        const state = r.state ? `, ${r.state}` : '';
        return `${r.name}${state}, ${r.country}`;
    });
}

module.exports = {
    pattern: "weather",
    desc: "🌤 Get weather information for a location",
    react: "🌤",
    category: "other",
    filename: __filename,
    use: ".weather [city name]",

    execute: async (conn, message, m, { from, q, reply, sender }) => {
        // Plain text sender — no forwarded/channel tag, no view button.
        const sendMessageWithContext = async (text, quoted = message) => {
            return await conn.sendMessage(from, { text }, { quoted: quoted });
        };

        const box = (lines) =>
            `*●⏤꯭🌤 WEATHER𓂃ꜛ⸙*\n\n` +
            lines.map(l => `◇ ${l}`).join('\n') + `\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        try {
            if (!q) return await sendMessageWithContext(box(['❗ Please provide a city name.', '📌 *Usage:* `.weather [city name]`']));

            // React 🌤
            if (module.exports.react) {
                await conn.sendMessage(from, { react: { text: module.exports.react, key: message.key } });
            }

            const apiKey = '2d61a72574c11c4f36173b627f8cb177'; 
            const city = q;
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
            const response = await axios.get(url);
            const data = response.data;

            const weather = box([
                `🌍 *Location:* ${data.name}, ${data.sys.country}`,
                `🌡️ *Temperature:* ${data.main.temp}°C`,
                `🌡️ *Feels Like:* ${data.main.feels_like}°C`,
                `🌡️ *Min Temp:* ${data.main.temp_min}°C`,
                `🌡️ *Max Temp:* ${data.main.temp_max}°C`,
                `💧 *Humidity:* ${data.main.humidity}%`,
                `☁️ *Weather:* ${data.weather[0].main}`,
                `🌫️ *Description:* ${data.weather[0].description}`,
                `💨 *Wind Speed:* ${data.wind.speed} m/s`,
                `🔽 *Pressure:* ${data.main.pressure} hPa`,
            ]);
            return await sendMessageWithContext(weather);
        } catch (e) {
            console.log('Weather API error:', e.response?.status, e.response?.data || e.message);

            const status = e.response?.status;

            if (status === 404) {
                const suggestions = await findSimilarCities(city, apiKey);
                const lines = ['🚫 City not found. Please check the spelling and try again.'];
                if (suggestions.length) {
                    lines.push('', '💡 *Did you mean:*');
                    suggestions.forEach(s => lines.push(`▫️ ${s}`));
                }
                return await sendMessageWithContext(box(lines));
            }
            if (status === 401) {
                return await sendMessageWithContext(box([
                    '🔑 Weather API key is invalid or inactive.',
                    'Please get a new API key from openweathermap.org and update the bot.'
                ]));
            }
            if (status === 429) {
                return await sendMessageWithContext(box(['⏳ Weather API rate limit reached. Please try again in a bit.']));
            }
            if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
                return await sendMessageWithContext(box(['⌛ Weather service timed out. Please try again.']));
            }
            if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') {
                return await sendMessageWithContext(box(['🌐 Could not reach the weather service (network issue).']));
            }

            return await sendMessageWithContext(box([
                '⚠️ An error occurred while fetching the weather information.',
                `Details: ${e.response?.data?.message || e.message}`
            ]));
        }
    }
};
