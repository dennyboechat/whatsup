const { config } = require('./config');

/**
 * Optional session-only override (set via REPL `group <name>`).
 * When null, TARGET_GROUP_NAME from .env is used.
 */
let sessionOverride = null;

function getTargetGroupName() {
  if (sessionOverride != null && String(sessionOverride).trim() !== '') {
    return String(sessionOverride).trim();
  }
  return (config.targetGroupName || '').trim();
}

function setSessionTargetGroup(name) {
  if (name == null || String(name).trim() === '') {
    sessionOverride = null;
  } else {
    sessionOverride = String(name).trim();
  }
}

function getSessionTargetGroupOverride() {
  return sessionOverride;
}

module.exports = {
  getTargetGroupName,
  setSessionTargetGroup,
  getSessionTargetGroupOverride,
};
