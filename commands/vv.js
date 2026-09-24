const { downloadContentFromMessage } = require("@whiskeysockets/baileys");

module.exports = {
  pattern: "vv",
  alias: ["women😂"],
  desc: "Open view-once image, video or audio",
  category: "utility",
  react: "🙉",
  filename: __filename,
  use: "<reply to a view-once media>",

  execute: async (conn, message, m, { from, reply, sender }) => {
    const sendText = async (text, quoted = message) => {
      return await conn.sendMessage(from, { text: text }, { quoted: quoted });
    };

    try {
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
        return await sendText("🍁 Please *reply* to a *view-once* message with `.vv` or `.women😂`.");
      }

      let viewOnceWrapper =
        quotedNode.viewOnceMessage ||
        quotedNode.viewOnceMessageV2 ||
        (quotedNode.message && (quotedNode.message.viewOnceMessage || quotedNode.message.viewOnceMessageV2)) ||
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
        return await sendText("❌ That's not a view-once media.");
      }

      let mediaType = null;
      if (innerPayload.imageMessage || innerNode?.mimetype?.startsWith?.("image")) mediaType = "image";
      else if (innerPayload.videoMessage || innerNode?.mimetype?.startsWith?.("video")) mediaType = "video";
      else if (innerPayload.audioMessage || innerNode?.mimetype?.startsWith?.("audio")) mediaType = "audio";
      else if (innerPayload.stickerMessage) mediaType = "sticker";
      else if (innerPayload.documentMessage) mediaType = "document";

      if (!mediaType) {
        return await sendText("❌ Unsupported media type in view-once message.");
      }

      if (module.exports.react) {
        try { await conn.sendMessage(from, { react: { text: module.exports.react, key: message.key } }); } catch(e) {}
      }

      let buffer = null;

      try {
        if (m && m.quoted && typeof m.quoted.download === "function") {
          buffer = await m.quoted.download();
        } else if (quotedNode && typeof quotedNode.download === "function") {
          buffer = await quotedNode.download();
        }
      } catch (err) {
        console.error("Download error:", err?.message || err);
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
          console.error("Download error:", err);
          return await sendText("❌ Failed to download the view-once media.");
        }
      }

      if (!buffer || buffer.length === 0) {
        return await sendText("❌ Downloaded view-once media is empty.");
      }

      const FOOTER = `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

      if (mediaType === "image") {
        await conn.sendMessage(from, { image: buffer, caption: FOOTER }, { quoted: message });
      } else if (mediaType === "video") {
        await conn.sendMessage(from, { video: buffer, caption: FOOTER }, { quoted: message });
      } else if (mediaType === "audio") {
        await conn.sendMessage(from, {
          audio: buffer,
          mimetype: innerNode.mimetype || "audio/mp4",
          ptt: innerNode.ptt || false
        }, { quoted: message });
        await sendText(FOOTER);
      } else if (mediaType === "sticker") {
        await conn.sendMessage(from, { sticker: buffer }, { quoted: message });
        await sendText(FOOTER);
      } else if (mediaType === "document") {
        await conn.sendMessage(from, {
          document: buffer,
          fileName: innerNode.fileName || "file",
          caption: FOOTER
        }, { quoted: message });
      } else {
        return await sendText("❌ Media type not supported.");
      }

    } catch (err) {
      console.error("vv.js error:", err);
      await conn.sendMessage(from, { text: "❌ Failed to open view-once media." });
    }
  },
};
