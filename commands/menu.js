const axios = require("axios");
const { getMode } = require("../lib/botMode");

// Random menu audio links
const MENU_AUDIOS = [
  "https://files.catbox.moe/3v72ah.ogg",
  "https://files.catbox.moe/i1bgyu.ogg",
  "https://files.catbox.moe/628r8d.opus",
  "https://files.catbox.moe/qq5n5t.opus"
];

const MENU_IMAGE = "https://files.catbox.moe/j6rpyx.jpg";

function runtime(seconds) {
  seconds = Number(seconds);
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  let str = "";
  if (d > 0) str += d + (d === 1 ? " day, " : " days, ");
  if (h > 0) str += h + (h === 1 ? " hour, " : " hours, ");
  if (m > 0) str += m + (m === 1 ? " minute, " : " minutes, ");
  str += s + (s === 1 ? " second" : " seconds");
  return str;
}

function getRandomAudio() {
  return MENU_AUDIOS[Math.floor(Math.random() * MENU_AUDIOS.length)];
}

module.exports = {
  pattern: "menu",
  alias: ["help", "list", "commands"],
  desc: "Show bot menu with random audio",
  category: "main",
  react: "📋",
  filename: __filename,
  async execute(conn, message, match, { from, pushName, isCreator }) {
    try {
      const mode = getMode ? getMode() : "public";
      const uptime = process.uptime();
      const ownerName = process.env.OWNER_NAME || "ZAINU";
      const prefix = process.env.PREFIX || ".";
      const botName = process.env.BOT_NAME || "ZAINU-MD 🔥⚜️";

      // Approximate command count (can be dynamic if needed)
      const cmdCount = 83;

      const menuText = `*╭─═━━━ 🌟 ZAINU-MD 🌟 ━━━═─╮*
│
*│ 👤 ᴏᴡɴᴇʀ: ${ownerName}*
*│ ⚙️ ᴘʀᴇғɪx: ${prefix}*
*│ ⏱️ ᴜᴘᴛɪᴍᴇ: ${runtime(uptime)}*
*│ 📊 ᴄᴏᴍᴍᴀɴᴅs: ${cmdCount}*
*│ 🛡️ ᴍᴏᴅᴇ: ${mode}*
*│ 🏷️ ᴠᴇʀsɪᴏɴ: 1.0.0*
│
*╰─═━━━━━━━━━━━━━━═─╯*

*╭─═━━━ ⚡ ᴏᴡɴᴇʀ ━━━═─╮*
*│ ✦ .vv2*
*│ ✦ .vv*
*╰─═━━━━━━━━━━━━━━═─╯*

*╭─═━━━ ⚡ ᴀᴜᴅɪᴏ ━━━═─╮*
*│ ✦ .deep*
*│ ✦ .smooth*
*│ ✦ .fat*
*│ ✦ .tupai*
*│ ✦ .blown*
*│ ✦ .radio*
*│ ✦ .robot*
*│ ✦ .chipmunk*
*│ ✦ .nightcore*
*│ ✦ .earrape*
*│ ✦ .bass*
*│ ✦ .reverse*
*│ ✦ .slow*
*│ ✦ .fast*
*│ ✦ .baby*
*│ ✦ .demon*
*╰─═━━━━━━━━━━━━━━═─╯*

*╭─═━━━ ⚡ ᴜᴛɪʟɪᴛʏ ━━━═─╮*
*│ ✦ .uptime*
*│ ✦ .url*
*│ ✦ .url2*
*│ ✦ .url3*
*╰─═━━━━━━━━━━━━━━═─╯*

*╭─═━━━ ⚡ ᴅᴏᴡɴʟᴏᴀᴅ ━━━═─╮*
*│ ✦ .fb*
*│ ✦ .igdl*
*│ ✦ .tiktok*
*│ ✦ .ig7*
*│ ✦ .twitter*
*│ ✦ .mediafire*
*│ ✦ .apk*
*│ ✦ .gdrive*
*│ ✦ .terabox*
*│ ✦ .drama*
*│ ✦ .video*
*│ ✦ .insta*
*│ ✦ .ytmp3*
*│ ✦ .ytmp4*
*╰─═━━━━━━━━━━━━━━═─╯*

*╭─═━━━ ⚡ ɢʀᴏᴜᴘ ━━━═─╮*
*│ ✦ .add*
*│ ✦ .hidetag*
*│ ✦ .tagall*
*│ ✦ .kick*
*│ ✦ .promote*
*│ ✦ .demote*
*╰─═━━━━━━━━━━━━━━═─╯*

*╭─═━━━ ⚡ ᴍᴀɪɴ ━━━═─╮*
*│ ✦ .menu*
*│ ✦ .owner*
*│ ✦ .ping*
*│ ✦ .ping2*
*│ ✦ .runtime*
*╰─═━━━━━━━━━━━━━━═─╯*

*╭─═━━━ ⚡ sᴇᴛᴛɪɴɢs ━━━═─╮*
*│ ✦ .welcome*
*│ ✦ .goodbye*
*│ ✦ .antidelete*
*│ ✦ .statusview*
*│ ✦ .autoreact*
*│ ✦ .anticall*
*│ ✦ .antilink*
*│ ✦ .mode*
*│ ✦ .prefix*
*│ ✦ .botname*
*│ ✦ .ownername*
*│ ✦ .settings*
*╰─═━━━━━━━━━━━━━━═─╯*

*╭─═━━━ ⚡ ᴍᴏᴅᴇʀᴀᴛɪᴏɴ ━━━═─╮*
*│ ✦ .ban*
*│ ✦ .unban*
*│ ✦ .sudo*
*╰─═━━━━━━━━━━━━━━═─╯*

> *© POWERED BY ZAINU-MD 🔥⚜️*`;

      // Send image + caption
      try {
        await conn.sendMessage(from, {
          image: { url: MENU_IMAGE },
          caption: menuText
        }, { quoted: message });
      } catch (imgErr) {
        // fallback text only
        await conn.sendMessage(from, { text: menuText }, { quoted: message });
      }

      // Send random audio every time
      try {
        const audioUrl = getRandomAudio();
        await conn.sendMessage(from, {
          audio: { url: audioUrl },
          mimetype: "audio/mpeg",
          ptt: true
        }, { quoted: message });
      } catch (audioErr) {
        console.log("Menu audio send failed:", audioErr.message);
      }

    } catch (e) {
      console.error("Menu error:", e);
      await conn.sendMessage(from, { text: "❌ Menu error: " + e.message }, { quoted: message });
    }
  }
};
