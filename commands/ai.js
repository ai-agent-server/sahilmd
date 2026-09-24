const fs = require('fs');
const path = require('path');
const axios = require('axios');

const CONFIG_PATH = path.join(__dirname, '../data/ai.json');

// config shape: { enabled: bool }
function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { enabled: false };
        return { enabled: false, ...JSON.parse(fs.readFileSync(CONFIG_PATH)) };
    } catch { return { enabled: false }; }
}

function saveConfig(config) {
    try {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) { console.error('AI save error:', e); }
}

// ── Exported helper used by server.js ────────────────────────────────────
function isAiEnabled() { return loadConfig().enabled === true; }

// Shared AI-question caller — used by both `.ai <question>` and the
// auto-reply hook in server.js, so there's one place to fix if the upstream
// API's response shape changes or the endpoint goes down.
async function askAI(question) {
    const res = await axios.get('https://api.dreaded.site/api/chatgpt', {
        params: { text: question },
        timeout: 20000,
    });
    const data = res.data;
    // The free dreaded.site endpoint has changed its response shape more
    // than once in the past; check every field it's known to use instead
    // of assuming just `.result`, so a shape change doesn't silently break
    // this into "no response from AI" every time.
    const answer =
        (typeof data === 'string' && data) ||
        data?.result ||
        data?.result?.prompt ||
        data?.message ||
        data?.response ||
        data?.data;
    if (!answer) throw new Error('AI service returned an empty/unrecognized response');
    return answer;
}

const box = (title, lines) =>
    `*●⏤꯭🤖 ${title}𓂃ꜛ⸙*\n\n` +
    lines.map(l => `*├⬗* ${l}`).join('\n') + `\n\n` +
    `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

module.exports = {
    pattern: "ai",
    desc: "Ask AI a question or toggle AI auto-reply",
    react: "🤖",
    category: "utility",
    use: ".ai [on/off] or .ai <question>",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, q, isOwner, reply }) => {
        try {
            await conn.sendMessage(from, { react: { text: "🤖", key: mek.key } });

            const action = args[0]?.toLowerCase();

            if (action === 'on') {
                if (!isOwner) return reply(box('AI', ['❌ Only the bot owner can toggle AI auto-reply.']));
                saveConfig({ enabled: true });
                return reply(box('AI', [
                    '✅ *AI Auto-Reply: ON*',
                    'DMs that aren\'t commands will now get an AI reply.'
                ]));
            }

            if (action === 'off') {
                if (!isOwner) return reply(box('AI', ['❌ Only the bot owner can toggle AI auto-reply.']));
                saveConfig({ enabled: false });
                return reply(box('AI', ['❌ *AI Auto-Reply: OFF*']));
            }

            if (action === 'status') {
                return reply(box('AI', [`Auto-Reply: ${isAiEnabled() ? '✅ ON' : '❌ OFF'}`]));
            }

            if (q) {
                try {
                    const answer = await askAI(q);
                    return reply(box('AI RESPONSE', [answer]));
                } catch (apiErr) {
                    console.error('AI Command API Error:', apiErr.message);
                    return reply(box('AI', [`❌ Couldn't reach the AI service: ${apiErr.message}`]));
                }
            }

            return reply(box('AI', [
                'Commands:',
                '.ai on/off — Toggle Auto-Reply',
                '.ai status — View status',
                '.ai <question> — Ask AI'
            ]));

        } catch (e) {
            console.error("AI Command Error:", e.message);
            return reply(box('AI', [`❌ Error: ${e.message}`]));
        }
    },

    isAiEnabled,
    askAI,
    box,
};
