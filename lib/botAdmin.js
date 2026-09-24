const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const groupMetaCache = require('./groupMetadataCache');

// Baileys v7 groups can list any participant — including the bot itself —
// using either the real phone-number JID (...@s.whatsapp.net) or the newer
// privacy "@lid" identifier, and this can differ from how conn.user.id /
// conn.user.lid represent the bot. If we only compare one form, the bot can
// genuinely be admin in the group but still get read as "not admin" here,
// which is what caused kick/add to fail right after promotion. To avoid
// that, we build every identifier we can for the bot (jid + lid, resolved
// both ways) and match against every identifier the participant list gives
// us for that same entry, so a mismatch of *format* never looks like a
// mismatch of *identity*.

function bareNum(jid) {
    return jid ? jid.split('@')[0].split(':')[0] : null;
}

// Resolve a "@lid" identifier to its real phone number, if possible.
async function lidToNum(conn, lidJid) {
    if (!lidJid) return null;
    try {
        const pn = await conn?.signalRepository?.lidMapping?.getPNForLID?.(bareNum(lidJid));
        if (pn) return bareNum(pn.includes('@') ? pn : `${pn}@s.whatsapp.net`);
    } catch (e) {
        console.error('botAdmin: lidToNum failed:', e.message);
    }
    return null;
}

// Resolve a real-number JID to its "@lid" identifier, if possible.
async function numToLid(conn, jid) {
    if (!jid) return null;
    try {
        const lid = await conn?.signalRepository?.lidMapping?.getLIDForPN?.(bareNum(jid));
        if (lid) return bareNum(lid.includes('@') ? lid : `${lid}@lid`);
    } catch (e) {
        console.error('botAdmin: numToLid failed:', e.message);
    }
    return null;
}

/**
 * Confirms whether the bot is actually an admin/superadmin in a group,
 * checking both the JID and LID identifiers for a match.
 *
 * @returns {Promise<{ isAdmin: boolean, metadata: object|null, botNums: string[] }>}
 */
async function checkBotAdmin(conn, from, metadata = null) {
    try {
        if (!metadata) metadata = await groupMetaCache.getGroupMetadata(conn, from);
    } catch (e) {
        console.error('botAdmin: failed to fetch group metadata:', e.message);
        return { isAdmin: false, metadata: null, botNums: [] };
    }

    // Every identifier the bot itself could plausibly be known by.
    const botNums = new Set();

    const selfJid = conn.user?.id ? jidNormalizedUser(conn.user.id) : null;
    const selfLid = conn.user?.lid ? jidNormalizedUser(conn.user.lid) : null;

    if (selfJid) botNums.add(bareNum(selfJid));
    if (selfLid) botNums.add(bareNum(selfLid));

    // Cross-resolve so we have both forms even if only one was available.
    if (selfJid && !selfJid.endsWith('@lid')) {
        const asLid = await numToLid(conn, selfJid);
        if (asLid) botNums.add(asLid);
    }
    if (selfLid) {
        const asNum = await lidToNum(conn, selfLid);
        if (asNum) botNums.add(asNum);
    }

    // Check each participant entry against every known bot identifier —
    // including any phoneNumber/pn/jid fields the participant object itself
    // carries, since Baileys sometimes attaches both forms on one entry.
    for (const p of metadata.participants) {
        const pid = jidNormalizedUser(p.id);
        const pNums = new Set([bareNum(pid)]);

        if (p.phoneNumber) pNums.add(bareNum(p.phoneNumber));
        if (p.pn) pNums.add(bareNum(p.pn));
        if (p.jid && p.jid !== p.id) pNums.add(bareNum(jidNormalizedUser(p.jid)));

        if (pid.endsWith('@lid')) {
            const resolved = await lidToNum(conn, pid);
            if (resolved) pNums.add(resolved);
        } else {
            const resolved = await numToLid(conn, pid);
            if (resolved) pNums.add(resolved);
        }

        const matches = [...pNums].some(n => botNums.has(n));
        if (matches) {
            const isAdmin = p.admin === 'admin' || p.admin === 'superadmin';
            return { isAdmin, metadata, botNums: [...botNums] };
        }
    }

    return { isAdmin: false, metadata, botNums: [...botNums] };
}

module.exports = { checkBotAdmin, bareNum, lidToNum, numToLid };
