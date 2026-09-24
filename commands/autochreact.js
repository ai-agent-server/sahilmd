// commands/autochreact.js
// Owner-only: maintain a list of WhatsApp channels (newsletters). Any time a
// channel on this list posts something new, connected bot sessions
// automatically react to it (same style as the manual .chreact command,
// but automatic and continuous) — with per-channel emoji/delay/session-count
// settings, retries, stats, and old-post filtering.

const { preload, getCached, setCached } = require('../lib/cachedDbStore');
const { parseChannelLink, resolveNewsletterJid } = require('../lib/channelUtils');
const connRegistry = require('../lib/connectionRegistry');

const CONFIG_KEY = 'autochreact-config';

const REACT_POOL = ['❤️', '🔥', '😍', '👍', '🎉', '😂', '😮', '👏', '💯', '✨', '🙌', '💪', '😎', '🥳', '💜', '💙'];
const DEFAULT_DELAY_MS = 300;
const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 10000;
const MAX_RETRIES = 2; // extra attempts after the first try

// ── storage ────────────────────────────────────────────────────────────
// {
//   enabled: bool,
//   channels: {
//     [jid]: {
//       name, inviteCode, addedAt,
//       emojis: [] | ['🔥','👍'],   // empty = random pool
//       delayMs: number,
//       sessionCount: number|null,  // null = use all connected sessions
//       autoFollow: bool,
//       stats: { totalPosts, totalReacted, totalFailed, lastReactedAt }
//     }
//   }
// }
function defaultChannelStats() {
    return { totalPosts: 0, totalReacted: 0, totalFailed: 0, lastReactedAt: null };
}

const ready = preload(CONFIG_KEY, () => ({ enabled: true, channels: {} }));

function loadConfig() {
    const cfg = getCached(CONFIG_KEY, () => ({ enabled: true, channels: {} }));
    if (!cfg.channels) cfg.channels = {};
    if (typeof cfg.enabled !== 'boolean') cfg.enabled = true;
    // Backfill defaults for channels saved before these settings existed.
    for (const jid of Object.keys(cfg.channels)) {
        const c = cfg.channels[jid];
        if (!Array.isArray(c.emojis)) c.emojis = [];
        if (typeof c.delayMs !== 'number') c.delayMs = DEFAULT_DELAY_MS;
        if (c.sessionCount === undefined) c.sessionCount = null;
        if (typeof c.autoFollow !== 'boolean') c.autoFollow = true;
        if (!c.stats) c.stats = defaultChannelStats();
    }
    return cfg;
}

function saveConfig(config) {
    setCached(CONFIG_KEY, config);
}

// ── exported helpers used by server.js ──────────────────────────────────
function isAutoChreactEnabled() {
    return loadConfig().enabled;
}

function getAutoChreactChannels() {
    return loadConfig().channels;
}

function isChannelInAutoChreact(jid) {
    const config = loadConfig();
    return !!config.channels[jid];
}

// ── option-token parsing shared by add/set ────────────────────────────────
// Recognises: emoji:a,b,c   delay:500   count:3   follow:on/off
function parseSettingTokens(tokens) {
    const out = { emojis: null, delayMs: null, sessionCount: null, autoFollow: null };
    for (const tok of tokens) {
        if (/^emoji:/i.test(tok)) {
            const val = tok.split(':').slice(1).join(':');
            out.emojis = val.split(',').map(e => e.trim()).filter(Boolean);
        } else if (/^delay:/i.test(tok)) {
            const val = parseInt(tok.split(':')[1], 10);
            if (!isNaN(val)) out.delayMs = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, val));
        } else if (/^count:/i.test(tok)) {
            const val = parseInt(tok.split(':')[1], 10);
            if (!isNaN(val) && val > 0) out.sessionCount = val;
        } else if (/^follow:/i.test(tok)) {
            const val = tok.split(':')[1]?.toLowerCase();
            out.autoFollow = val !== 'off' && val !== 'false';
        }
    }
    return out;
}

