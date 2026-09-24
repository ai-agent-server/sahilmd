// commands/url.js
const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const os = require("os");
const path = require("path");

function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Catbox alone was returning HTTP 412 (a common response when it blocks
// datacenter/VPS IPs or requests missing a browser-like User-Agent). We now
// send a proper User-Agent, and if Catbox still rejects it, fall back to two
// other free file hosts so `.url` still works.
async function uploadFile(filePath, fileName) {
  const uploaders = [
    {
      name: "catbox",
      run: async () => {
        const form = new FormData();
        form.append("fileToUpload", fs.createReadStream(filePath));
        form.append("reqtype", "fileupload");
        const res = await axios.post("https://catbox.moe/user/api.php", form, {
          headers: {
            ...form.getHeaders(),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
          },
          timeout: 30000
        });
        const url = typeof res.data === "string" ? res.data.trim() : "";
        if (!url.startsWith("http")) throw new Error("Unexpected Catbox response");
        return url;
      }
    },
    {
      name: "0x0.st",
      run: async () => {
        const form = new FormData();
        form.append("file", fs.createReadStream(filePath), fileName);
        const res = await axios.post("https://0x0.st", form, {
          headers: {
            ...form.getHeaders(),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
          },
          timeout: 30000
        });
        const url = typeof res.data === "string" ? res.data.trim() : "";
        if (!url.startsWith("http")) throw new Error("Unexpected 0x0.st response");
        return url;
      }
    },
    {
      name: "tmpfiles",
      run: async () => {
        const form = new FormData();
        form.append("file", fs.createReadStream(filePath), fileName);
        const res = await axios.post("https://tmpfiles.org/api/v1/upload", form, {
          headers: form.getHeaders(),
          timeout: 30000
        });
        const rawUrl = res.data?.data?.url;
        if (!rawUrl) throw new Error("Unexpected tmpfiles.org response");
        // tmpfiles gives a landing-page URL; insert /dl/ for the direct link.
        return rawUrl.replace("tmpfiles.org/", "tmpfiles.org/dl/");
      }
    }
  ];

  let lastError = null;
  for (const uploader of uploaders) {
    try {
      return { url: await uploader.run(), host: uploader.name };
    } catch (e) {
      lastError = e;
      console.error(`URL upload (${uploader.name}) failed:`, e.response?.status || e.message);
    }
  }
  throw lastError || new Error("All upload hosts failed");
}

module.exports = {
  pattern: "url",
  desc: "Convert media (image/video/audio/document) into a direct download URL",
  react: "🖇",
  category: "utility",
  filename: __filename,
  use: ".url [reply to media or send media with caption]",

  execute: async (conn, message, m, { from }) => {
    const box = (lines) =>
      `*●⏤꯭🖇 URL𓂃ꜛ⸙*\n\n` +
      lines.map(l => `*├⬗ ${l}*`).join('\n') + `\n\n` +
      `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

    const sendBox = async (lines) =>
      conn.sendMessage(from, { text: box(lines) }, { quoted: message });

    let tempFilePath = null;
    try {
      // 1) Use replied message if exists, otherwise the current message
      const quotedMsg =
        message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const target = quotedMsg || message.message;

      if (!target) {
        return await sendBox(['❌ Please reply to an audio, video, image, or document with `.url`']);
      }

      // 2) Detect media type & node
      let mediaNode = null;
      let mediaType = null;
      if (target.imageMessage) { mediaNode = target.imageMessage; mediaType = "image"; }
      else if (target.videoMessage) { mediaNode = target.videoMessage; mediaType = "video"; }
      else if (target.audioMessage) { mediaNode = target.audioMessage; mediaType = "audio"; }
      else if (target.documentMessage) { mediaNode = target.documentMessage; mediaType = "document"; }
      else {
        return await sendBox(['❌ Please reply to an audio, video, image, or document with `.url`']);
      }

      // 3) React
      if (module.exports.react) {
        try { await conn.sendMessage(from, { react: { text: module.exports.react, key: message.key } }); } catch {}
      }

      // 4) Download media
      let buffer;
      try {
        const stream = await downloadContentFromMessage(mediaNode, mediaType);
        let _buf = Buffer.from([]);
        for await (const chunk of stream) _buf = Buffer.concat([_buf, chunk]);
        buffer = _buf;
      } catch (e) {
        console.error("Download error:", e);
        return await sendBox(['❌ Failed to download media. Try replying to a valid file.']);
      }

      if (!buffer || buffer.length === 0) {
        return await sendBox(['❌ Downloaded media is empty or too large.']);
      }

      // 5) Extension
      let extension = "";
      if (mediaType === "image") extension = ".jpg";
      else if (mediaType === "video") extension = ".mp4";
      else if (mediaType === "audio") extension = ".mp3";
      else if (mediaType === "document") {
        const fileName = mediaNode.fileName || "";
        extension = path.extname(fileName) || ".bin";
      }

      const fileName = `catbox_upload_${Date.now()}${extension}`;
      tempFilePath = path.join(os.tmpdir(), fileName);
      fs.writeFileSync(tempFilePath, buffer);

      // 6) Upload (tries Catbox, then falls back automatically if it fails)
      const { url: uploadedUrl } = await uploadFile(tempFilePath, fileName);

      // 7) Reply with result
      await sendBox([
        `Result: ✅ ${mediaType.toUpperCase()} Uploaded Successfully`,
        `Size: ${formatBytes(buffer.length)}`,
        `URL: ${uploadedUrl}`
      ]);
    } catch (err) {
      console.error("URL execution error:", err);
      await sendBox([`⚠️ Error: ${err.message || "Failed to process media"}`]);
    } finally {
      if (tempFilePath) {
        try { fs.unlinkSync(tempFilePath); } catch {}
      }
    }
  },
};
