const { config } = require('./config');
const {
  getTargetGroupName,
  getSessionTargetGroupOverride,
} = require('./targetGroup');
const {
  getState,
  countMessages,
  countMessagesForGroup,
  listDistinctGroupNames,
} = require('../db');
const { getDailySummaryCronInfo } = require('../jobs/dailySummaryCron');

const STATE_LAST_TS = 'last_summary_message_ts';

function formatStatusText() {
  const effective = getTargetGroupName() || '(empty)';
  const envDefault = (config.targetGroupName || '').trim() || '(empty)';
  const override = getSessionTargetGroupOverride();
  const lastTs = getState(STATE_LAST_TS);
  const total = countMessages();
  const forTarget =
    effective !== '(empty)' ? countMessagesForGroup(effective) : 0;
  const groups = listDistinctGroupNames();
  const cron = getDailySummaryCronInfo();

  const lines = [
    '',
    'WhatsUp status',
    '--------------',
    `Daily cron (23:00 ${cron.timezone}):  ${cron.running ? 'ON' : 'OFF'}`,
    `Effective target group:     "${effective}"`,
    `TARGET_GROUP_NAME (.env):   "${envDefault}"`,
    `Session override (REPL):    ${override != null ? `"${override}"` : '(none — using .env)'}`,
    `Messages in DB (all groups):   ${total}`,
    `Messages for effective group:  ${forTarget}`,
    `Last summarized up to (msg ts): ${
      lastTs != null
        ? new Date(Number(lastTs)).toISOString()
        : '(none yet)'
    }`,
  ];
  if (groups.length) {
    lines.push('');
    lines.push('Group name(s) stored in DB:');
    groups.forEach((n) => lines.push(`  - "${n}"`));
  } else {
    lines.push('');
    lines.push('No messages in the database yet.');
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = { formatStatusText };
