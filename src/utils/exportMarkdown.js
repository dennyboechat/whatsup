const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { getLatestSummary } = require('../db');

/**
 * Bonus: write latest summary to a Markdown file under data/exports/.
 */
function exportLatestSummary() {
  const row = getLatestSummary();
  if (!row) return null;

  let data;
  try {
    data = JSON.parse(row.summary_json);
  } catch {
    return null;
  }

  const dir = path.join(config.dataDir, 'exports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date(row.created_at).toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `summary-${stamp}.md`);

  const lines = [
    `# WhatsUp summary`,
    ``,
    `- Created: ${new Date(row.created_at).toISOString()}`,
    ...(row.group_name ? [`- Group: ${row.group_name}`] : []),
    `- Message window: ${new Date(row.start_time).toISOString()} → ${new Date(
      row.end_time
    ).toISOString()}`,
    ``,
    `## Overview`,
    ``,
    data.summary || '',
    ``,
  ];

  function section(title, arr) {
    lines.push(`## ${title}`, ``);
    if (!arr || !arr.length) lines.push(`_None_`, ``);
    else arr.forEach((x) => lines.push(`- ${x}`));
    lines.push(``);
  }

  section('Topics', data.topics);
  section('Decisions', data.decisions);
  section('Action items', data.action_items);
  section('Questions', data.questions);

  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

module.exports = { exportLatestSummary };
