const logger = require('./logger');

/**
 * Retry async fn with exponential backoff (base * 2^attempt).
 */
async function withRetry(fn, { maxRetries, baseMs, label }) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === maxRetries - 1) break;
      const delay = baseMs * Math.pow(2, attempt);
      logger.warn('retrying after failure', {
        label,
        attempt: attempt + 1,
        maxRetries,
        delayMs: delay,
        err: String(e && e.message ? e.message : e),
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

module.exports = { withRetry };
