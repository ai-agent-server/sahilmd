module.exports = {
    pattern: "accept",
    desc: "Accept all pending group join requests",
    react: "✅",
    category: "admin",
    use: ".accept",
    filename: __filename,

    execute: async (conn, mek, m, { from, isAdmin, reply }) => {
        if (!from.endsWith('@g.us')) {
            return reply(
                `*●⏤꯭✅ ACCEPT𓂃ꜛ⸙*\n\n` +
                `*├⬗ Error:* ❌ This command can only be used in groups.\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
            );
        }
        if (!isAdmin) return;

        try {
            const response = await conn.groupRequestParticipantsList(from);
            if (!response || response.length === 0) {
                return reply(
                    `*●⏤꯭✅ ACCEPT𓂃ꜛ⸙*\n\n` +
                    `*├⬗ Result:* No pending join requests found in this group.\n\n` +
                    `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
                );
            }

            let acceptedCount = 0;
            for (const participant of response) {
                try {
                    await conn.groupRequestParticipantsUpdate(from, [participant.jid], 'approve');
                    acceptedCount++;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (err) {
                    console.error(`Failed to accept ${participant.jid}:`, err.message);
                }
            }

            await reply(
                `*●⏤꯭✅ ACCEPT𓂃ꜛ⸙*\n\n` +
                `*├⬗ Result:* Successfully accepted *${acceptedCount}* pending requests.\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`
            );
        } catch (e) {
            console.error('Accept command error:', e);
        }
    }
};
