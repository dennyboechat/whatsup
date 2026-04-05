const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  targetGroupName: process.env.TARGET_GROUP_NAME || '',
  /** Prefer messages from this many hours ending now (default 24). */
  summaryWindowHours: num('SUMMARY_WINDOW_HOURS', 24),
  /** If no text messages fall in the window, use this many most recent text messages. */
  summaryFallbackMessages: num('SUMMARY_FALLBACK_MESSAGES', 50),
  /** Max messages to pull from WhatsApp while resolving the window (expand until past window or cap). */
  summaryMaxFetchMessages: num('SUMMARY_MAX_FETCH_MESSAGES', 2000),
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openaiMaxRetries: num('OPENAI_MAX_RETRIES', 3),
  openaiRetryBaseMs: num('OPENAI_RETRY_BASE_MS', 1000),
  openaiMinRequestIntervalMs: num('OPENAI_MIN_REQUEST_INTERVAL_MS', 500),

  dataDir: path.resolve(__dirname, '../../data'),
  dbPath: path.resolve(__dirname, '../../data/whatsup.db'),
};

module.exports = { config };
