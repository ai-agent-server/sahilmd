let ghostInterval = null;
let ghostState = 'off'; // tracks current ghost mode for .ghost status
let ghostIntervalMs = 4000; // used by auto/random loops, changeable via .ghost interval
let ghostGroupTarget = null; // if set (via .ghost group on), presence updates target this group jid
let ghostScheduleTimeout = null; // holds the pending daily schedule timer
let ghostScheduleInfo = null; // human-readable description of the active schedule

function msUntil(hhmm) {
    const [h, min] = hhmm.split(':').map(Number);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1); // roll over to tomorrow
    return target - now;
}

// Baileys silently drops "available"/"unavailable" presence updates (no
// error thrown — it just no-ops with a log warning) if the auth state's
// authState.creds.me.name isn't populated yet, which can happen right after
// a fresh pairing-code login. That made .ghost online/offline look totally
// broken with no indication why. This backfills a name from whatever the
// socket already knows so the update actually goes out.
function ensureMeName(conn) {
    try {
        const creds = conn?.authState?.creds;
        if (creds && creds.me && !creds.me.name) {
            creds.me.name = conn.user?.name || conn.user?.notify || creds.me.id?.split('@')[0] || 'User';
        }
    } catch (e) { /* best-effort only */ }
}

module.exports = {
    pattern: "ghost",
    desc: "Manually set the bot's presence status (online, offline, typing, recording, schedule)",
    react: "👻",
    category: "user",
    use: ".ghost [online/offline/typing/recording/read/pause/auto/random/interval/group/schedule/status/off]",
    filename: __filename,

    execute: async (conn, mek, m, { from, args, isOwner, reply }) => {
        if (!isOwner) return reply("❌ Only the bot owner can use this command.");

        await conn.sendMessage(from, { react: { text: '👻', key: mek.key } });

        const action = args[0]?.toLowerCase();
        const target = ghostGroupTarget || from;

        const box = (title, lines) =>
            `*●⏤꯭👻 ${title}𓂃ꜛ⸙*\n\n` +
            lines.map(l => `*├⬗* ${l}`).join('\n') + `\n\n` +
            `> *© ᴩᴏᴡᴇʀᴇᴅ ʙʏ : ᴅʀ ʜᴏɴᴇʏ ᴛᴇᴄʜx*`;

        if (!action) {
            return reply(box('GHOST', [
                'Commands:',
                '.ghost online — Show Online',
                '.ghost offline — Show Offline',
                '.ghost typing — Show Typing',
                '.ghost recording — Show Recording',
                '.ghost read — Mark Chat as Read',
                '.ghost off — Disable'
            ]));
        }

        // "interval", "group" and "schedule" don't set a live presence state themselves,
        // so they're handled before we touch the auto-loop / clear it.
        if (action === 'interval') {
            const secs = parseInt(args[1], 10);
            if (!secs || secs < 1) return reply(box('GHOST', ['❌ Usage: `.ghost interval <seconds>` (e.g. `.ghost interval 5`)']));
            ghostIntervalMs = secs * 1000;
            return reply(box('GHOST', [
                `✅ Auto/random interval set to *${secs}s*.`,
                ghostInterval ? 'Restart `.ghost auto` or `.ghost random` for the new interval to apply.' : ''
            ].filter(Boolean)));
        }

        if (action === 'group') {
            const val = args[1]?.toLowerCase();
            if (val === 'on') {
                if (!from.endsWith('@g.us')) return reply(box('GHOST', ['❌ Run `.ghost group on` inside the group you want to target.']));
                ghostGroupTarget = from;
                return reply(box('GHOST', ['✅ Ghost presence will now target *this group* only.']));
            }
            if (val === 'off') {
                ghostGroupTarget = null;
                return reply(box('GHOST', ['✅ Ghost presence target reset to whichever chat the command is run in.']));
            }
            return reply(box('GHOST', ['❌ Usage: `.ghost group on` or `.ghost group off`']));
        }

        if (action === 'schedule') {
            const sub = args[1]?.toLowerCase();

            if (sub === 'off') {
                if (ghostScheduleTimeout) clearTimeout(ghostScheduleTimeout);
                ghostScheduleTimeout = null;
                ghostScheduleInfo = null;
                return reply(box('GHOST', ['✅ Schedule cancelled.']));
            }

            const state = sub;
            const time = args[2];
            const validStates = ['online', 'offline', 'typing', 'recording', 'pause', 'auto', 'random', 'off'];

            if (!validStates.includes(state) || !/^\d{1,2}:\d{2}$/.test(time || '')) {
                return reply(box('GHOST', ['❌ Usage: `.ghost schedule <state> <HH:MM>`', 'Example: `.ghost schedule online 08:00`']));
            }

            if (ghostScheduleTimeout) clearTimeout(ghostScheduleTimeout);

            const runScheduled = async () => {
                try {
                    const scheduleTarget = ghostGroupTarget || from;
                    const map = { online: 'available', offline: 'unavailable', typing: 'composing', recording: 'recording', pause: 'paused', off: 'paused' };
                    if (map[state]) {
                        if (map[state] === 'available' || map[state] === 'unavailable') ensureMeName(conn);
                        await conn.sendPresenceUpdate(map[state], scheduleTarget);
                        ghostState = state;
                    }
                    // Reschedule for the same time tomorrow
                    ghostScheduleTimeout = setTimeout(runScheduled, msUntil(time));
                } catch (e) { /* ignore transient errors, next cycle will retry */ }
            };

            ghostScheduleTimeout = setTimeout(runScheduled, msUntil(time));
            ghostScheduleInfo = `${state} daily at ${time}`;
            return reply(box('GHOST', [`✅ Scheduled: *${state}* every day at *${time}*.`]));
        }

        // Stop any previous auto-loop before applying a new state
        if (ghostInterval) {
            clearInterval(ghostInterval);
            ghostInterval = null;
        }

        try {
            if (action === 'online') {
                ensureMeName(conn);
                // Reply BEFORE the presence call — sending any message to a
                // chat instantly clears "typing/recording/online" indicators
                // on WhatsApp's side, so if we sent our confirmation text
                // after the presence update, it would immediately cancel the
                // very presence we just set.
                await reply(box('GHOST', ['✅ Presence set to: *Online*']));
                await conn.sendPresenceUpdate('available', target);
                ghostState = 'online';
                return;
            }

            if (action === 'offline') {
                ensureMeName(conn);
                await reply(box('GHOST', ['✅ Presence set to: *Offline*']));
                await conn.sendPresenceUpdate('unavailable', target);
                ghostState = 'offline';
                return;
            }

            if (action === 'typing') {
                await reply(box('GHOST', ['✅ Presence set to: *Typing...*']));
                await conn.sendPresenceUpdate('composing', target);
                ghostState = 'typing';
                return;
            }

            if (action === 'recording') {
                await reply(box('GHOST', ['✅ Presence set to: *Recording audio...*']));
                await conn.sendPresenceUpdate('recording', target);
                ghostState = 'recording';
                return;
            }

            if (action === 'pause') {
                await reply(box('GHOST', ['✅ Typing/recording indicator cleared.']));
                await conn.sendPresenceUpdate('paused', target);
                ghostState = 'paused';
                return;
            }

            if (action === 'auto') {
                await reply(box('GHOST', ['✅ Auto mode enabled — cycling typing/recording.', 'Use `.ghost off` to stop.']));
                let toggle = true;
                ghostInterval = setInterval(async () => {
                    try {
                        await conn.sendPresenceUpdate(toggle ? 'composing' : 'recording', target);
                        toggle = !toggle;
                    } catch (e) { /* ignore transient errors */ }
                }, ghostIntervalMs);
                ghostState = 'auto (typing/recording loop)';
                return;
            }

            if (action === 'random') {
                await reply(box('GHOST', ['✅ Random mode enabled — presence will switch unpredictably.', 'Use `.ghost off` to stop.']));
                const states = ['composing', 'recording', 'available', 'unavailable', 'paused'];
                ghostInterval = setInterval(async () => {
                    try {
                        const pick = states[Math.floor(Math.random() * states.length)];
                        if (pick === 'available' || pick === 'unavailable') ensureMeName(conn);
                        await conn.sendPresenceUpdate(pick, target);
                    } catch (e) { /* ignore transient errors */ }
                }, ghostIntervalMs);
                ghostState = 'random (switching states)';
                return;
            }

            if (action === 'read') {
                try {
                    await conn.readMessages([mek.key]);
                } catch (e) { /* ignore if already read / unsupported */ }
                return reply(box('GHOST', ['✅ Chat marked as read.']));
            }

            if (action === 'status') {
                return reply(box('GHOST', [
                    `Current mode: *${ghostState}*`,
                    `Interval: *${ghostIntervalMs / 1000}s*`,
                    `Group target: *${ghostGroupTarget ? ghostGroupTarget.split('@')[0] : 'chat the command is run in'}*`,
                    `Schedule: *${ghostScheduleInfo || 'none'}*`
                ]));
            }

            if (action === 'off') {
                await reply(box('GHOST', ['✅ Ghost mode disabled. Back to normal.']));
                await conn.sendPresenceUpdate('paused', target);
                ghostState = 'off';
                return;
            }

            return reply(box('GHOST', ['❌ Invalid option. Use `.ghost` to see all options.']));

        } catch (e) {
            console.error('Ghost error:', e);
            return reply(box('GHOST', [`❌ Error: ${e.message}`]));
        }
    }
};
