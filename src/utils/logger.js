/**
 * Minimal structured logging to stdout (local dev friendly).
 */
function ts() {
  return new Date().toISOString();
}

function log(level, msg, extra) {
  const line = { time: ts(), level, msg, ...extra };
  console.log(JSON.stringify(line));
}

module.exports = {
  info: (msg, extra) => log('info', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  error: (msg, extra) => log('error', msg, extra),
  debug: (msg, extra) => log('debug', msg, extra),
};