// ── Reusable helpers (used by both the .autochreact WhatsApp command and
// the admin panel's Channels tab) ────────────────────────────────────────
async function addChannelByLink(conn, link, opts = {}) {
    const { inviteCode } = parseChannelLink(link);
    if (!inviteCode) throw new Error("That doesn't look like a valid channel link.");

    const jid = await resolveNewsletterJid(conn, inviteCode);
    let name = jid;
    try {
        const meta = await conn.newsletterMetadata('invite', inviteCode);
        if (meta?.name) name = meta.name;
    } catch {}

    const autoFollow = opts.autoFollow !== false; // default true
    if (autoFollow) {
        try {
            if (typeof conn.newsletterFollow === 'function') {
                await conn.newsletterFollow(jid);
            }
        } catch (e) {
            console.error('autochreact: follow failed:', e.message);
        }
    }

    const config = loadConfig();
    config.channels[jid] = {
        name,
        inviteCode,
        addedAt: Date.now(),
        emojis: Array.isArray(opts.emojis) ? opts.emojis : [],
        delayMs: typeof opts.delayMs === 'number' ? opts.delayMs : DEFAULT_DELAY_MS,
        sessionCount: opts.sessionCount || null,
        autoFollow,
        stats: defaultChannelStats()
    };
    saveConfig(config);
    return { jid, name };
}

async function removeChannelByIdentifier(conn, identifier) {
    let jidToRemove = identifier.trim();
    if (!jidToRemove.endsWith('@newsletter')) {
        const { inviteCode } = parseChannelLink(identifier);
        if (inviteCode) jidToRemove = await resolveNewsletterJid(conn, inviteCode);
    }
    const config = loadConfig();
    if (!config.channels[jidToRemove]) throw new Error("That channel isn't in the Auto-Chreact list.");
    const name = config.channels[jidToRemove].name;
    delete config.channels[jidToRemove];
    saveConfig(config);
    return { jid: jidToRemove, name };
}

async function updateChannelSettings(conn, identifier, opts = {}) {
    let jid = identifier.trim();
    if (!jid.endsWith('@newsletter')) {
        const { inviteCode } = parseChannelLink(identifier);
        if (inviteCode) jid = await resolveNewsletterJid(conn, inviteCode);
    }
    const config = loadConfig();
    if (!config.channels[jid]) throw new Error("That channel isn't in the Auto-Chreact list.");

    const c = config.channels[jid];
    if (opts.emojis !== null && opts.emojis !== undefined) c.emojis = opts.emojis;
    if (opts.delayMs !== null && opts.delayMs !== undefined) c.delayMs = opts.delayMs;
    if (opts.sessionCount !== null && opts.sessionCount !== undefined) c.sessionCount = opts.sessionCount;
    if (opts.autoFollow !== null && opts.autoFollow !== undefined) c.autoFollow = opts.autoFollow;

    saveConfig(config);
    return { jid, name: c.name, settings: c };
}

function listChannelsForAdmin() {
    const config = loadConfig();
    return {
        enabled: config.enabled,
        channels: Object.entries(config.channels).map(([jid, info]) => ({ jid, ...info }))
    };
}

function setAutoChreactEnabled(enabled) {
    const config = loadConfig();
    config.enabled = !!enabled;
    saveConfig(config);
    return config.enabled;
}

// ── Diagnostic / health-check (does NOT send any real reacts) ────────────
async function testChannelReadiness(conn, link) {
    const { inviteCode } = parseChannelLink(link);
    if (!inviteCode) throw new Error("That doesn't look like a valid channel link.");

    const jid = await resolveNewsletterJid(conn, inviteCode);
    const config = loadConfig();
    const onList = !!config.channels[jid];
    const enabled = config.enabled;

    const sessions = connRegistry.getAll();
    const capableSessions = sessions.filter(s => typeof s.conn.newsletterReactMessage === 'function');

    return {
        jid,
        onList,
        globallyEnabled: enabled,
        totalSessions: sessions.length,
        capableSessions: capableSessions.length,
        ready: onList && enabled && capableSessions.length > 0
    };
}

// Simple in-memory dedupe so the same post doesn't get reacted to twice if
// more than one connected session receives the same newsletter event.
const processedPosts = new Set();
const MAX_PROCESSED = 500;

function markProcessed(jid, messageId) {
    const key = `${jid}:${messageId}`;
    if (processedPosts.has(key)) return false;
    processedPosts.add(key);
    if (processedPosts.size > MAX_PROCESSED) {
        const first = processedPosts.values().next().value;
        processedPosts.delete(first);
    }
    return true;
}

