// lib/disabledCommands.js
// Lets the owner disable individual commands globally from the admin panel
// without touching any code. A disabled command is skipped when a user
// tries to run it (a message is sent back instead).
//
// Persisted in Postgres (via cachedDbStore) so the disabled list survives
// a Heroku dyno restart/redeploy instead of being wiped.

const { preload, getCached, setCached } = require('./cachedDbStore');

const KEY = 'disabled-commands';
const DEFAULT = () => ([]);

const ready = preload(KEY, DEFAULT);

function loadDisabled() {
    const data = getCached(KEY, DEFAULT);
    return Array.isArray(data) ? data : [];
}

function saveDisabled(list) {
    setCached(KEY, list);
}

function isDisabled(commandName) {
    return loadDisabled().includes(commandName);
}

// Returns the new disabled state (true = now disabled)
function toggle(commandName) {
    const list = loadDisabled();
    const idx = list.indexOf(commandName);
    if (idx === -1) {
        list.push(commandName);
        saveDisabled(list);
        return true;
    } else {
        list.splice(idx, 1);
        saveDisabled(list);
        return false;
    }
}

module.exports = { isDisabled, toggle, loadDisabled, ready };
