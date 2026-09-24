const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const activityTracker = require('../lib/activityTracker');
const groupMetaCache = require('../lib/groupMetadataCache');

const DEFAULT_INACTIVE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = {
    pattern: "kickoffline",
    desc: "Kick members who have been inactive/offline for N days (default 3)",
    react: "🚪",
    category: "admin",
    use: ".kickoffline on [days] OR .kickoffline off",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, isAdmin, isEnvOwner, reply }) => {
        const box = (lines) =>
            `*●⏤꯭🚪 KICK-OFFLINE𓂃ꜛ⸙*\n\n` +
            lines.map(l => `*├⬗* ${l}`).join('\n') + `\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        const send = async (lines) => {
            try {
                await conn.sendMessage(from, { text: box(lines) }, { quoted: mek });
            } catch (e) {
                console.error('kickoffline: failed to send reply:', e.message);
            }
        };

        try {
            if (!from.endsWith('@g.us')) return send(['❌ This command only works in groups.']);
            if (!isAdmin && !isEnvOwner) return send(['❌ Only admins can use this command.']);

            try {
                await conn.sendMessage(from, { react: { text: '🚪', key: mek.key } });
            } catch (e) {
                console.error('kickoffline: react failed:', e.message);
            }

            const action = args?.[0]?.toLowerCase();

            if (action === 'on') {
                const days = Number(args?.[1]) > 0 ? Number(args[1]) : DEFAULT_INACTIVE_DAYS;
                const cutoff = Date.now() - days * DAY_MS;

                let metadata;
                try {
                    metadata = await groupMetaCache.getGroupMetadata(conn, from);
                } catch (e) {
                    return send([`❌ Failed to get group info: ${e.message}`]);
                }

                const botId = jidNormalizedUser(conn.user.id);
                const botParticipant = metadata.participants.find(p => jidNormalizedUser(p.id) === botId);
                const botIsAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

                if (!botIsAdmin) {
                    return send(['❌ I need to be an admin to kick members.']);
                }

                await send([
                    `⏳ Checking members inactive for ${days}+ day(s)...`
                ]);

                // Exclude the bot itself and all current admins from being kicked.
                const candidates = metadata.participants.filter(p => {
                    const pid = jidNormalizedUser(p.id);
                    if (pid === botId) return false;
                    if (p.admin === 'admin' || p.admin === 'superadmin') return false;
                    return true;
                });

                const toKick = [];
                const unknown = [];

                for (const p of candidates) {
                    const pid = jidNormalizedUser(p.id);
                    const lastActive = activityTracker.getLastActive(from, pid);
                    if (lastActive === null) {
                        // No record of them ever messaging since tracking began —
                        // we can't be sure they're offline 3+ days, so skip them
                        // to avoid wrongly kicking someone who just never spoke.
                        unknown.push(pid);
                    } else if (lastActive < cutoff) {
                        toKick.push(p.id);
                    }
                }

                if (toKick.length === 0) {
                    const note = unknown.length
                        ? [`Result: ℹ️ No tracked-inactive members found for ${days}+ day(s).`,
                           `Note: ${unknown.length} member(s) have no activity history yet (skipped for safety) — they'll be eligible once tracked as inactive.`]
                        : [`Result: ℹ️ No members have been inactive for ${days}+ day(s).`];
                    return send(note);
                }

                try {
                    await conn.groupParticipantsUpdate(from, toKick, "remove");
                    const lines = [`Result: ✅ Kicked ${toKick.length} member(s) inactive for ${days}+ day(s).`];
                    if (unknown.length) {
                        lines.push(`Note: ${unknown.length} member(s) skipped — no activity history yet.`);
                    }
                    return send(lines);
                } catch (e) {
                    console.error('kickoffline: failed to remove participants:', e.message);
                    return send([`❌ Failed to kick some/all members: ${e.message}`]);
                }

            } else if (action === 'off') {
                return send(['❌ *Kick-Offline check cancelled.*']);
            } else {
                return send([
                    '❌ *Usage:*',
                    '`.kickoffline on` — kick members offline 3+ days',
                    '`.kickoffline on 5` — kick members offline 5+ days',
                    '`.kickoffline off` — cancel'
                ]);
            }
        } catch (e) {
            console.error('kickoffline: unexpected error:', e);
            return send([`❌ Unexpected error: ${e.message}`]);
        }
    }
};
