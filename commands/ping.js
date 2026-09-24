const fs = require('fs');
const path = require('path');
const { getUptime } = require('./runtime');
const { getBannerBuffer } = require('../lib/bannerCache');

module.exports = {
    pattern: "ping",
    desc: "Check bot response speed",
    react: "⚡",
    category: "utility",
    use: ".ping",
    filename: __filename,

    execute: async (conn, mek, m, { from, reply }) => {
        // React with key emoji (same style as pair.js)
        if (module.exports.react) {
            await conn.sendMessage(from, { react: { text: module.exports.react, key: mek.key } });
        }

        // Real latency: time between when WhatsApp says the message arrived
        // and now, when we've finished processing it.
        const sentAt = mek.messageTimestamp ? Number(mek.messageTimestamp) * 1000 : Date.now();
        const speedMs = Date.now() - sentAt;

        const uptime = getUptime();
        const uptimeStr = `${uptime.days}d ${uptime.hours}h ${uptime.minutes}m ${uptime.seconds}s`;

        const BOT_NAME  = process.env.BOT_NAME   || "𝗗𝗥-𝗛𝗢𝗡𝗘𝗬-𝗠𝗜𝗡𝗜";
        const OWNER     = process.env.OWNER_NAME || "𝗗𝗥-𝗛𝗢𝗡𝗘𝗬";

        const caption =
            `*●⏤꯭🏓 PING𓂃ꜛ⸙*\n\n` +
            `*├⬗ Response Speed:* ${speedMs}ms\n` +
            `*├⬗ Uptime:* ${uptimeStr}\n` +
            `*├⬗ Bot Name:* ${BOT_NAME}\n` +
            `*├⬗ Owner:* ${OWNER}\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        const imageBuffer = getBannerBuffer();

        if (imageBuffer) {
            await conn.sendMessage(from, {
                image: imageBuffer,
                caption
            }, { quoted: mek });
        } else {
            await conn.sendMessage(from, { text: caption }, { quoted: mek });
        }
    }
};
