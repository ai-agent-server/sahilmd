const axios = require('axios');

module.exports = {
    pattern: "translate",
    alias: ["trt", "tr"],
    desc: "Translate text to any language",
    react: "🌐",
    category: "utility",
    use: ".translate <text> <lang code> or reply .translate <lang>",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, q, reply }) => {
        try {
            await conn.sendMessage(from, { react: { text: '🌐', key: mek.key } });

            let textToTranslate = '';
            let lang = '';

            const quotedMessage = mek.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quotedMessage) {
                textToTranslate = quotedMessage.conversation ||
                    quotedMessage.extendedTextMessage?.text ||
                    quotedMessage.imageMessage?.caption || '';
                lang = args[0] || 'en';
            } else {
                if (!args || args.length < 2) {
                    return reply(
                        `╭━━━〔 🌐 *TRANSLATOR* 〕━━━┈⊷\n` +
                        `┃ *Usage:*\n` +
                        `┃ 1. Reply to msg: .translate <lang>\n` +
                        `┃ 2. Direct: .translate <text> <lang>\n` +
                        `┃\n` +
                        `┃ *Language Codes:*\n` +
                        `┃ en=English ur=Urdu hi=Hindi\n` +
                        `┃ ar=Arabic fr=French de=German\n` +
                        `┃ es=Spanish tr=Turkish\n` +
                        `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                        `> ᴡʜᴀᴛꜱᴀᴩᴩ ᴍɪɴɪ ʙᴏᴛ | ᴅʀ ʜᴏɴᴇʏ ᴍɪɴɪ
> © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx`
                    );
                }
                lang = args[args.length - 1];
                textToTranslate = args.slice(0, -1).join(' ');
            }

            if (!textToTranslate) return reply("❌ No text to translate. Reply to a message or provide text.");

            let translatedText = null;

            // API 1: Google
            try {
                const res = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(textToTranslate)}`);
                if (res.data?.[0]?.[0]?.[0]) translatedText = res.data[0][0][0];
            } catch {}

            // API 2: MyMemory fallback
            if (!translatedText) {
                try {
                    const res = await axios.get(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=auto|${lang}`);
                    if (res.data?.responseData?.translatedText) translatedText = res.data.responseData.translatedText;
                } catch {}
            }

            if (!translatedText) throw new Error("All translation APIs failed");

            await conn.sendMessage(from, {
                text: `╭━━━〔 🌐 *TRANSLATED* 〕━━━┈⊷\n┃ 📝 *Original:* ${textToTranslate}\n┃ 🌍 *To:* ${lang.toUpperCase()}\n╰━━━━━━━━━━━━━━━━━━┈⊷\n\n${translatedText}\n\n> ᴡʜᴀᴛꜱᴀᴩᴩ ᴍɪɴɪ ʙᴏᴛ | ᴅʀ ʜᴏɴᴇʏ ᴍɪɴɪ
> © ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx`
            }, { quoted: mek });

        } catch (error) {
            console.error('Translate error:', error);
            await reply('❌ Failed to translate. Please try again.');
        }
    }
};