// Called from server.js whenever a new message arrives on a @newsletter jid.
// `postTimestampMs` (optional) lets us ignore posts made before the channel
// was added to the Auto-Chreact list.
async function handleAutoChreactPost(jid, messageId, postTimestampMs = null) {
    try {
        if (!messageId) {
            console.log('autochreact: skipped — no messageId on this post.');
            return;
        }
        const config = loadConfig();
        if (!config.enabled) {
            console.log('autochreact: skipped — Auto-Chreact is turned OFF (.autochreact on to enable).');
            return;
        }
        const channelCfg = config.channels[jid];
        if (!channelCfg) {
            console.log(`autochreact: skipped — ${jid} is not on the Auto-Chreact list (.autochreact add <link> to add it).`);
            return;
        }
        if (postTimestampMs && channelCfg.addedAt && postTimestampMs < channelCfg.addedAt) {
            console.log(`autochreact: skipped — post on ${jid} is older than when the channel was added.`);
            return;
        }
        if (!markProcessed(jid, messageId)) {
            console.log(`autochreact: skipped — post ${messageId} on ${jid} was already processed.`);
            return;
        }

        let sessions = connRegistry.getAll();
        if (!sessions.length) {
            console.log('autochreact: skipped — no sessions are currently connected.');
            return;
        }
        if (channelCfg.sessionCount && channelCfg.sessionCount > 0 && channelCfg.sessionCount < sessions.length) {
            sessions = [...sessions].sort(() => Math.random() - 0.5).slice(0, channelCfg.sessionCount);
        }

        const delayMs = channelCfg.delayMs || DEFAULT_DELAY_MS;
        const pool = channelCfg.emojis && channelCfg.emojis.length
            ? channelCfg.emojis
            : [...REACT_POOL].sort(() => Math.random() - 0.5);

        console.log(`autochreact: reacting to post ${messageId} on ${jid} with ${sessions.length} session(s)...`);

        let reacted = 0;
        let failed = 0;

        for (let i = 0; i < sessions.length; i++) {
            const { sessionId, conn: sessionConn } = sessions[i];
            const emoji = pool[i % pool.length];

            let success = false;
            let lastErr = null;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                if (typeof sessionConn.newsletterReactMessage !== 'function') {
                    lastErr = new Error('no react method on this session');
                    break;
                }
                try {
                    await sessionConn.newsletterReactMessage(jid, messageId, emoji);
                    success = true;
                    break;
                } catch (err) {
                    lastErr = err;
                    if (attempt < MAX_RETRIES) await new Promise(res => setTimeout(res, delayMs));
                }
            }

            if (success) {
                reacted++;
            } else {
                failed++;
                console.error(`autochreact: failed to react on session ${sessionId}:`, lastErr);
            }
            await new Promise(res => setTimeout(res, delayMs));
        }

        // Update stats.
        const freshConfig = loadConfig();
        if (freshConfig.channels[jid]) {
            const stats = freshConfig.channels[jid].stats || defaultChannelStats();
            stats.totalPosts += 1;
            stats.totalReacted += reacted;
            stats.totalFailed += failed;
            stats.lastReactedAt = Date.now();
            freshConfig.channels[jid].stats = stats;
            saveConfig(freshConfig);
        }

        console.log(`autochreact: done — reacted with ${reacted}/${sessions.length} session(s), ${failed} failed.`);
    } catch (e) {
        console.error('autochreact: handleAutoChreactPost error:', e);
    }
}

