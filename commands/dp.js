const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const groupMetaCache = require('../lib/groupMetadataCache');

// Wrap a promise so a single slow/hanging network call (profilePictureUrl,
// groupMetadata, onWhatsApp, etc. can otherwise hang up to defaultQueryTimeoutMs,
// which is 60s in this bot's config) can never stall the whole command for long.
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
}

// ── Resolve a privacy "@lid" JID to the real phone-number JID ──────────────
// Baileys v7 addresses group members and reply/mention targets using an
// opaque "@lid" identifier by default, with no real-number field attached to
// mentions/replies in the message itself (this is a known upstream Baileys
// limitation). Fetching profile pictures / status requires the real number,
// so we try several resolution strategies in order of reliability:
//   1. The socket's internal LID<->PN mapping store (most reliable in v7, no network call)
//   2. The group's participant list (often carries both id + phoneNumber)
//   3. conn.onWhatsApp() (older-style lookup, kept as a last resort)
// Each network step is capped at 6s so a slow/unreachable step can't stack up
// into a long overall delay. If none work, the original JID is returned as-is.
async function resolveToRealJid(conn, jid, groupJid) {
    if (!jid || !jid.endsWith('@lid')) return jid;
    const lidUser = jid.split('@')[0].split(':')[0];

    try {
        const pn = await conn?.signalRepository?.lidMapping?.getPNForLID?.(lidUser);
        if (pn) {
            const resolved = jidNormalizedUser(pn.includes('@') ? pn : `${pn}@s.whatsapp.net`);
            console.log(`DP: resolved ${jid} -> ${resolved} via signalRepository.lidMapping`);
            return resolved;
        }
    } catch (e) {
        console.error('DP: signalRepository.lidMapping.getPNForLID failed:', e.message);
    }

    if (groupJid) {
        try {
            const meta = await withTimeout(groupMetaCache.getGroupMetadata(conn, groupJid), 6000);
            const p = meta.participants.find(pp => jidNormalizedUser(pp.id) === jidNormalizedUser(jid));
            const realNum = p?.phoneNumber || p?.pn || (p?.jid && p.jid !== p.id ? p.jid : null);
            if (realNum) {
                const resolved = jidNormalizedUser(realNum.includes('@') ? realNum : `${realNum}@s.whatsapp.net`);
                console.log(`DP: resolved ${jid} -> ${resolved} via group participant list`);
                return resolved;
            }
        } catch (e) {
            console.error('DP: group metadata lookup for @lid resolution failed:', e.message);
        }
    }

    try {
        const [result] = await withTimeout(conn.onWhatsApp(jid), 6000);
        if (result?.jid && result.jid !== jid) {
            const resolved = jidNormalizedUser(result.jid);
            console.log(`DP: resolved ${jid} -> ${resolved} via onWhatsApp`);
            return resolved;
        }
    } catch (e) {
        console.error('DP: onWhatsApp lookup for @lid resolution failed:', e.message);
    }

    console.log(`DP: could not resolve ${jid} to a real number — using it as-is`);
    return jid;
}

module.exports = {
    pattern: "dp",
    desc: "Get profile picture: a person's DP in DM, or the group's DP in a group",
    react: "🖼️",
    category: "utility",
    use: ".dp [@user / number] or reply to a message",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, reply }) => {
        try {
            await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });

            const rawArg = (args && args[0]) || "";

            let target;
            let isGroupDp = false;

            if (mek.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
                // ".dp @user" — a specific mentioned member
                target = mek.message.extendedTextMessage.contextInfo.mentionedJid[0];
            } else if (mek.message?.extendedTextMessage?.contextInfo?.participant) {
                // Replying to someone's message — that person
                target = mek.message.extendedTextMessage.contextInfo.participant;
            } else if (rawArg && /\d{8,}/.test(rawArg.replace(/\D/g, ""))) {
                // Direct number fetch — ".dp 923001234567"
                const digits = rawArg.replace(/\D/g, "");
                target = `${digits}@s.whatsapp.net`;
            } else if (from.endsWith('@g.us')) {
                // Plain ".dp" inside a group, no mention/reply/number given ->
                // default to the group's own DP (no need to type "dp group").
                target = from;
                isGroupDp = true;
            } else {
                // Plain ".dp" in a DM -> the other person in the chat, not yourself.
                target = from;
            }

            // Normalise JID (strips ":deviceId" suffix that was breaking the number)
            target = jidNormalizedUser(target);
            console.log(`DP: initial target = ${target}, isGroupDp = ${isGroupDp}`);

            let ppUrl;

            // Fast path: try the profile picture directly on the raw target first.
            // A lot of the "delay" people saw came from always running the slow
            // 3-step @lid resolution chain (which can hit the 60s query timeout)
            // even when the raw JID would have worked fine on its own.
            try {
                ppUrl = await withTimeout(conn.profilePictureUrl(target, 'image'), 8000);
                console.log(`DP: profilePictureUrl succeeded directly for ${target}`);
            } catch (e) {
                console.log(`DP: direct profilePictureUrl failed for ${target} (${e.message}), trying @lid resolution...`);

                // Only bother resolving if this is actually a privacy @lid target
                if (!isGroupDp && target.endsWith('@lid')) {
                    const resolved = await resolveToRealJid(conn, target, from.endsWith('@g.us') ? from : null);
                    if (resolved !== target) {
                        target = resolved;
                        try {
                            ppUrl = await withTimeout(conn.profilePictureUrl(target, 'image'), 8000);
                            console.log(`DP: profilePictureUrl succeeded after resolution for ${target}`);
                        } catch (e2) {
                            console.error(`DP: profilePictureUrl still failed after resolution for ${target}:`, e2.message);
                        }
                    }
                }

                if (!ppUrl) {
                    console.error(`DP: giving up, using fallback image for ${target}`);
                    ppUrl = 'https://i.imgur.com/2wzGhpF.jpeg';
                }
            }

            let number = null;
            if (!isGroupDp) {
                number = target.split('@')[0].split(':')[0];
            }

            const caption = `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

            await conn.sendMessage(from, {
                image: { url: ppUrl },
                caption
            }, { quoted: mek });

            // ── High-res copy sent as a document (original quality) ────────
            try {
                await conn.sendMessage(from, {
                    document: { url: ppUrl },
                    mimetype: 'image/jpeg',
                    fileName: `${isGroupDp ? 'group' : number}-dp.jpg`
                }, { quoted: mek });
            } catch (e) {
                console.error("DP: failed to send high-res document copy:", e.message);
            }

            await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });

        } catch (e) {
            console.error("DP Command Error:", e.message);
            await reply('❌ Could not fetch profile picture. User may have hidden it.');
        }
    }
};
