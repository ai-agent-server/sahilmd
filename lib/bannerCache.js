// lib/bannerCache.js
// The menu-banner.jpg is read from disk on *every* .ping, .menu, and .hack
// reply. That repeated synchronous disk I/O briefly blocks Node's event
// loop each time, and adds up when several commands fire close together.
// This caches the buffer in memory once and reuses it everywhere.

const fs = require('fs');
const path = require('path');

const BANNER_PATH = path.join(__dirname, '..', 'public', 'menu-banner.jpg');

let cachedBuffer = null;
let cachedAt = 0;

function getBannerBuffer() {
    try {
        const stat = fs.statSync(BANNER_PATH);
        // Re-read only if the file changed since we cached it (e.g. admin
        // uploaded a new banner) or we haven't loaded it yet.
        if (!cachedBuffer || stat.mtimeMs > cachedAt) {
            cachedBuffer = fs.readFileSync(BANNER_PATH);
            cachedAt = stat.mtimeMs;
        }
        return cachedBuffer;
    } catch {
        return null; // banner file doesn't exist
    }
}

module.exports = { getBannerBuffer, BANNER_PATH };