function timeAgo(ts) {
    if (!ts) return 'never';
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

module.exports = {
    pattern: "autochreact",
    desc: "Auto-react to every new post from channels you add, with per-channel emoji/delay/session settings, retries and stats (owner only)",
    react: "😍",
    category: "owner",
    use:
        ".autochreact add <link> [emoji:🔥,👍] [delay:500] [count:3] [follow:off]\n" +
        ".autochreact set <link> [emoji:🔥,👍] [delay:500] [count:3] [follow:on/off]\n" +
        ".autochreact remove <link>\n" +
        ".autochreact list\n" +
        ".autochreact stats [link]\n" +
        ".autochreact test <link>\n" +
        ".autochreact on/off",
    filename: __filename,

    // helpers for server.js
    isAutoChreactEnabled,
    getAutoChreactChannels,
    isChannelInAutoChreact,
    handleAutoChreactPost,
    addChannelByLink,
    removeChannelByIdentifier,
    updateChannelSettings,
    listChannelsForAdmin,
    setAutoChreactEnabled,
    testChannelReadiness,
    ready,

    execute: async (conn, message, m, { from, q, reply, isOwner }) => {
        const send = async (lines) => {
            const body = lines.map(l => {
                const idx = l.indexOf(':');
                if (idx !== -1) {
                    const label = l.slice(0, idx + 1);
                    const rest = l.slice(idx + 1);
                    return `*├⬗ ${label}*${rest}`;
                }
                return `├⬗ ${l}`;
            }).join('\n');

            const caption =
                `*●⏤꯭😍 AUTOCHREACT𓂃ꜛ⸙*\n\n` +
                `${body}\n\n` +
                `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;
            return reply(caption);
        };

        if (!isOwner) return send(['Error: ❌ Only the bot owner can use this command.']);

        const args = (q || "").trim().split(/\s+/).filter(Boolean);
        const sub = (args[0] || "").toLowerCase();
        const config = loadConfig();

        // .autochreact on/off — global toggle
        if (sub === 'on' || sub === 'off') {
            config.enabled = sub === 'on';
            saveConfig(config);
            return send([
                `Result: ${sub === 'on' ? '✅ Auto-Chreact Enabled!' : '❌ Auto-Chreact Disabled!'}`,
                `Added channels will ${sub === 'on' ? 'now' : 'no longer'} auto-react on new posts.`
            ]);
        }

        // .autochreact list
        if (sub === 'list' || !sub) {
            const entries = Object.entries(config.channels);
            if (!entries.length) {
                return send([
                    'Result: 📋 No channels added yet.',
                    'Usage:\n   .autochreact add [channel link]\n   .autochreact remove [channel link]\n   .autochreact list\n   .autochreact on/off'
                ]);
            }
            const list = entries.map(([jid, info], i) => {
                const emojiTag = info.emojis?.length ? info.emojis.join('') : 'random';
                const countTag = info.sessionCount ? `${info.sessionCount} sessions` : 'all sessions';
                const lastTag = timeAgo(info.stats?.lastReactedAt);
                return `${i + 1}. ${info.name || jid} — ${emojiTag}, ${countTag}, ${info.delayMs || DEFAULT_DELAY_MS}ms, last: ${lastTag}`;
            }).join('\n');
            return send([
                `Status: ${config.enabled ? 'ON ✅' : 'OFF ❌'}`,
                `Channels:\n${list}`
            ]);
        }

        // .autochreact stats [link]
        if (sub === 'stats') {
            const link = args[1];
            if (!link) {
                // Overall stats across all channels.
                const entries = Object.entries(config.channels);
                if (!entries.length) return send(['Result: 📋 No channels added yet.']);
                let totalPosts = 0, totalReacted = 0, totalFailed = 0;
                for (const [, info] of entries) {
                    totalPosts += info.stats?.totalPosts || 0;
                    totalReacted += info.stats?.totalReacted || 0;
                    totalFailed += info.stats?.totalFailed || 0;
                }
                return send([
                    'Result: 📊 Overall Auto-Chreact Stats',
                    `Channels: ${entries.length}`,
                    `Total Posts: ${totalPosts}`,
                    `Total Reacted: ${totalReacted}`,
                    `Total Failed: ${totalFailed}`
                ]);
            }
            try {
                const { inviteCode } = parseChannelLink(link);
                const jid = inviteCode ? await resolveNewsletterJid(conn, inviteCode) : link.trim();
                const c = config.channels[jid];
                if (!c) return send(['Error: ⚠️ That channel isn\'t on the Auto-Chreact list.']);
                return send([
                    `Result: 📊 Stats for ${c.name}`,
                    `Total Posts: ${c.stats?.totalPosts || 0}`,
                    `Total Reacted: ${c.stats?.totalReacted || 0}`,
                    `Total Failed: ${c.stats?.totalFailed || 0}`,
                    `Last Reacted: ${timeAgo(c.stats?.lastReactedAt)}`
                ]);
            } catch (e) {
                return send(['Error: ⚠️ Could not resolve that channel.']);
            }
        }

        // .autochreact test <link> — readiness/health check, no reacts sent
        if (sub === 'test') {
            const link = args[1];
            if (!link) return send(['Error: ❗ Please provide a channel link to test.']);
            try {
                const r = await testChannelReadiness(conn, link);
                return send([
                    `Result: ${r.ready ? '✅ Ready — this channel will auto-react correctly.' : '⚠️ Not fully ready — see details below.'}`,
                    `On List: ${r.onList ? 'Yes' : 'No — use .autochreact add'}`,
                    `Auto-Chreact Enabled: ${r.globallyEnabled ? 'Yes' : 'No — use .autochreact on'}`,
                    `Connected Sessions: ${r.totalSessions}`,
                    `Sessions That Can React: ${r.capableSessions}`
                ]);
            } catch (e) {
                console.error('autochreact test error:', e);
                return send([`Error: ⚠️ ${e.message || "Couldn't test that channel."}`]);
            }
        }

        // .autochreact add [link] [emoji:..] [delay:..] [count:..] [follow:..]
        if (sub === 'add') {
            const link = args[1];
            if (!link) return send(['Error: ❗ Please provide a channel link.', 'Usage:\n   .autochreact add https://whatsapp.com/channel/xxxxxxxx']);
            const opts = parseSettingTokens(args.slice(2));
            try {
                const { name } = await addChannelByLink(conn, link, {
                    emojis: opts.emojis || [],
                    delayMs: opts.delayMs || DEFAULT_DELAY_MS,
                    sessionCount: opts.sessionCount || null,
                    autoFollow: opts.autoFollow !== null ? opts.autoFollow : true
                });
                return send([
                    'Result: ✅ Channel added to Auto-Chreact!',
                    `Channel: ${name}`,
                    `Emoji: ${opts.emojis?.length ? opts.emojis.join('') : 'random pool'}`,
                    `Delay: ${opts.delayMs || DEFAULT_DELAY_MS}ms`,
                    `Session Count: ${opts.sessionCount || 'all'}`,
                    `Auto-Follow: ${opts.autoFollow !== false ? 'on' : 'off'}`
                ]);
            } catch (e) {
                console.error('autochreact add error:', e);
                return send([`Error: ⚠️ ${e.message || "Couldn't add that channel. Make sure the link is correct."}`]);
            }
        }

        // .autochreact set [link] [emoji:..] [delay:..] [count:..] [follow:..]
        if (sub === 'set') {
            const link = args[1];
            if (!link) return send(['Error: ❗ Please provide a channel link.']);
            const opts = parseSettingTokens(args.slice(2));
            try {
                const { name, settings } = await updateChannelSettings(conn, link, opts);
                return send([
                    'Result: ✅ Settings updated!',
                    `Channel: ${name}`,
                    `Emoji: ${settings.emojis?.length ? settings.emojis.join('') : 'random pool'}`,
                    `Delay: ${settings.delayMs}ms`,
                    `Session Count: ${settings.sessionCount || 'all'}`,
                    `Auto-Follow: ${settings.autoFollow ? 'on' : 'off'}`
                ]);
            } catch (e) {
                console.error('autochreact set error:', e);
                return send([`Error: ⚠️ ${e.message || "Couldn't update that channel."}`]);
            }
        }

        // .autochreact remove [link or jid]
        if (sub === 'remove' || sub === 'del') {
            const link = args[1];
            if (!link) return send(['Error: ❗ Please provide a channel link or JID to remove.']);
            try {
                const { name } = await removeChannelByIdentifier(conn, link);
                return send([`Result: 🗑️ Removed from Auto-Chreact.`, `Channel: ${name}`]);
            } catch (e) {
                console.error('autochreact remove error:', e);
                return send([`Error: ⚠️ ${e.message || "Couldn't remove that channel."}`]);
            }
        }

        return send([
            'Error: ❗ Unknown option.',
            'Usage:\n   .autochreact add [link] [emoji:🔥,👍] [delay:500] [count:3] [follow:off]\n   .autochreact set [link] ...same options...\n   .autochreact remove [link]\n   .autochreact list\n   .autochreact stats [link]\n   .autochreact test [link]\n   .autochreact on/off'
        ]);
    }
};
