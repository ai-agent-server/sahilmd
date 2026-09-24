// === runtime.js ===
const fs = require('fs');
const path = require('path');
const { getBannerBuffer } = require('./../lib/bannerCache');

const startTime = Date.now();

function getUptime() {
  const uptime = Date.now() - startTime;
  const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
  const hours = Math.floor((uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((uptime % (1000 * 60)) / 1000);

  return { days, hours, minutes, seconds, totalMs: uptime };
}

function getRuntimeCommand() {
  return {
    pattern: "runtime",
    category: "utility",
    desc: "Show bot uptime",
    react: "🕐",
    filename: __filename,
    use: ".runtime",

    execute: async (conn, message, m, { from, reply }) => {
      try {
        const uptime = getUptime();
        const uptimeStr = `${uptime.days}d ${uptime.hours}h ${uptime.minutes}m ${uptime.seconds}s`;

        // React first
        await conn.sendMessage(from, {
          react: { text: "🕐", key: message.key }
        });

        const caption =
          `*●⏤꯭🕐 RUNTIME𓂃ꜛ⸙*\n\n` +
          `*├⬗ Uptime:* ${uptimeStr}\n` +
          `*├⬗ Started:* ${new Date(startTime).toLocaleString()}\n\n` +
          `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        const imageBuffer = getBannerBuffer();

        if (imageBuffer) {
          await conn.sendMessage(from, {
            image: imageBuffer,
            caption
          }, { quoted: message });
        } else {
          await conn.sendMessage(from, { text: caption }, { quoted: message });
        }

      } catch (e) {
        console.error("Runtime error:", e);
        await conn.sendMessage(from, {
          react: { text: "❌", key: message.key }
        });
        await conn.sendMessage(from, { text: "⚠️ Failed to fetch runtime info." }, { quoted: message });
      }
    }
  };
}

module.exports = {
  getUptime,
  getRuntimeCommand
};
