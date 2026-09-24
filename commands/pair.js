const { jidNormalizedUser } = require("@whiskeysockets/baileys");
const axios = require("axios");

// Local URL of this same server's /api/pair endpoint (defined in server.js).
// Override with PAIR_API_URL env var if the bot runs behind a different host/port.
const PAIR_API_URL = process.env.PAIR_API_URL || `http://localhost:${process.env.PORT || 3000}/api/pair`;

module.exports = {
    pattern: "pair",
    desc: "Generate a real WhatsApp pairing code for 𝗗𝗥 𝗛𝗢𝗡𝗘𝗬 𝗠𝗜𝗡𝗜",
    react: "💓",
    category: "utility",
    use: ".pair <number with country code>",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, q, reply }) => {
        // Helper: send a plain text message (no banner image)
        const sendPairMessage = async (caption, quoted = mek) => {
            return await conn.sendMessage(from, { text: caption }, { quoted });
        };

        try {
            // React with key emoji
            if (module.exports.react) {
                await conn.sendMessage(from, { react: { text: module.exports.react, key: mek.key } });
            }

            // Number can come from args (e.g. ".pair 923001234567") or from quoted text (q).
            // If neither is given, fall back to the number of the chat this was typed in —
            // i.e. the person you're DMing. WhatsApp's newer privacy "@lid" JIDs hide the
            // real phone number behind a long pseudo-ID, so we try a few ways to resolve
            // that back to the real number before using it.
            const resolveLid = async (lidJid) => {
                // Try 1: Baileys' own USync lookup
                try {
                    const [result] = await conn.onWhatsApp(lidJid);
                    if (result?.jid && !result.jid.endsWith("@lid")) return jidNormalizedUser(result.jid);
                } catch (e) { /* fall through */ }

                // Try 2: internal signal-repository LID↔PN mapping (newer Baileys)
                try {
                    const pn = await conn.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
                    if (pn) return jidNormalizedUser(pn);
                } catch (e) { /* fall through */ }

                // Try 3: local store, if the bot keeps one
                try {
                    const stored = conn.store?.lidMapping?.[lidJid] || conn.chats?.[lidJid]?.jid;
                    if (stored) return jidNormalizedUser(stored);
                } catch (e) { /* fall through */ }

                return null; // couldn't resolve — caller keeps the original
            };

            // In a private DM, "from" IS the other person's JID — that's who .pair
            // should target, regardless of who technically "sent" the message
            // (important for self-bot setups where the owner's own account sends
            // the command from inside that person's chat).
            // In a group, fall back to the actual participant who typed the command.
            const isGroup = (from || "").endsWith("@g.us");
            let senderJid = isGroup ? (mek.key.participant || "") : (from || mek.key.remoteJid || "");
            senderJid = senderJid ? jidNormalizedUser(senderJid) : "";

            if (senderJid.endsWith("@lid")) {
                const resolved = await resolveLid(senderJid);
                if (resolved) senderJid = resolved;
                else console.error("Pair: could not resolve @lid", senderJid, "to a real number.");
            }

            const senderResolved = !senderJid.endsWith("@lid");
            const senderNumber   = senderResolved ? senderJid.split("@")[0].split(":")[0] : "";

            const rawNumber = (args && args[0]) || q || senderNumber || "";
            const number = rawNumber.replace(/\D/g, ""); // keep digits only

            if (!number || number.length < 8) {
                const lidNote = senderJid.endsWith("@lid")
                    ? `\n\n⚠️ Couldn't auto-detect this contact's real number (WhatsApp gave a privacy ID instead). Please pass it manually.`
                    : "";
                return await sendPairMessage(
                    `*●⏤꯭📱 DR HONEY MINI PAIR𓂃ꜛ⸙*\n\n` +
                    `⚠️ *Number missing or invalid!*\n\n` +
                    `📋 *Usage:* .pair <number with country code>\n` +
                    `💡 *Example:* .pair 923001234567\n\n` +
                    `Don't use "+", spaces, or brackets — just country code + number.${lidNote}`
                );
            }

            await sendPairMessage(`*●⏤꯭📱 DR HONEY MINI PAIR𓂃ꜛ⸙*\n\n⏳ Generating pairing code for *${number}*... please wait.`);

            // Call this server's own /api/pair endpoint to get a real pairing code
            const { data } = await axios.post(
                PAIR_API_URL,
                { number },
                { timeout: 30000 }
            );

            if (!data || !data.success || !data.pairingCode) {
                throw new Error(data?.error || data?.details || "No pairing code returned");
            }

            // Format code as XXXX-XXXX for readability, like WhatsApp shows it
            const code = data.pairingCode;
            const formattedCode = code.length === 8
                ? `${code.slice(0, 4)}-${code.slice(4)}`
                : code;

            const caption =
                `*●⏤꯭📱 DR HONEY MINI PAIR𓂃ꜛ⸙*\n\n` +
                `◇ *Number* : ${number}\n` +
                `◇ *Code* : \`${formattedCode}\`\n` +
                `◇ *Expires* : in a few minutes\n\n` +
                `◇ Open WhatsApp on ${number}\n` +
                `◇ Tap Settings → Linked Devices\n` +
                `◇ Tap "Link a Device"\n` +
                `◇ Tap "Link with phone number instead"\n` +
                `◇ Enter code: \`${formattedCode}\`\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

            await sendPairMessage(caption);

            // Also send just the raw pairing code alone, as a separate message
            await sendPairMessage(`\`${formattedCode}\``);

        } catch (e) {
            const errMsg = e.response?.data?.error || e.response?.data?.details || e.message;
            console.error("❌ Pair Command Error:", errMsg);
            await sendPairMessage(`*●⏤꯭📱 DR HONEY MINI PAIR𓂃ꜛ⸙*\n\n⚠️ *Error generating pairing code:*\n${errMsg}`);
        }
    }
};
