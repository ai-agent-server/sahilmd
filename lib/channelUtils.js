// lib/channelUtils.js
// Shared helpers for parsing WhatsApp channel (newsletter) links and
// group invite links used by the chf / chreact / chvote / jgroup commands.

/**
 * Extracts the invite code and (optional) post/message server id from a
 * WhatsApp channel link.
 *
 * Supports:
 *   https://whatsapp.com/channel/0029VadBQndLY6dA8nGkpS09
 *   https://whatsapp.com/channel/0029VadBQndLY6dA8nGkpS09/123
 *   invite:0029VadBQndLY6dA8nGkpS09
 *   0029VadBQndLY6dA8nGkpS09 (raw invite code)
 */
function parseChannelLink(link) {
    if (!link) return null;
    let inviteCode = link.trim();
    let messageId = null;

    const linkMatch = inviteCode.match(/whatsapp\.com\/channel\/([A-Za-z0-9]+)(?:\/(\d+))?/i);
    if (linkMatch) {
        inviteCode = linkMatch[1];
        if (linkMatch[2]) messageId = linkMatch[2];
    } else if (inviteCode.startsWith('invite:')) {
        inviteCode = inviteCode.slice(7);
    }

    return { inviteCode, messageId };
}

/**
 * Resolves a channel invite link/code to its real @newsletter JID.
 * Throws if the channel cannot be resolved.
 */
async function resolveNewsletterJid(conn, inviteCode) {
    const meta = await conn.newsletterMetadata('invite', inviteCode);
    if (!meta || !meta.id) {
        throw new Error('Could not resolve channel from the given link.');
    }
    return meta.id;
}

/**
 * Extracts the invite code from a WhatsApp group link.
 *   https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQ
 */
function parseGroupInviteLink(link) {
    if (!link) return null;
    let code = link.trim();
    const linkMatch = code.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i);
    if (linkMatch) code = linkMatch[1];
    return code;
}

module.exports = {
    parseChannelLink,
    resolveNewsletterJid,
    parseGroupInviteLink
};
