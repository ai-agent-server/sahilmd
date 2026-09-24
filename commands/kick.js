const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { checkBotAdmin } = require('../lib/botAdmin');

module.exports = {
    pattern: "kick",
    alias: ["remove"],
    desc: "Kick a member from the group",
    react: "👢",
    category: "admin",
    use: ".kick <number> OR @user OR reply to message",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, isAdmin, isEnvOwner, reply }) => {
        const send = async (lines) => {
            const caption =
                `*●⏤꯭👢 KICK𓂃ꜛ⸙*\n\n` +
                lines.map(l => `*├⬗ ${l}*`).join('\n') + `\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;
            await conn.sendMessage(from, { text: caption }, { quoted: mek });
        };

        if (!from.endsWith('@g.us')) return send(['Error: ❌ This command can only be used in groups.']);
        if (!isAdmin && !isEnvOwner) return send(['Error: ❌ Only admin can use this command.']);

        // Confirm the bot is actually admin (checking both JID and LID forms)
        // before attempting anything, so a stale/mismatched identifier can't
        // silently make a real admin look like a non-admin.
        const botCheck = await checkBotAdmin(conn, from);
        if (!botCheck.metadata) return send(['Error: ❌ Failed to get group info.']);
        if (!botCheck.isAdmin) {
            return send(['Error: ❌ I am not an admin in this group.', 'Please make me an admin first, then try again.']);
        }

        await conn.sendMessage(from, { react: { text: '👢', key: mek.key } });

        // ".kick all" — remove every regular (non-admin) member, excluding the bot
        // itself and the person running the command.
        if ((q || '').trim().toLowerCase() === 'all') {
            const metadata = botCheck.metadata;

            const botBase = jidNormalizedUser(conn.user.id).split('@')[0];
            const senderCandidates = [m.sender, mek.key.participantAlt, mek.key.participant]
                .filter(Boolean)
                .map(j => jidNormalizedUser(j).split('@')[0]);

            const targets = metadata.participants
                .filter(p => p.admin !== 'admin' && p.admin !== 'superadmin')
                .map(p => p.id)
                .filter(id => {
                    const num = jidNormalizedUser(id).split('@')[0];
                    return num !== botBase && !senderCandidates.includes(num);
                });

            if (targets.length === 0) return send(['Result: ℹ️ There are no regular members to kick right now.']);

            try {
                await conn.groupParticipantsUpdate(from, targets, "remove");
                return send([`Result: ✅ Kicked ${targets.length} member(s) successfully.`]);
            } catch (e) {
                console.error('kick: failed to remove participants (all):', e.message);
                const reason = e?.data?.reason || e?.output?.payload?.message || e?.message || 'Unknown error';
                return send(['Error: ⚠️ Failed to kick members.', `Reason: ${reason}`]);
            }
        }

        // Target priority: typed number > tagged mention > replied message
        let target = null;
        const digits = (q || '').replace(/\D/g, "");
        if (digits.length >= 8) {
            target = `${digits}@s.whatsapp.net`;
        } else {
            target = mek.message?.extendedTextMessage?.contextInfo?.participant ||
                mek.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
                (m.mentionedJid && m.mentionedJid[0]) ||
                (m.quoted && m.quoted.sender);
        }

        if (!target) return send(['Error: ❌ Please provide a number, tag someone, or reply to a message to kick.']);

        target = jidNormalizedUser(target);

        // The kicker's own jid + display name.
        const kickerJid = jidNormalizedUser(mek.key.fromMe ? conn.user.id : mek.key.participant || mek.key.remoteJid);
        const kickerName = mek.pushName || 'Unknown';

        // Try to resolve the target's display name from group metadata / contact.
        let targetName = 'Unknown';
        try {
            const p = botCheck.metadata.participants.find(p => jidNormalizedUser(p.id) === target);
            targetName = p?.notify || p?.name || conn.getName?.(target) || 'Unknown';
        } catch (e) {
            console.error('kick: failed to look up target name:', e.message);
        }

        // Newer WhatsApp/Baileys sometimes gives a privacy "@lid" address
        // instead of the real phone-number JID — resolve it if possible.
        let realTarget = target;
        if (realTarget.endsWith('@lid')) {
            try {
                const [result] = await conn.onWhatsApp(realTarget);
                if (result?.jid) realTarget = jidNormalizedUser(result.jid);
            } catch (e) {
                console.error('kick: failed to resolve @lid to a real number:', e.message);
            }
        }

        try {
            await conn.groupParticipantsUpdate(from, [realTarget], "remove");
            return send([
                'Result: ✅ User kicked successfully.'
            ]);
        } catch (e) {
            console.error('kick: failed to remove participant:', e.message);
            const reason = e?.data?.reason || e?.output?.payload?.message || e?.message || 'Unknown error';
            return send(['Error: ⚠️ Failed to kick user.', `Reason: ${reason}`]);
        }
    }
};
