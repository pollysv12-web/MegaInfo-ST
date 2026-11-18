// Где взять Chromium: MEGAINFO_CHROMIUM_PATH, системный /usr/bin/chromium или браузер самого Playwright.
const fs = require('node:fs');

module.exports = function chromiumPath() {
    if (process.env.MEGAINFO_CHROMIUM_PATH) return process.env.MEGAINFO_CHROMIUM_PATH;
    return fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
};
