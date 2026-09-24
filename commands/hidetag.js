// === hidetag.js ===
const groupMetaCache = require('../lib/groupMetadataCache');

module.exports = {
  pattern: "hidetag",
  desc: "Silently tag all members without resending/duplicating any message content",
  category: "group",
  use: ".hidetag [message] or reply to a message",
  filename: __filename,

  execute: async (conn, message, m, { q, reply, from, isGroup }) => {
    try {
      if (!isGroup) return reply("❌ This command can only be used in groups.");

      // --- fetch group metadata ---
      let metadata;
      try {
        metadata = await groupMetaCache.getGroupMetadata(conn, from);
      } catch {
        return reply("❌ Failed to get group information.");
      }

      // --- mentions list ---
      const participants = metadata.participants.map(p => p.id);

      if (!q && !m.quoted) return reply("❌ Provide a message or reply to a message.");

      // React 👀
      await conn.sendMessage(from, { react: { text: "👀", key: message.key } });

      // If this is a reply, quote the ORIGINAL message natively (a real
      // WhatsApp reply just links to it — it does not resend/duplicate its
      // content, unlike the old "forward" behaviour which created a visible
      // "Forwarded" copy of it).
      const quotedTarget = m.quoted?.fakeObj || message;

      // Text to send: whatever the admin typed after .hidetag. If they only
      // replied with no extra text, there's nothing new to broadcast, so we
      // send an invisible marker instead of re-posting the original
      // message's content again.
      const textToSend = q && q.trim() ? q : "\u200E";

      return await conn.sendMessage(
        from,
        { text: textToSend, mentions: participants },
        { quoted: quotedTarget }
      );

    } catch (e) {
      console.error("Hidetag error:", e);
      try { await conn.sendMessage(from, { react: { text: "❌", key: message.key } }); } catch {}
      reply(`⚠️ Failed to send hidetag.\n\n${e.message}`);
    }
  }
};