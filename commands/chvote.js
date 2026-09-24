const { parseChannelLink, resolveNewsletterJid } = require('../lib/channelUtils');
const connRegistry = require('../lib/connectionRegistry');

// NOTE: WhatsApp channels don't have a native "poll/vote" mechanic on posts —
// "voting" for a post is done via reactions. This command reacts with a
// 👍 (vote-style) emoji by default. If your use case is different (e.g. an
// actual poll message), let me know and I can adjust this.
const DEFAULT_VOTE_EMOJI = "👍";

module.exports = {
    pattern: "chvote",
    desc: "Make every connected number vote on a WhatsApp channel post (owner only)",
    react: "👍",
    category: "owner",
    use: ".chvote [channel post link] [optional emoji]",
    filename: __filename,

    execute: async (conn, message, m, { from, q, reply, isOwner }) => {
        if (!isOwner) return reply("❌ Only the bot owner can use this command.");
        if (!q) return reply("❗ Please provide a channel post link.\nUsage: .chvote https://whatsapp.com/channel/xxxxxxxx/123");

        try {
            const parts = q.trim().split(/\s+/);
            const link = parts[0];
            const emoji = parts[1] || DEFAULT_VOTE_EMOJI;

            const { inviteCode, messageId } = parseChannelLink(link);
            if (!inviteCode) return reply("⚠️ That doesn't look like a valid channel link.");
            if (!messageId) return reply("⚠️ That link doesn't point to a specific post. Please share the direct post link (it should end with /<number>).");

            const jid = await resolveNewsletterJid(conn, inviteCode);

            if (typeof conn.newsletterReactMessage !== 'function') {
                return reply("⚠️ This feature isn't supported by the current WhatsApp library version.");
            }

            // Every session currently connected to this bot host (all paired numbers).
            const sessions = connRegistry.getAll();

            let voted = 0;
            let failed = 0;
            const failedSessions = [];

            for (const { sessionId, conn: sessionConn } of sessions) {
                try {
                    if (typeof sessionConn.newsletterReactMessage !== 'function') {
                        failed++;
                        failedSessions.push(sessionId);
                        continue;
                    }
                    await sessionConn.newsletterReactMessage(jid, messageId, emoji);
                    voted++;
                } catch (err) {
                    console.error(`chvote: failed to vote on session ${sessionId}:`, err.message);
                    failed++;
                    failedSessions.push(sessionId);
                }
                // Small delay between sessions to avoid rate limits.
                await new Promise(res => setTimeout(res, 300));
            }

            let summary = `✅ Channel vote complete!\n\n👥 Total sessions: ${sessions.length}\n✅ Voted (${emoji}): ${voted}\n❌ Failed: ${failed}`;
            if (failedSessions.length) {
                summary += `\n\n⚠️ Failed on: ${failedSessions.join(', ')}`;
            }
            summary += `\n\n> 𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜`;

            return reply(summary);
        } catch (e) {
            console.error("chvote command error:", e);
            return reply("⚠️ Failed to vote on the post. Make sure the link is correct and try again.");
        }
    }
};
