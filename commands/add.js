const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { checkBotAdmin } = require('../lib/botAdmin');

module.exports = {
    pattern: "add",
    desc: "Add a member to the group by phone number, or by tagging/replying to them",
    react: "➕",
    category: "admin",
    use: ".add <number> OR reply/tag a user",
    filename: __filename,

    execute: async (conn, mek, m, { from, q, isAdmin, isEnvOwner, reply }) => {
        const send = async (lines) => {
            const caption =
                `*●⏤꯭➕ ADD𓂃ꜛ⸙*\n\n` +
                lines.map(l => `*├⬗ ${l}*`).join('\n') + `\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;
            await conn.sendMessage(from, { text: caption }, { quoted: mek });
        };

        if (!from.endsWith('@g.us')) return send(['Error: ❌ This command can only be used in groups.']);
        if (!isAdmin && !isEnvOwner) return send(['Error: ❌ Only admin can use this command.']);

        // Figure out the target: typed number > tagged mention > replied message
        let digits = (q || '').replace(/\D/g, "");

        if (!digits) {
            let mentionedTarget =
                mek.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
                (m.mentionedJid && m.mentionedJid[0]) ||
                mek.message?.extendedTextMessage?.contextInfo?.participant ||
                (m.quoted && m.quoted.sender);

            if (mentionedTarget) {
                mentionedTarget = jidNormalizedUser(mentionedTarget);

                // Resolve a privacy "@lid" address to the real phone-number JID if needed.
                if (mentionedTarget.endsWith('@lid')) {
                    try {
                        const [result] = await conn.onWhatsApp(mentionedTarget);
                        if (result?.jid) mentionedTarget = jidNormalizedUser(result.jid);
                    } catch (e) {
                        console.error('add: failed to resolve @lid to a real number:', e.message);
                    }
                }

                digits = mentionedTarget.split('@')[0];
            }
        }

        if (!digits) return send(['Error: ❌ Please provide a number, tag, or reply to a user.', 'Usage: .add 923001234567']);
        if (digits.length < 8) return send(['Error: ❌ Invalid number. Use full international format, e.g. .add 923001234567']);

        const target = jidNormalizedUser(`${digits}@s.whatsapp.net`);

        await conn.sendMessage(from, { react: { text: '➕', key: mek.key } });

        const adderJid = mek.key.fromMe ? conn.user.id : (mek.key.participant || mek.key.remoteJid);
        const adderName = mek.pushName || 'Unknown';
        const adderDigits = (adderJid || '').split('@')[0].split(':')[0];

        // Confirm the bot itself is still recognized as admin right before the
        // API call — checking both JID and LID forms, since WhatsApp can list
        // the bot under either depending on the group/session.
        const botCheck = await checkBotAdmin(conn, from);
        if (!botCheck.metadata) {
            return send(['Error: ❌ Failed to get group info.']);
        }
        if (!botCheck.isAdmin) {
            return send(['Error: ❌ I am not an admin in this group.', 'Please make me an admin first, then try again.']);
        }

        // Confirm the number actually exists on WhatsApp before attempting to add
        try {
            const [check] = await conn.onWhatsApp(target);
            if (!check?.exists) {
                return send([`Error: ❌ +${digits} is not a valid WhatsApp number.`]);
            }
        } catch (e) {
            console.error("Add: onWhatsApp check failed:", e.message);
        }

        // Sends a group invite link to the target's DM — used as a fallback
        // whenever a direct add fails or isn't accepted by WhatsApp.
        const sendInviteFallback = async () => {
            try {
                const code = await conn.groupInviteCode(from);
                const link = `https://chat.whatsapp.com/${code}`;
                const groupName = botCheck.metadata?.subject || 'the group';
                await conn.sendMessage(target, {
                    text: `You were invited to join *${groupName}*.\n\n${link}`
                });
                return true;
            } catch (e) {
                console.error('Add: invite-link fallback failed:', e.message);
                return false;
            }
        };

        try {
            const result = await conn.groupParticipantsUpdate(from, [target], "add");

            const status = result?.[0]?.status;
            if (status === "200" || status === 200) {
                return send([
                    'Result: ✅ User added successfully.'
                ]);
            } else if (status === "403" || status === 403) {
                const sent = await sendInviteFallback();
                return send(sent
                    ? [`Result: ⚠️ Couldn't add +${digits} directly (privacy settings).`, '📩 An invite link was sent to their DM instead.']
                    : [`Result: ⚠️ Couldn't add +${digits} directly (privacy settings).`, 'An invite link may be needed instead, but sending it also failed.']);
            } else if (status === "408" || status === 408) {
                const sent = await sendInviteFallback();
                return send(sent
                    ? [`Result: ⚠️ +${digits} didn't respond to the add request (timeout).`, '📩 An invite link was sent to their DM as a backup.']
                    : [`Result: ⚠️ +${digits} didn't respond to the add request (timeout).`]);
            } else if (status === "409" || status === 409) {
                return send([`Result: ℹ️ +${digits} is already in the group.`]);
            } else {
                const sent = await sendInviteFallback();
                return send(sent
                    ? [`Result: ⚠️ Couldn't add +${digits} directly (status: ${status}).`, '📩 An invite link was sent to their DM instead.']
                    : [`Result: ❌ Failed to add +${digits} (status: ${status}).`, 'They may have restricted who can add them, or the number is invalid.']);
            }
        } catch (e) {
            console.error("Add error:", e);
            // WhatsApp frequently rejects direct adds outright (rate limits,
            // the number not being a contact, etc.) and Baileys surfaces that
            // as a generic thrown error rather than a clean status code — so
            // fall back to an invite link instead of just reporting failure.
            const sent = await sendInviteFallback();
            const reason = e?.data?.reason || e?.output?.payload?.message || e?.message || 'Unknown error';
            return send(sent
                ? [`Result: ⚠️ Couldn't add +${digits} directly.`, `Reason: ${reason}`, '📩 An invite link was sent to their DM instead.']
                : ['Error: ⚠️ Failed to add user.', `Reason: ${reason}`, 'Sending an invite link also failed — they may have invite links restricted too.']);
        }
    }
};
