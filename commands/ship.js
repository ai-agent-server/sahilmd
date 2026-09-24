// === ship.js ===
module.exports = {
  pattern: "ship",
  desc: "Pairs the command user with another group member (mention, reply, or random).",
  react: "❤️",
  category: "fun",
  use: ".ship @user OR reply to a user",
  filename: __filename,

  execute: async (conn, mek, m, { from, isGroup, groupMetadata, reply, sender }) => {
    try {
      const botNumber = conn.user.id;

      // Step 1: Check for mention or reply
      let target = null;
      if (m.mentionedJid && m.mentionedJid.length > 0) {
        target = m.mentionedJid[0];
      } else if (m.quoted) {
        target = m.quoted.sender;
      }

      // Step 2: If no mention/reply — pick a random group member (groups),
      // or ship with the bot itself (DMs, where there's no member list).
      if (!target) {
        if (isGroup && groupMetadata) {
          const participants = groupMetadata.participants.map(user => user.id);
          const availablePairs = participants.filter(user => user !== sender && user !== botNumber);
          if (availablePairs.length === 0) {
            return reply("❌ Not enough participants to create a pair.");
          }
          target = availablePairs[Math.floor(Math.random() * availablePairs.length)];
        } else {
          target = from; // DM: ship with the person you're chatting with
        }
      }

      // Step 3: Build message
      const message =
        `*●⏤꯭❤️ SHIP𓂃ꜛ⸙*\n\n` +
        `*├⬗ Match:* @${sender.split("@")[0]} + @${target.split("@")[0]}\n` +
        `*├⬗ Result:* 💖 Congratulations! 🎉\n\n` +
        `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

      // React first
      await conn.sendMessage(from, { react: { text: "❤️", key: mek.key } });

      // Send the ship message
      await conn.sendMessage(from, {
        text: message,
        mentions: [sender, target]
      }, { quoted: mek });

    } catch (error) {
      console.error("❌ Error in ship command:", error);
      reply("⚠️ An error occurred while processing the command. Please try again.");
    }
  }
};
