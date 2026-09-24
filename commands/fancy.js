// commands/fancy.js
let fetchFn;
try {
  fetchFn = global.fetch || require("node-fetch");
} catch {
  fetchFn = global.fetch;
}

const CHAT_CACHE = new Map(); // chatId -> { text, results }

module.exports = {
  pattern: "fancy",
  desc: "Convert text into various fonts. Use `.fancy <text>` or `.fancy <n>` after generating.",
  category: "fun",
  react: "🎨",
  filename: __filename,
  use: "fancy <styleNumber?> <text?> or reply to a message",

  execute: async (conn, mek, m, { args, reply, from }) => {
    const box = (title, lines) =>
      `*●⏤꯭🎨 ${title}𓂃ꜛ⸙*\n\n` +
      lines.map(l => `◇ ${l}`).join('\n') + `\n\n` +
      `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

    try {
      if (!fetchFn) return reply(box('FANCY TEXT', ['⚠️ Fetch is not available on this runtime.']));

      // Extract quoted text if replying
      const getQuotedText = () => {
        const q =
          m?.quoted?.message ||
          mek?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!q) return null;
        return (
          q.conversation ||
          q.extendedTextMessage?.text ||
          q.imageMessage?.caption ||
          q.videoMessage?.caption ||
          q.documentMessage?.fileName ||
          null
        );
      };

      // ? Safe chat ID
      const chatId = from || m.chat || mek.key?.remoteJid || "global";

      let styleNumber = null;
      let textToConvert = null;
      const quotedText = getQuotedText();

      if (args.length === 0) {
        if (quotedText) textToConvert = quotedText;
        else return reply(box('FANCY TEXT', ['💬 Provide text or reply to a message.', 'Example: `.fancy Hello`']));
      } else {
        if (!isNaN(args[0])) {
          styleNumber = parseInt(args[0], 10);
          if (args.length > 1) textToConvert = args.slice(1).join(" ");
          else if (quotedText) textToConvert = quotedText;
          else {
            const cached = CHAT_CACHE.get(chatId);
            if (cached) textToConvert = cached.text;
            else return reply(box('FANCY TEXT', ['💬 No previous text found in this chat.', 'Use `.fancy <text>` first.']));
          }
        } else {
          textToConvert = args.join(" ");
        }
      }

      if (!textToConvert) return reply(box('FANCY TEXT', ['⚠️ Could not determine text.']));

      // === GiftedTech API ===
      const apiUrl = `https://api.giftedtech.co.ke/api/tools/fancy?apikey=gifted&text=${encodeURIComponent(
        textToConvert
      )}`;
      const res = await fetchFn(apiUrl);
      if (!res.ok) return reply(box('FANCY TEXT', ['⚠️ Failed to fetch fonts from API.']));
      const data = await res.json();

      if (!data || !Array.isArray(data.results)) {
        return reply(box('FANCY TEXT', ['⚠️ API returned no fonts.']));
      }

      CHAT_CACHE.set(chatId, { text: textToConvert, results: data.results });

      // Safe JID extraction
      const getSafeMentionJid = () => {
        try {
          if (!m.sender) return [];
          const senderParts = m.sender.split('@');
          if (senderParts.length === 2 && senderParts[1] === 's.whatsapp.net') {
            return [`${senderParts[0]}@s.whatsapp.net`];
          }
          return [];
        } catch (e) {
          return [];
        }
      };

      const mentionedJid = getSafeMentionJid();

      if (styleNumber !== null) {
        if (styleNumber < 1 || styleNumber > data.results.length) {
          return reply(box('FANCY TEXT', [`⚠️ Invalid style. Choose between 1 and ${data.results.length}.`]));
        }
        const chosen = data.results[styleNumber - 1];

        // Send selected style as plain text (no forwarded/channel tag)
        await conn.sendMessage(chatId, {
          text: box('FANCY TEXT', [
            `📝 *Style ${styleNumber}:*`,
            '',
            chosen.result
          ]),
          contextInfo: {
            mentionedJid
          }
        }, { quoted: mek });
        return;
      }

      // Show all options with contextInfo
      const lines = [`📝 *Text:* ${textToConvert}`, `_Type_ \`.fancy <number>\` _to select a style_`, ''];
      data.results.forEach((f, i) => {
        lines.push(`${i + 1}. ${f.result}`);
      });

      await conn.sendMessage(chatId, {
        text: box('FANCY STYLES', lines),
        contextInfo: {
          mentionedJid
        }
      }, { quoted: mek });

    } catch (err) {
      console.error("Error in fancy.js:", err);

      // Error message with contextInfo (safe fallback)
      await conn.sendMessage(from || m.chat || mek.key?.remoteJid, {
        text: box('FANCY TEXT', ['⚠️ Error converting text. Try again later.']),
        contextInfo: {
          mentionedJid: []
        }
      }, { quoted: mek });
    }
  },
};
