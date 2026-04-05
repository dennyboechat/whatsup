#!/usr/bin/env node
/**
 * Prints the latest summary in a readable plain-text format.
 */
const { formatLatestSummaryText } = require('../utils/summaryFormat');

function main() {
  const text = formatLatestSummaryText();
  if (!text) {
    console.log('No summaries yet. Run `npm run summarize` or type `summarize` in the running app.');
    process.exit(0);
    return;
  }
  console.log(text);
}

main();
