const fs = require('fs');
const path = require('path');

const MODE_FILE = path.join(__dirname, '..', 'bot-mode.json');

// ── All valid bot modes ──────────────────────────────────────────────
// private  → only the owner/bot number can use any command
// public   → everyone can use every command (default)
// groups   → commands only work inside groups, ignored in DMs
// dms      → commands only work in private chats, ignored in groups
// silent   → bot runs commands normally but never posts its own
//            crash/error text into the chat (still logs to console)
// buttons  → bot prefers interactive button replies where a command
//            supports it (currently: .menu) instead of plain text
// channel  → bot only responds to the channel-management owner
//            commands (.chf / .chvote / .jgroup / .chreact)
const VALID_MODES = ['private', 'public', 'groups', 'dms', 'silent', 'buttons', 'channel'];
const DEFAULT_MODE = 'public';

let currentMode = DEFAULT_MODE;

function loadMode() {
    try {
        if (fs.existsSync(MODE_FILE)) {
            const data = JSON.parse(fs.readFileSync(MODE_FILE, 'utf8'));
            if (VALID_MODES.includes(data.mode)) {
                currentMode = data.mode;
            }
        } else {
            saveMode(DEFAULT_MODE);
        }
    } catch (error) {
        console.error('❌ Error loading bot mode:', error.message);
        currentMode = DEFAULT_MODE;
    }
    return currentMode;
}

function saveMode(mode) {
    try {
        currentMode = mode;
        fs.writeFileSync(MODE_FILE, JSON.stringify({ mode, updatedAt: new Date().toISOString() }, null, 2));
        return true;
    } catch (error) {
        console.error('❌ Error saving bot mode:', error.message);
        return false;
    }
}

function getMode() {
    return currentMode;
}

function setMode(mode) {
    if (!VALID_MODES.includes(mode)) return false;
    return saveMode(mode);
}

function resetMode() {
    return saveMode(DEFAULT_MODE);
}

// Load mode on startup
loadMode();

module.exports = { getMode, setMode, resetMode, loadMode, VALID_MODES, DEFAULT_MODE };
