const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
const { videoToWebp, imageToWebp } = require('../lib/video-utils');
const { Sticker, StickerTypes } = require("wa-sticker-formatter");

const WATERMARK = "© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx";

// ── Build SVG buffer for text sticker ────────────────────────────────────
function makeTextSVG(text) {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const len = text.length;
  const fontSize = len > 25 ? 36 : len > 15 ? 48 : len > 8 ? 62 : 78;

  // Split into two lines if too long
  const words = esc.split(" ");
  let line1 = "", line2 = "";
  if (words.length > 1 && len > 12) {
    const mid = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(" ");
    line2 = words.slice(mid).join(" ");
  } else {
    line1 = esc;
  }

  const y1 = line2 ? "220" : "256";
  const y2 = "290";

  return Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f0c29"/>
      <stop offset="50%" style="stop-color:#302b63"/>
      <stop offset="100%" style="stop-color:#24243e"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)" rx="40"/>
  <text x="256" y="${y1}" font-family="Arial Black,sans-serif" font-size="${fontSize}"
        font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle"
        style="filter:drop-shadow(2px 2px 4px #000)">${line1}</text>
  ${line2 ? `<text x="256" y="${y2}" font-family="Arial Black,sans-serif" font-size="${fontSize}"
        font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle"
        style="filter:drop-shadow(2px 2px 4px #000)">${line2}</text>` : ""}
  <text x="256" y="478" font-family="Arial,sans-serif" font-size="19"
        fill="#aaaaaa" text-anchor="middle">${WATERMARK}</text>
</svg>`);
}

module.exports = {
  pattern: "s",
  alias: ["sticker"],
  desc: "Convert media to sticker OR make text sticker",
  category: "sticker",
  react: "🎨",
  filename: __filename,
  use: "<reply to media> [name]  OR  .s <text>",

  execute: async (conn, message, m, { from, q, reply }) => {
    const sendText = async (text, quoted = message) =>
      conn.sendMessage(from, { text }, { quoted });

    try {
      const quotedMsg  = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const directMsg  = message.message;

      let mediaNode = null, mediaType = null, downloadSource = null;

      const detectMedia = (node) => {
        if (!node) return false;
        if (node.imageMessage)   { mediaNode = node.imageMessage;   mediaType = "image";   downloadSource = node.imageMessage;   return true; }
        if (node.videoMessage)   { mediaNode = node.videoMessage;   mediaType = "video";   downloadSource = node.videoMessage;   return true; }
        if (node.stickerMessage) { mediaNode = node.stickerMessage; mediaType = "sticker"; downloadSource = node.stickerMessage; return true; }
        return false;
      };

      const hasMedia = detectMedia(quotedMsg) || detectMedia(directMsg);

      // ── React ─────────────────────────────────────────────────────────
      try {
        await conn.sendMessage(from, { react: { text: "🎨", key: message.key } });
      } catch (e) {}

      // ════════════════════════════════════════════════════════════════════
      // MODE A: Text sticker — no media replied & user gave text
      // ════════════════════════════════════════════════════════════════════
      if (!hasMedia && q && q.trim()) {
        const text = q.trim();
        try {
          const svgBuf = makeTextSVG(text);
          const sticker = new Sticker(svgBuf, {
            pack: "",
            author: WATERMARK,
            type: StickerTypes.FULL,
            quality: 80,
          });
          const out = await sticker.toBuffer();
          return await conn.sendMessage(from, { sticker: out }, { quoted: message });
        } catch (e) {
          console.error("sticker: text SVG error:", e);
          return await sendText("❌ Text sticker banana fail ho gaya.");
        }
      }

      // ════════════════════════════════════════════════════════════════════
      // MODE B: Media → sticker (with optional custom name as author)
      // ════════════════════════════════════════════════════════════════════
      if (!hasMedia) {
        return await sendText(
          `*Usage:*\n` +
          `▸ Reply to image/video + *.s* → media sticker\n` +
          `▸ *.s Hello World* → text sticker\n` +
          `▸ *.s [name]* while replying → custom watermark`
        );
      }

      // Author = custom name if given, else default watermark
      const authorName = q && q.trim() ? q.trim() : WATERMARK;

      // ── Download ───────────────────────────────────────────────────────
      let buffer = null;

      try {
        if (m?.quoted && typeof m.quoted.download === "function") {
          buffer = await m.quoted.download();
        }
      } catch (e) {}

      if (!buffer || buffer.length === 0) {
        try {
          const stream = await downloadContentFromMessage(downloadSource, mediaType);
          let tmp = Buffer.from([]);
          for await (const chunk of stream) tmp = Buffer.concat([tmp, chunk]);
          buffer = tmp;
        } catch (e) {
          return await sendText("❌ Media download fail ho gayi.");
        }
      }

      if (!buffer || buffer.length === 0)
        return await sendText("❌ Downloaded media empty hai.");

      // ── Re-wrap existing sticker ───────────────────────────────────────
      if (mediaType === "sticker") {
        try {
          const sticker = new Sticker(buffer, {
            pack: "", author: authorName,
            type: StickerTypes.FULL, quality: 75,
          });
          const out = await sticker.toBuffer();
          return await conn.sendMessage(from, { sticker: out }, { quoted: message });
        } catch (e) {
          return await conn.sendMessage(from, { sticker: buffer }, { quoted: message });
        }
      }

      // ── Convert image / video → WebP ───────────────────────────────────
      let webpBuffer = null;
      try {
        webpBuffer = mediaType === "image"
          ? await imageToWebp(buffer)
          : await videoToWebp(buffer);
      } catch (e) {
        return await sendText("❌ FFmpeg conversion fail ho gayi. FFmpeg installed hai?");
      }

      if (!webpBuffer || webpBuffer.length === 0)
        return await sendText("❌ Conversion output empty hai.");

      // ── Build final sticker with watermark ─────────────────────────────
      try {
        const sticker = new Sticker(webpBuffer, {
          pack: "",
          author: authorName,
          type: StickerTypes.FULL,
          quality: 75,
          background: "transparent",
        });
        const out = await sticker.toBuffer();
        await conn.sendMessage(from, { sticker: out }, { quoted: message });
      } catch (e) {
        await conn.sendMessage(from, { sticker: webpBuffer }, { quoted: message });
      }

    } catch (err) {
      console.error("sticker.js error:", err);
      await sendText("❌ Sticker conversion fail ho gayi.");
    }
  }
};
