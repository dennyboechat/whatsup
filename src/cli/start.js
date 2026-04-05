#!/usr/bin/env node
/**
 * Starts the WhatsApp listener and an interactive command prompt (same terminal).
 * Type `summarize`, `report`, `cron start`, `status`, `groups`, `help`, or `exit`.
 */
const { getTargetGroupName } = require('../utils/targetGroup');
const logger = require('../utils/logger');
const { getDb } = require('../db');
const { createClient, runWithReconnect } = require('../whatsapp/client');
const { stopDailySummaryCron } = require('../jobs/dailySummaryCron');
const { startRepl } = require('../repl');

function validate() {
  if (!getTargetGroupName()) {
    logger.warn(
      'TARGET_GROUP_NAME is empty — set it in .env or type: group <group title> (then summarize / listener use that group)'
    );
  }
}

async function main() {
  validate();
  getDb();

  let rl;

  const shutdown = () => {
    stopDailySummaryCron();
    logger.info('shutting down');
    if (rl) rl.close();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);

  await runWithReconnect(createClient);

  rl = startRepl();
}

main().catch((e) => {
  logger.error('fatal', { err: String(e && e.message ? e.message : e) });
  process.exit(1);
});
