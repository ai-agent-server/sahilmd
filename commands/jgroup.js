const { parseGroupInviteLink } = require('../lib/channelUtils');
const connRegistry = require('../lib/connectionRegistry');

const DEFAULT_DELAY_MS = 300;
const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 10000;
const MAX_RETRIES = 2; // extra attempts after the first try

module.exports = {
    pattern: "jgroup",
    desc: "Force connected numbers to join or leave a WhatsApp group by invite link, with retry, delay and random session-count control (owner only)",
    react: "👥",
    category: "owner",
    use:
        ".jgroup <group invite link> [count] [delay:500]\n" +
        ".jgroup leave <group invite link> [count] [delay:500]",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, reply, isOwner }) => {
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
                `*●⏤꯭👥 JGROUP𓂃ꜛ⸙*\n\n` +
                `${body}\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

            await conn.sendMessage(from, { text: caption }, { quoted: mek });
        };

        // React first, same as runtime.js
        await conn.sendMessage(from, { react: { text: '👥', key: mek.key } });

        if (!isOwner) return send(['Error: ❌ Only the bot owner can use this command.']);
        if (!q) {
            return send([
                'Error: ❗ Please provide a group invite link.',
                'Example:\n   .jgroup https://chat.whatsapp.com/xxxxxxxx',
                'Join with only some sessions (random count):\n   .jgroup link 3',
                'Custom delay between sessions (ms):\n   .jgroup link delay:500',
                'Leave (cancel) a joined group:\n   .jgroup leave link'
            ]);
        }

        try {
            const tokens = q.trim().split(/\s+/);

            let leaveMode = false;
            let idx = 0;
            if (tokens[idx] && tokens[idx].toLowerCase() === 'leave') {
                leaveMode = true;
                idx++;
            }

            const linkArg = tokens[idx];
            idx++;
            if (!linkArg) return send(['Error: ❌ Please provide a group invite link.']);

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

            const code = parseGroupInviteLink(linkArg);
            if (!code) return send(['Error: ⚠️ That doesn\'t look like a valid group invite link.']);

            // Resolve the invite once (also gives us the group's display name).
            let inviteInfo;
            try {
                inviteInfo = await conn.groupGetInviteInfo(code);
            } catch (e) {
                console.error('jgroup: failed to resolve invite info:', e.message);
            }
            const jid = inviteInfo?.id || null;
            const groupName = inviteInfo?.subject || 'Unknown Group';

            if (leaveMode && !jid) {
                return send(['Error: ⚠️ Could not resolve the group from this link, so it can\'t be left.']);
            }

            // Every session currently connected to this bot host (all paired numbers).
            let sessions = connRegistry.getAll();
            if (!sessions.length) {
                return send(['Error: ⚠️ No sessions are currently connected.']);
            }

            // If a count is given, randomly pick that many sessions instead of
            // always using the same first N — looks more natural / less bot-like.
            if (count && count > 0 && count < sessions.length) {
                sessions = [...sessions].sort(() => Math.random() - 0.5).slice(0, count);
            }

            let done = 0;
            let alreadyDone = 0; // already in group (join) / already not in group (leave)
            let failed = 0;
            let totalRetries = 0;
            const failedSessions = [];

            for (const { sessionId, conn: sessionConn } of sessions) {
                let success = false;
                let lastErr = null;
                let skippedAsAlready = false;

                for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        if (leaveMode) {
                            if (typeof sessionConn.groupLeave !== 'function') {
                                lastErr = new Error('no leave method on this session');
                                break;
                            }
                            await sessionConn.groupLeave(jid);
                        } else {
                            if (typeof sessionConn.groupAcceptInvite !== 'function') {
                                lastErr = new Error('no join method on this session');
                                break;
                            }
                            await sessionConn.groupAcceptInvite(code);
                        }
                        success = true;
                        if (attempt > 0) totalRetries += attempt;
                        break;
                    } catch (err) {
                        lastErr = err;
                        if (!leaveMode && (err?.data === 409 || /already/i.test(err?.message || ""))) {
                            skippedAsAlready = true;
                            break; // already in group, no point retrying
                        }
                        if (leaveMode && /not.*(a )?participant|not in group|404/i.test(err?.message || "")) {
                            skippedAsAlready = true;
                            break; // already not in group
                        }
                        if (attempt < MAX_RETRIES) {
                            await new Promise(res => setTimeout(res, delayMs));
                        }
                    }
                }

                if (skippedAsAlready) {
                    alreadyDone++;
                } else if (success) {
                    done++;
                } else {
                    failed++;
                    const reason = lastErr?.data === 401 ? 'not authorized / blocked by group'
                        : lastErr?.data === 404 ? 'invite not found'
                        : lastErr?.data === 410 ? 'invite expired or revoked'
                        : lastErr?.data === 429 ? 'rate limited, try again later'
                        : (lastErr?.message || 'unknown error');
                    console.error(`jgroup: failed to ${leaveMode ? 'leave' : 'join'} on session ${sessionId}:`, lastErr);
                    failedSessions.push(`${sessionId} (${reason})`);
                }

                await new Promise(res => setTimeout(res, delayMs));
            }

            const lines = [
                `Result: ✅ Group ${leaveMode ? 'leave' : 'join'} complete!`,
                `Group: ${groupName}`,
                `Sessions Used: ${sessions.length}`,
                `${leaveMode ? 'Left' : 'Joined'}: ${done}`,
                `Already ${leaveMode ? 'Not In Group' : 'In Group'}: ${alreadyDone}`,
                `Failed: ${failed}`
            ];
            if (totalRetries > 0) lines.push(`Retries Used: ${totalRetries}`);
            if (failedSessions.length) {
                lines.push(`Failed On:\n${failedSessions.map(f => `   • ${f}`).join('\n')}`);
            }

            return send(lines);
        } catch (e) {
            console.error("jgroup command error:", e);
            let msg = 'Error: ⚠️ Failed to process the group. Make sure the link is correct and still valid.';
            if (e?.data === 410 || /revoked|expired/i.test(e?.message || "")) {
                msg = 'Error: ⚠️ This invite link has expired or been revoked.';
            }
            return send([msg]);
        }
    }
};
