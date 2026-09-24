const { parseChannelLink } = require('../lib/channelUtils');
const connRegistry = require('../lib/connectionRegistry');

const DEFAULT_DELAY_MS = 300;
const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 10000;
const MAX_RETRIES = 2; // extra attempts after the first try

// Baileys newsletter metadata exposes viewer_metadata.view_role for the
// requesting session — 'GUEST' (or missing) means that session does not
// currently follow the channel.
function isFollowing(meta) {
    const role = meta?.viewer_metadata?.view_role;
    return !!role && role !== 'GUEST';
}

module.exports = {
    pattern: "chf",
    desc: "Follow/unfollow a WhatsApp channel across connected sessions, or check follow status — with retry, delay and session-count control (owner only)",
    react: "📢",
    category: "owner",
    use:
        ".chf <channel link> [count] [delay:500]\n" +
        ".chf remove <channel link> [count] [delay:500]\n" +
        ".chf status <channel link> [count]",
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
                `*●⏤꯭📢 CHF𓂃ꜛ⸙*\n\n` +
                `${body}\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;
            return reply(caption);
        };

        if (!isOwner) return send(['Error: ❌ Only the bot owner can use this command.']);
        if (!q) {
            return send([
                'Error: ❌ Please provide a channel link!',
                'Example:\n   .chf https://whatsapp.com/channel/0029VbBVJhu5q08bUyXc663a',
                'How many sessions (session count):\n   .chf link 3',
                'Custom delay between sessions (ms):\n   .chf link delay:500',
                'Unfollow a channel:\n   .chf remove link',
                'Check follow status (no action taken):\n   .chf status link'
            ]);
        }

        try {
            const tokens = q.trim().split(/\s+/);

            let mode = 'follow'; // 'follow' | 'remove' | 'status'
            let idx = 0;
            if (tokens[idx] && tokens[idx].toLowerCase() === 'remove') {
                mode = 'remove';
                idx++;
            } else if (tokens[idx] && tokens[idx].toLowerCase() === 'status') {
                mode = 'status';
                idx++;
            }

            const linkArg = tokens[idx];
            idx++;
            if (!linkArg) return send(['Error: ❌ Please provide a channel link!']);

            let count = null;
            let delayMs = DEFAULT_DELAY_MS;
            for (; idx < tokens.length; idx++) {
                const tok = tokens[idx];
                if (/^delay:/i.test(tok)) {
                    const val = parseInt(tok.split(':')[1], 10);
                    if (!isNaN(val)) delayMs = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, val));
                } else if (/^\d+$/.test(tok)) {
                    count = parseInt(tok, 10);
                }
            }

            const { inviteCode } = parseChannelLink(linkArg);
            if (!inviteCode) {
                return send([
                    'Error: ⚠️ Not a valid channel link.',
                    'Example:\n   .chf https://whatsapp.com/channel/0029VbBVJhu5q08bUyXc663a'
                ]);
            }

            // Resolve the channel once (also gives us its display name).
            let meta;
            try {
                meta = await conn.newsletterMetadata('invite', inviteCode);
            } catch (e) {
                return send(['Error: ⚠️ Could not resolve this channel. Double-check the link.']);
            }
            if (!meta || !meta.id) {
                return send(['Error: ⚠️ Could not resolve this channel. Double-check the link.']);
            }
            const jid = meta.id;
            const channelName = meta.name || 'Unknown Channel';

            const needsMethod = mode === 'remove' ? 'newsletterUnfollow' : 'newsletterFollow';
            if (mode !== 'status' && typeof conn[needsMethod] !== 'function') {
                return send(['Error: ⚠️ This feature isn\'t supported by the current WhatsApp library version.']);
            }
            if (typeof conn.newsletterMetadata !== 'function') {
                return send(['Error: ⚠️ This feature isn\'t supported by the current WhatsApp library version.']);
            }

            let sessions = connRegistry.getAll();
            if (!sessions.length) {
                return send(['Error: ⚠️ No sessions are currently connected.']);
            }
            if (count && count > 0 && count < sessions.length) {
                sessions = sessions.slice(0, count);
            }

            // ── STATUS MODE ──────────────────────────────────────────────
            if (mode === 'status') {
                const followingList = [];
                const notFollowingList = [];
                const errorList = [];

                for (const { sessionId, conn: sessionConn } of sessions) {
                    try {
                        const sMeta = await sessionConn.newsletterMetadata('jid', jid);
                        if (isFollowing(sMeta)) followingList.push(sessionId);
                        else notFollowingList.push(sessionId);
                    } catch (err) {
                        console.error(`chf status: failed on session ${sessionId}:`, err);
                        errorList.push(`${sessionId} (${err?.message || 'unknown error'})`);
                    }
                    await new Promise(res => setTimeout(res, delayMs));
                }

                const lines = [
                    'Result: ✅ Status check complete!',
                    `Channel: ${channelName}`,
                    `Sessions Checked: ${sessions.length}`,
                    `Following: ${followingList.length}`,
                    `Not Following: ${notFollowingList.length}`
                ];
                if (followingList.length) lines.push(`Following On:\n${followingList.map(s => `   • ${s}`).join('\n')}`);
                if (notFollowingList.length) lines.push(`Not Following On:\n${notFollowingList.map(s => `   • ${s}`).join('\n')}`);
                if (errorList.length) lines.push(`Check Failed On:\n${errorList.map(s => `   • ${s}`).join('\n')}`);

                return send(lines);
            }

            // ── FOLLOW / REMOVE MODE ─────────────────────────────────────
            const removeMode = mode === 'remove';
            let done = 0;
            let alreadyDone = 0; // already following (follow mode) / already not following (remove mode)
            let failed = 0;
            let totalRetries = 0;
            const failedSessions = [];

            for (const { sessionId, conn: sessionConn } of sessions) {
                // Check current status first so we don't redundantly call follow/unfollow.
                try {
                    const sMeta = await sessionConn.newsletterMetadata('jid', jid);
                    const currentlyFollowing = isFollowing(sMeta);
                    if (removeMode && !currentlyFollowing) {
                        alreadyDone++;
                        await new Promise(res => setTimeout(res, delayMs));
                        continue;
                    }
                    if (!removeMode && currentlyFollowing) {
                        alreadyDone++;
                        await new Promise(res => setTimeout(res, delayMs));
                        continue;
                    }
                } catch (err) {
                    // If the status check itself fails, fall through and just
                    // attempt the follow/unfollow call directly.
                    console.error(`chf: status pre-check failed on session ${sessionId}:`, err.message);
                }

                let success = false;
                let lastErr = null;

                for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                    if (typeof sessionConn[needsMethod] !== 'function') {
                        lastErr = new Error(`no ${removeMode ? 'unfollow' : 'follow'} method on this session`);
                        break;
                    }
                    try {
                        await sessionConn[needsMethod](jid);
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
                    done++;
                } else {
                    failed++;
                    console.error(`chf: failed to ${removeMode ? 'unfollow' : 'follow'} on session ${sessionId}:`, lastErr);
                    failedSessions.push(`${sessionId} (${lastErr?.message || 'unknown error'})`);
                }

                await new Promise(res => setTimeout(res, delayMs));
            }

            const lines = [
                `Result: ✅ Channel ${removeMode ? 'unfollow' : 'follow'} complete!`,
                `Channel: ${channelName}`,
                `Sessions Used: ${sessions.length}`,
                `${removeMode ? 'Unfollowed' : 'Followed'}: ${done}`,
                `Already ${removeMode ? 'Not Following' : 'Following'}: ${alreadyDone}`,
                `Failed: ${failed}`
            ];
            if (totalRetries > 0) lines.push(`Retries Used: ${totalRetries}`);
            if (failedSessions.length) {
                lines.push(`Failed On:\n${failedSessions.map(f => `   • ${f}`).join('\n')}`);
            }

            return send(lines);
        } catch (e) {
            console.error("chf command error:", e);
            return send(['Error: ⚠️ Failed to update the channel follow status. Make sure the link is correct and try again.']);
        }
    }
};
