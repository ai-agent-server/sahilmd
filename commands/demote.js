// === demote.js ===
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { checkBotAdmin } = require('../lib/botAdmin');
const groupMetaCache = require('../lib/groupMetadataCache');

module.exports = {
  pattern: "demote",
  alias: ["dismiss"],
  desc: "Demote an admin to member (Admin/Owner Only)",
  category: "group",
  react: "⬇️",
  filename: __filename,
  use: ".demote @user OR reply to a user",

  execute: async (conn, message, m, { from, q, isGroup, reply, sender, isEnvOwner }) => {
    const send = async (lines) => {
      const caption =
        `*●⏤꯭⬇️ DEMOTE𓂃ꜛ⸙*\n\n` +
        lines.map(l => `*├⬗ ${l}*`).join('\n') + `\n\n` +
        `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;
      await conn.sendMessage(from, { text: caption }, { quoted: message });
    };

    try {
      if (!isGroup) return send(['Error: ❌ This command can only be used in groups.']);

      let metadata;
      try {
        metadata = await groupMetaCache.getGroupMetadata(conn, from);
      } catch {
        return send(['Error: ❌ Failed to get group info.']);
      }

      // WhatsApp groups sometimes list participants using a privacy "@lid" address
      // instead of the real phone-number JID (or vice-versa). `sender` (resolved via
      // participantAlt) and `m.sender` (raw, as seen in the group) can therefore be
      // in different formats — check both against the group's participant list.
      const candidates = [m.sender, sender]
        .filter(Boolean)
        .map(j => jidNormalizedUser(j));
      const candidateNums = candidates.map(j => j.split('@')[0]);

      const participant = metadata.participants.find(p => {
        const pid = jidNormalizedUser(p.id);
        return candidates.includes(pid) || candidateNums.includes(pid.split('@')[0]);
      });
      const isAdmin = participant?.admin === "admin" || participant?.admin === "superadmin";
      if (!isAdmin && !isEnvOwner) return send(['Error: ❌ Only admins can use this command.']);

      const botCheck = await checkBotAdmin(conn, from, metadata);
      if (!botCheck.isAdmin) {
        return send(['Error: ❌ I am not an admin in this group.', 'Please make me an admin first, then try again.']);
      }

      // ".demote all" — demote every current admin (except the bot itself and the
      // group creator, since the creator/"superadmin" can't be demoted via API).
      if ((q || '').trim().toLowerCase() === 'all') {
        const botBase = jidNormalizedUser(conn.user.id).split('@')[0];
        const targets = metadata.participants
          .filter(p => p.admin === 'admin')
          .map(p => p.id)
          .filter(id => jidNormalizedUser(id).split('@')[0] !== botBase);

        if (targets.length === 0) return send(['Result: ℹ️ There are no admins to demote right now.']);

        await conn.groupParticipantsUpdate(from, targets, "demote");
        return send([`Result: ✅ Demoted ${targets.length} admin(s) successfully.`]);
      }

      // Find target: mention > reply
      let target = null;
      if (m.mentionedJid && m.mentionedJid.length > 0) {
        target = m.mentionedJid[0];
      } else if (m.quoted) {
        target = m.quoted.sender;
      }

      if (!target) return send(['Error: ❌ Mention or reply to a user to demote.']);

      await conn.groupParticipantsUpdate(from, [target], "demote");
      return send(['Result: ✅ User demoted from admin successfully.']);

    } catch (e) {
      console.error("Demote error:", e);
      return send(['Error: ⚠️ Failed to demote user.']);
    }
  }
};
