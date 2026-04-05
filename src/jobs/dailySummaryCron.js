const cron = require('node-cron');
const logger = require('../utils/logger');
const { getActiveClient } = require('../whatsapp/client');
const { getTargetGroupName } = require('../utils/targetGroup');

/** Brasília time (BRT/BRST). */
const TZ = 'America/Sao_Paulo';
/** Every day at 23:00 in TZ. */
const CRON = '0 23 * * *';

let task = null;

async function runScheduledSummaryAndPost() {
  const { runSummarization } = require('../summarizer');
  const { formatLatestSummaryText } = require('../utils/summaryFormat');
  const { postTextToGroup } = require('../whatsapp/postToGroup');

  const client = getActiveClient();
  if (!client || !client.info) {
    logger.warn('scheduled summarize+post skipped — whatsapp client not ready');
    return;
  }

  const effective = getTargetGroupName();
  if (!effective) {
    logger.warn(
      'scheduled summarize+post skipped — no effective group (set `group <title>` or TARGET_GROUP_NAME)'
    );
    return;
  }

  logger.info('scheduled summarize+post starting', { group: effective });

  let r;
  try {
    r = await runSummarization({ client });
  } catch (e) {
    logger.error('scheduled summarize threw', {
      err: String(e && e.message ? e.message : e),
    });
    return;
  }

  if (!r.ok) {
    logger.warn('scheduled summarize finished without success', {
      skippedReason: r.skippedReason,
    });
    return;
  }
  if (r.skippedReason === 'no_messages') {
    logger.info('scheduled summarize — no messages; skip post');
    return;
  }

  const text = formatLatestSummaryText();
  if (!text || text.startsWith('(invalid')) {
    logger.warn('scheduled post skipped — no valid summary text');
    return;
  }

  const groupToPost = r.detail?.targetGroup || getTargetGroupName();
  if (!groupToPost) {
    logger.warn('scheduled post skipped — no target group');
    return;
  }

  try {
    await postTextToGroup(client, groupToPost, text);
    logger.info('scheduled summarize+post completed', { group: groupToPost });
  } catch (e) {
    logger.error('scheduled post failed', {
      err: String(e && e.message ? e.message : e),
    });
  }
}

function startDailySummaryCron() {
  if (task) {
    task.stop();
    task = null;
  }
  task = cron.schedule(
    CRON,
    () => {
      runScheduledSummaryAndPost().catch((e) =>
        logger.error('scheduled job error', {
          err: String(e && e.message ? e.message : e),
        })
      );
    },
    { timezone: TZ }
  );
  logger.info('daily summary cron started', {
    cron: CRON,
    timezone: TZ,
    at: '23:00',
  });
}

function stopDailySummaryCron() {
  if (task) {
    task.stop();
    task = null;
    logger.info('daily summary cron stopped');
  }
}

function isDailySummaryCronRunning() {
  return task != null;
}

function getDailySummaryCronInfo() {
  return {
    running: task != null,
    timezone: TZ,
    timeLocal: '23:00',
    cronExpression: CRON,
  };
}

module.exports = {
  startDailySummaryCron,
  stopDailySummaryCron,
  isDailySummaryCronRunning,
  getDailySummaryCronInfo,
};
