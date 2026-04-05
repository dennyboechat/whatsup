#!/usr/bin/env node
/**
 * Manual summarization: connects to WhatsApp (same session), loads messages for TARGET_GROUP_NAME
 * (prefers SUMMARY_WINDOW_HOURS, else last SUMMARY_FALLBACK_MESSAGES), writes them to the DB (deduped), then calls OpenAI.
 * Stop `npm run start` first so the session is not locked by two processes.
 *
 * Optional: npm run summarize -- "Exact Group Title"   (overrides .env for this run only)
 */
const { config } = require('../utils/config');
const logger = require('../utils/logger');
const { runSummarization } = require('../summarizer');

const argvGroup = process.argv.slice(2).filter(Boolean).join(' ').trim();

function printHumanOutcome(r) {
  console.log('');
  console.log('=== WhatsUp summarize ===');
  if (!r.ok) {
    if (r.skippedReason === 'missing_target_group') {
      console.log('Result: FAILED — no target group (set TARGET_GROUP_NAME or pass: npm run summarize -- "Group Name").');
    } else if (r.skippedReason === 'whatsapp_error') {
      console.log('Result: FAILED — could not load messages from WhatsApp.');
      if (r.detail?.message) console.log(`  ${r.detail.message}`);
      console.log('  Stop `npm run start` if it is running, then try again.');
    } else if (r.skippedReason === 'missing_api_key') {
      console.log('Result: FAILED — OPENAI_API_KEY is not set.');
      if (r.detail?.pendingMessageCount) {
        console.log(
          `  (${r.detail.pendingMessageCount} message(s) were waiting — add the key and run again.)`
        );
      }
    } else if (r.skippedReason === 'parse_error') {
      console.log('Result: FAILED — could not parse the model response as JSON.');
    } else {
      console.log('Result: FAILED — see JSON log lines above.');
    }
    console.log('');
    return;
  }

  if (r.skippedReason === 'no_messages') {
    console.log('Result: Nothing to do — no messages to summarize.');
    const d = r.detail || {};
    console.log(
      `  Window: last ${config.summaryWindowHours}h (fallback: last ${config.summaryFallbackMessages} messages) for "${d.targetGroup || '(unknown)'}"`
    );
    if (d.hint) console.log(`  ${d.hint}`);
    console.log('');
    console.log('  Tip: Run `npm run report` after a successful summary to read it.');
    console.log('');
    return;
  }

  if (r.summaryId != null && r.detail) {
    console.log('Result: OK — summary saved.');
    console.log('  Messages were loaded from WhatsApp for this run (see SUMMARY_WINDOW_HOURS / SUMMARY_FALLBACK_MESSAGES).');
    console.log(`  Summary id: ${r.summaryId}`);
    console.log(`  Messages in batch: ${r.detail.messageCount}`);
    console.log(
      `  Time range: ${new Date(r.detail.startTime).toISOString()} → ${new Date(
        r.detail.endTime
      ).toISOString()}`
    );
    console.log('');
    console.log('  Read it with: npm run report');
    console.log('');
    return;
  }

  console.log('Result: OK.');
  console.log('');
}

console.log('Running summarize…');

runSummarization({ groupName: argvGroup || undefined })
  .then((r) => {
    printHumanOutcome(r);
    if (!r.ok) process.exitCode = 1;
    logger.info('summarize finished', { result: r });
  })
  .catch((e) => {
    console.log('');
    console.log('=== WhatsUp summarize ===');
    console.log('Result: ERROR —', String(e && e.message ? e.message : e));
    console.log('');
    logger.error('summarize failed', {
      err: String(e && e.message ? e.message : e),
    });
    process.exit(1);
  });
