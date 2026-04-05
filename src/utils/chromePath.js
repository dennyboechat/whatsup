const fs = require('fs');
const os = require('os');

/**
 * Prefer system Chrome/Chromium when Puppeteer's bundled browser is missing.
 * Set PUPPETEER_EXECUTABLE_PATH (or CHROME_PATH) to override.
 */
function candidates() {
  const fromEnv =
    process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '';
  if (fromEnv.trim()) return [fromEnv.trim()];

  const platform = os.platform();
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  if (platform === 'linux') {
    return [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ];
  }
  if (platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    return [
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pfx86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ];
  }
  return [];
}

function getChromeExecutablePath() {
  for (const p of candidates()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

module.exports = { getChromeExecutablePath, candidates };
