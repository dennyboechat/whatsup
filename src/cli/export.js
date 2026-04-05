#!/usr/bin/env node
/**
 * Bonus: export latest summary to data/exports/summary-<timestamp>.md
 */
const logger = require('../utils/logger');
const { exportLatestSummary } = require('../utils/exportMarkdown');

const out = exportLatestSummary();
if (!out) {
  console.log('Nothing to export yet.');
  process.exit(0);
}
logger.info('exported markdown', { path: out });
console.log(out);
