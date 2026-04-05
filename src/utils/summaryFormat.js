const { getLatestSummary } = require('../db');

/**
 * Human-readable text for the latest summary row, or null if none.
 */
function formatLatestSummaryText() {
  const row = getLatestSummary();
  if (!row) return null;

  let data;
  try {
    data = JSON.parse(row.summary_json);
  } catch {
    return '(invalid summary JSON in database)\n';
  }

  const lines = [];
  if (row.group_name) lines.push(`Group:       ${row.group_name}`);
  lines.push('Summary', data.summary || '', '');
  const sections = [
    ['Topics', data.topics],
    ['Decisions', data.decisions],
    ['Action items', data.action_items],
    ['Questions', data.questions],
  ];
  for (const [title, arr] of sections) {
    lines.push(title);
    if (!arr || !arr.length) lines.push('  (none)');
    else arr.forEach((x) => lines.push(`  - ${x}`));
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { formatLatestSummaryText };
