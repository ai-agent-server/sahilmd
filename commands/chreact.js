const { parseChannelLink, resolveNewsletterJid } = require('../lib/channelUtils');
const connRegistry = require('../lib/connectionRegistry');

// Pool used when no emoji is given — each connected session gets a
// different one (cycling through the list if there are more sessions than emojis).
const REACT_POOL = ['❤️', '🔥', '😍', '👍', '🎉', '😂', '😮', '👏', '💯', '✨', '🙌', '💪', '😎', '🥳', '💜', '💙'];

const DEFAULT_DELAY_MS = 300;
const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 10000;
const MAX_RETRIES = 2; // extra attempts after the first try

module.exports = {
    pattern: "chreact",
    desc: "Make connected numbers react to (or remove reacts from) a WhatsApp channel post, with multi-post, custom/multiple emoji, delay, retry and react-count support (owner only)",
    react: "😍",
    category: "owner",
    use:
        ".chreact <link1,link2,...> [emoji1,emoji2,...,delay] [count]\n" +
        ".chreact remove <link1,link2,...>",
    filename: __filename,

    execute: async (conn, message, m, { from, q, reply, isOwner }) => {
        const send = async (lines) => {
            const body = lines.map(l => {
                const idx = l.indexOf(':');
                if (idx !== -1) {
                    const label = l.slice(0, idx + 1);
                    const rest = l.slice(idx + 1);
                    return `*├⬗ ${label}*${rest}`;
                }
                return `├⬗ ${l}`;
            }).join('\n');

            const caption =
                `*●⏤꯭😍 CHREACT𓂃ꜛ⸙*\n\n` +
                `${body}\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;
            return reply(caption);
        };

        if (!isOwner) return send(['Error: ❌ Only the bot owner can use this command.']);
        if (!q) {
            return send([
                'Error: ❌ Please provide a channel post URL!',
                'Example:\n   .chreact https://whatsapp.com/channel/0029VbBVJhu5q08bUyXc663a/129',
                'With a fixed emoji (single or multiple):\n   .chreact link ❤️,👍🏻,🔥',
                'Multiple posts at once:\n   .chreact link1,link2',
                'Custom delay between sessions (ms):\n   .chreact link 🔥,500',
                'How many reacts you want (session count):\n   .chreact link 🔥,500 3',
                'Remove reacts:\n   .chreact remove link',
                'Combine any of the above, e.g.:\n   .chreact link1,link2 ❤️,👍🏻,🔥,500 3'
            ]);
        }

        try {
            // Tokenize the whole argument string.
            let tokens = q.trim().split(/\s+/);

            // Merge tokens where a token starts with a comma into the previous
            // token — handles stray spaces typed before a comma, e.g. "🔥 ,500".
            const merged = [];
            for (const t of tokens) {
                if (t.startsWith(',') && merged.length) {
                    merged[merged.length - 1] += t;
                } else {
                    merged.push(t);
                }
            }
            tokens = merged;

            let idx = 0;
            let removeMode = false;
            if (tokens[idx] && tokens[idx].toLowerCase() === 'remove') {
                removeMode = true;
                idx++;
            }

            const linkArgRaw = tokens[idx];
            idx++;
            if (!linkArgRaw) return send(['Error: ❌ Please provide a channel post URL!']);

            // Next token (if any, and not remove-mode-only) may hold emoji(s) and/or a delay,
            // comma separated: numeric pieces = delay in ms, everything else = an emoji.
            let fixedEmojis = [];
            let delayMs = DEFAULT_DELAY_MS;
            if (tokens[idx] && !/^\d+$/.test(tokens[idx])) {
                const parts = tokens[idx].split(',').map(p => p.trim()).filter(Boolean);
                for (const p of parts) {
                    if (/^\d+$/.test(p)) {
                        delayMs = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, parseInt(p, 10)));
                    } else {
                        fixedEmojis.push(p);
                    }
                }
                idx++;
            } else if (tokens[idx] && /^\d+$/.test(tokens[idx])) {
                // A lone number right after the link with nothing else — treat as delay.
                delayMs = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, parseInt(tokens[idx], 10)));
                idx++;
            }

            // Final optional token: how many sessions/reacts are wanted.
            let count = null;
            if (tokens[idx] && /^\d+$/.test(tokens[idx])) {
                count = parseInt(tokens[idx], 10);
                idx++;
            }

            // Parse all post links (comma-separated).
            const links = linkArgRaw.split(',').map(l => l.trim()).filter(Boolean);
            if (!links.length) return send(['Error: ⚠️ No valid links provided.']);

            const posts = [];
            for (const link of links) {
                const { inviteCode, messageId } = parseChannelLink(link);
                if (!inviteCode) {
                    return send([
                        `Error: ⚠️ Not a valid channel link.\n   ${link}`,
                        'Example of a valid link:\n   .chreact https://whatsapp.com/channel/0029VbBVJhu5q08bUyXc663a/129'
                    ]);
                }
                if (!messageId) {
                    return send([
                        `Error: ⚠️ That's a channel link, not a specific post.\n   ${link}`,
                        'You need the direct post link (it must end with /<number>).',
                        'Example:\n   .chreact https://whatsapp.com/channel/0029VbBVJhu5q08bUyXc663a/129',
                        'Tip: open the post inside the channel, tap the ⋮ menu, then "Copy link".'
                    ]);
                }
                let jid;
                try {
                    jid = await resolveNewsletterJid(conn, inviteCode);
                } catch (e) {
                    return send([`Error: ⚠️ Could not resolve channel for: ${link}`]);
                }
                posts.push({ link, jid, messageId });
            }

            if (typeof conn.newsletterReactMessage !== 'function') {
                return send(['Error: ⚠️ This feature isn\'t supported by the current WhatsApp library version.']);
            }

            // Every session currently connected to this bot host (all paired numbers),
            // optionally capped to the requested count.
            let sessions = connRegistry.getAll();
            if (!sessions.length) {
                return send(['Error: ⚠️ No sessions are currently connected.']);
            }
            if (count && count > 0 && count < sessions.length) {
                sessions = sessions.slice(0, count);
            }

            let totalReacted = 0;
            let totalFailed = 0;
            let totalRetries = 0;
            const failedEntries = [];
            const usedEmojis = new Set();

            for (const post of posts) {
                // Emoji source per session: the given fixed list (cycled) if provided,
                // otherwise a shuffled default pool.
                const pool = fixedEmojis.length
                    ? fixedEmojis
                    : [...REACT_POOL].sort(() => Math.random() - 0.5);

                for (let s = 0; s < sessions.length; s++) {
                    const { sessionId, conn: sessionConn } = sessions[s];
                    const emoji = removeMode ? '' : pool[s % pool.length];

                    let success = false;
                    let lastErr = null;

                    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                        if (typeof sessionConn.newsletterReactMessage !== 'function') {
                            lastErr = new Error('no react method on this session');
                            break; // no point retrying, method doesn't exist
                        }
                        try {
                            await sessionConn.newsletterReactMessage(post.jid, post.messageId, emoji);
                            success = true;
                            if (attempt > 0) totalRetries += attempt;
                            break;
                        } catch (err) {
                            lastErr = err;
                            if (attempt < MAX_RETRIES) {
                                await new Promise(res => setTimeout(res, delayMs));
                            }
                        }
                    }

                    if (success) {
                        totalReacted++;
                        if (!removeMode) usedEmojis.add(emoji);
                    } else {
                        totalFailed++;
                        console.error(`chreact: failed on session ${sessionId} for ${post.link}:`, lastErr);
                        failedEntries.push(`${sessionId} → ${post.link.slice(0, 40)} (${lastErr?.message || 'unknown error'})`);
                    }

                    await new Promise(res => setTimeout(res, delayMs));
                }
            }

            const lines = [
                `Result: ✅ ${removeMode ? 'React removal' : 'Channel react'} complete!`,
                `Posts: ${posts.length}`,
                `Sessions Used: ${sessions.length}`,
                `${removeMode ? 'Removed' : 'Reacted'}: ${totalReacted}`,
                `Failed: ${totalFailed}`
            ];
            if (totalRetries > 0) lines.push(`Retries Used: ${totalRetries}`);
            if (!removeMode && usedEmojis.size) {
                lines.push(`Emojis Used: ${[...usedEmojis].join(' ')}`);
            }
            if (failedEntries.length) {
                lines.push(`Failed On:\n${failedEntries.map(f => `   • ${f}`).join('\n')}`);
            }

            return send(lines);
        } catch (e) {
            console.error("chreact command error:", e);
            return send(['Error: ⚠️ Something went wrong. Make sure the link(s) are correct and try again.']);
        }
    }
};
