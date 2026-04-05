const OpenAI = require('openai');
const { config } = require('../utils/config');
const { getTargetGroupName } = require('../utils/targetGroup');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const { createRateLimiter } = require('../utils/rateLimiter');
const {
  getState,
  setState,
  insertSummary,
  countMessages,
  countMessagesForGroup,
} = require('../db');

const STATE_LAST_TS = 'last_summary_message_ts';

const rateLimited = createRateLimiter(config.openaiMinRequestIntervalMs);

const SUMMARY_SCHEMA_PROMPT = `You must respond with a single JSON object only (no markdown fences) with exactly these keys:
"topics": string array — main themes discussed
"decisions": string array — explicit decisions made
"action_items": string array — tasks or follow-ups mentioned
"questions": string array — open questions raised
"summary": string — 2-4 sentence overview

Use empty arrays when nothing applies. The "summary" string must always be non-empty (can be a brief note that there was little content).`;

function buildUserContent(rows) {
  const lines = rows.map((r) => {
    const t = new Date(r.timestamp).toISOString();
    return `[${t}] ${r.author}: ${r.message_text}`;
  });
  return `Here are chat messages from a single WhatsApp group, in chronological order:\n\n${lines.join(
    '\n'
  )}`;
}

function parseSummaryJson(text) {
  const parsed = JSON.parse(text);
  const keys = ['topics', 'decisions', 'action_items', 'questions', 'summary'];
  for (const k of keys) {
    if (!(k in parsed)) throw new Error(`missing key: ${k}`);
  }
  if (!Array.isArray(parsed.topics)) throw new Error('topics must be array');
  if (!Array.isArray(parsed.decisions)) throw new Error('decisions must be array');
  if (!Array.isArray(parsed.action_items)) throw new Error('action_items must be array');
  if (!Array.isArray(parsed.questions)) throw new Error('questions must be array');
  if (typeof parsed.summary !== 'string') throw new Error('summary must be string');
  return parsed;
}

/**
 * Loads messages from WhatsApp for TARGET_GROUP_NAME: prefers the last SUMMARY_WINDOW_HOURS
 * of text messages; if none in that window, uses the last SUMMARY_FALLBACK_MESSAGES.
 * Persists to SQLite (deduped), calls OpenAI.
 * @param {{ client?: object, groupName?: string }} options
 *   `client` — from the running listener to avoid a second browser.
 *   `groupName` — optional; defaults to session override or TARGET_GROUP_NAME.
 */
async function runSummarization(options = {}) {
  const { client: waClient, groupName: explicitGroup } = options;

  const targetGroup = (
    explicitGroup != null && String(explicitGroup).trim() !== ''
      ? String(explicitGroup).trim()
      : getTargetGroupName()
  );
  if (!targetGroup) {
    logger.error('No target group — set TARGET_GROUP_NAME in .env or use the `group` command');
    return { ok: false, skippedReason: 'missing_target_group' };
  }

  const { fetchRecentGroupMessagesForSummary } = require('../whatsapp/fetchGroupHistory');
  let rows;
  try {
    rows = await fetchRecentGroupMessagesForSummary({
      client: waClient,
      groupName: targetGroup,
      windowHours: config.summaryWindowHours,
      fallbackMessageCount: config.summaryFallbackMessages,
      maxFetchMessages: config.summaryMaxFetchMessages,
      persistToDb: true,
    });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    logger.error('whatsapp message fetch failed', { err: msg });
    return {
      ok: false,
      skippedReason: 'whatsapp_error',
      detail: { message: msg },
    };
  }

  if (!rows.length) {
    logger.info('summarize skipped — no text messages loaded from WhatsApp', {
      targetGroup,
      windowHours: config.summaryWindowHours,
      fallbackMessages: config.summaryFallbackMessages,
    });
    return {
      ok: true,
      skippedReason: 'no_messages',
      detail: {
        targetGroup,
        totalMessagesInDb: countMessages(),
        messagesForTarget: countMessagesForGroup(targetGroup),
        hint:
          'No text messages in the loaded batch (empty/media-only skipped), or the chat has no history loaded yet.',
      },
    };
  }

  if (!config.openaiApiKey) {
    logger.error('OPENAI_API_KEY is not set; cannot summarize pending messages', {
      pendingMessageCount: rows.length,
    });
    return {
      ok: false,
      skippedReason: 'missing_api_key',
      detail: { pendingMessageCount: rows.length },
    };
  }

  const startTime = rows[0].timestamp;
  const endTime = rows[rows.length - 1].timestamp;

  logger.info('calling OpenAI for summarization', {
    model: config.openaiModel,
    messageCount: rows.length,
  });

  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  const callApi = () =>
    rateLimited(() =>
      openai.chat.completions.create({
        model: config.openaiModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SUMMARY_SCHEMA_PROMPT },
          { role: 'user', content: buildUserContent(rows) },
        ],
      })
    );

  const content = await withRetry(
    async () => {
      const res = await callApi();
      const c = res.choices[0]?.message?.content;
      if (!c) throw new Error('empty completion');
      return c;
    },
    {
      maxRetries: config.openaiMaxRetries,
      baseMs: config.openaiRetryBaseMs,
      label: 'openai.chat.completions',
    }
  );

  let structured;
  try {
    structured = parseSummaryJson(content);
  } catch (e) {
    logger.error('failed to parse model json', {
      err: String(e && e.message ? e.message : e),
    });
    return { ok: false, skippedReason: 'parse_error' };
  }

  const summaryJson = JSON.stringify(structured);
  const id = insertSummary({
    startTime,
    endTime,
    summaryJson,
    groupName: targetGroup,
  });

  setState(STATE_LAST_TS, String(endTime));

  logger.info('summary stored', {
    id: String(id),
    messages: rows.length,
    startTime,
    endTime,
  });

  return {
    ok: true,
    summaryId: id,
    detail: {
      targetGroup,
      messageCount: rows.length,
      startTime,
      endTime,
    },
  };
}

module.exports = { runSummarization, STATE_LAST_TS };
