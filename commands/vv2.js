const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

module.exports = {
  pattern: "vv2",
  alias: ["❤️", "?"],
  desc: "Open view-once & send directly to user inbox ❤️",
  category: "utility",
  filename: __filename,
  use: "<reply to a view-once media>",

  execute: async (conn, message, m, { from, sender }) => {

    // ── Helper: plain text reply to the chat ────────────────────────────
    const reply = async (text) => {
      return conn.sendMessage(from, { text }, { quoted: message });
    };

    // ── Footer text appended below the media ────────────────────────────
    const FOOTER = `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

    // ── Helper: plain media send — footer caption, no other context/quote ──
    const sendMedia = async (destination, mediaType, buffer, innerNode) => {
      if (mediaType === "image") {
        await conn.sendMessage(destination, { image: buffer, caption: FOOTER });
      } else if (mediaType === "video") {
        await conn.sendMessage(destination, { video: buffer, caption: FOOTER });
      } else if (mediaType === "audio") {
        await conn.sendMessage(destination, {
          audio: buffer,
          mimetype: innerNode.mimetype || "audio/mp4",
          ptt: innerNode.ptt || false,
        });
        await conn.sendMessage(destination, { text: FOOTER });
      } else if (mediaType === "sticker") {
        await conn.sendMessage(destination, { sticker: buffer });
        await conn.sendMessage(destination, { text: FOOTER });
      } else if (mediaType === "document") {
        await conn.sendMessage(destination, {
          document: buffer,
          fileName: innerNode.fileName || "file",
          caption: FOOTER
        });
      }
    };

    try {
      // ── 1. Resolve quoted node ──────────────────────────────────────────
      let quotedNode = null;

      if (m && m.quoted) {
        if (m.quoted.message && m.quoted.message.message) {
          quotedNode = m.quoted.message.message;
        } else if (m.quoted.message) {
          quotedNode = m.quoted.message;
        } else {
          quotedNode = m.quoted;
        }
      } else if (message?.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        quotedNode = message.message.extendedTextMessage.contextInfo.quotedMessage;
      } else if (message?.quoted) {
        quotedNode = message.quoted;
      }

      if (!quotedNode) {
        return await reply("🍁 Please *reply* to a *view-once* message with `.vv2`, `.❤️`, or `.?`.");
      }

      // ── 2. Unwrap view-once wrapper ─────────────────────────────────────
      let viewOnceWrapper =
        quotedNode.viewOnceMessage ||
        quotedNode.viewOnceMessageV2 ||
        (quotedNode.message &&
          (quotedNode.message.viewOnceMessage || quotedNode.message.viewOnceMessageV2)) ||
        null;

      let innerPayload = null;
      if (viewOnceWrapper) innerPayload = viewOnceWrapper.message || viewOnceWrapper;
      else innerPayload = quotedNode.message || quotedNode;

      const innerNode =
        innerPayload.imageMessage ||
        innerPayload.videoMessage ||
        innerPayload.audioMessage ||
        innerPayload.stickerMessage ||
        innerPayload.documentMessage ||
        null;

      if (!innerNode) {
        return await reply("❌ That's not a view-once media. Reply to a view-once image or video.");
      }

      // ── 3. Detect media type ────────────────────────────────────────────
      let mediaType = null;
      if (innerPayload.imageMessage || innerNode?.mimetype?.startsWith?.("image")) mediaType = "image";
      else if (innerPayload.videoMessage || innerNode?.mimetype?.startsWith?.("video")) mediaType = "video";
      else if (innerPayload.audioMessage || innerNode?.mimetype?.startsWith?.("audio")) mediaType = "audio";
      else if (innerPayload.stickerMessage) mediaType = "sticker";
      else if (innerPayload.documentMessage) mediaType = "document";

      if (!mediaType) {
        return await reply("❌ Unsupported media type in view-once message.");
      }

      // ── 5. Download the media ──────────────────────────────────────────
      let buffer = null;

      try {
        if (m && m.quoted && typeof m.quoted.download === "function") {
          buffer = await m.quoted.download();
        } else if (quotedNode && typeof quotedNode.download === "function") {
          buffer = await quotedNode.download();
        }
      } catch (err) {
        console.error("vv2 download error (method-1):", err?.message || err);
      }

      if (!buffer) {
        try {
          const stream = await downloadContentFromMessage(innerNode, mediaType);
          let tmp = Buffer.from([]);
          for await (const chunk of stream) {
            tmp = Buffer.concat([tmp, chunk]);
          }
          buffer = tmp;
        } catch (err) {
          console.error("vv2 download error (method-2):", err);
          return await reply("❌ Failed to download the view-once media. It may have expired.");
        }
      }

      if (!buffer || buffer.length === 0) {
        return await reply("❌ Downloaded view-once media is empty or expired.");
      }

      // ── 6. Normalise JIDs ───────────────────────────────────────────────
      const normalise = (jid) => {
        if (!jid) return null;
        const bare = jid.split(":")[0];
        const domain = jid.includes("@") ? "@" + jid.split("@")[1] : "@s.whatsapp.net";
        return bare + domain;
      };

      const senderJid = normalise(sender);
      const botJid = normalise(conn.user?.id || conn.user?.jid || null);

      let sentOk = false;

      // ── 7. Send clean media to user's DM ───────────────────────────────
      if (senderJid) {
        try {
          await sendMedia(senderJid, mediaType, buffer, innerNode);
          console.log(`📩 vv2: sent to user inbox → ${senderJid}`);
          sentOk = true;
        } catch (err) {
          console.error("vv2: failed to send to user inbox:", err?.message || err);
        }
      }

      // ── 8. Send clean media to bot's inbox ─────────────────────────────
      if (botJid && botJid !== senderJid) {
        try {
          await sendMedia(botJid, mediaType, buffer, innerNode);
          console.log(`📩 vv2: sent to bot inbox → ${botJid}`);
        } catch (err) {
          console.error("vv2: failed to send to bot inbox:", err?.message || err);
        }
      }

      // ── 9. (no chat confirmation/error sent) ────────────────────────────

    } catch (err) {
      console.error("vv2.js error:", err);
      try {
        await conn.sendMessage(from, { text: "❌ An error occurred while processing the view-once media: " + (err?.message || "unknown error") }, { quoted: message });
      } catch (e) {
        console.error("vv2.js: failed to even send the error message:", e);
      }
    }
  },
};
