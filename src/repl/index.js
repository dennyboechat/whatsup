const readline = require('readline');
const { config } = require('../utils/config');
const logger = require('../utils/logger');
const { runSummarization } = require('../summarizer');
const { formatLatestSummaryText } = require('../utils/summaryFormat');
const { postTextToGroup } = require('../whatsapp/postToGroup');
const { formatStatusText } = require('../utils/statusText');
const { getActiveClient } = require('../whatsapp/client');
const {
  getTargetGroupName,
  setSessionTargetGroup,
  getSessionTargetGroupOverride,
} = require('../utils/targetGroup');
const { getLatestSummary } = require('../db');
const {
  startDailySummaryCron,
  stopDailySummaryCron,
  getDailySummaryCronInfo,
} = require('../jobs/dailySummaryCron');

function printSummarizeResult(r) {
  if (!r.ok) {
    if (r.skippedReason === 'missing_target_group') {
      console.log('FAILED — no target group. Set TARGET_GROUP_NAME in .env or: group <name>');
    } else if (r.skippedReason === 'whatsapp_error') {
      console.log('FAILED — could not load messages from WhatsApp.');
      if (r.detail?.message) console.log(String(r.detail.message));
    } else if (r.skippedReason === 'missing_api_key') {
      console.log('FAILED — OPENAI_API_KEY is not set.');
    } else if (r.skippedReason === 'parse_error') {
      console.log('FAILED — could not parse the model response as JSON.');
    } else {
      console.log('FAILED — see logs above.');
    }
    return;
  }
  if (r.skippedReason === 'no_messages') {
    console.log('Nothing to summarize — no text messages in the loaded batch.');
    if (r.detail?.hint) console.log(r.detail.hint);
    return;
  }
  if (r.summaryId != null && r.detail) {
    console.log(`Summary saved (id ${r.summaryId}, ${r.detail.messageCount} message(s) in batch).`);
    console.log('');
    const text = formatLatestSummaryText();
    if (text) console.log(text);
    return;
  }
  console.log('Done.');
}

async function runSummarizeWithOptionalGroup(rest, { oneOffLabel }) {
  const client = getActiveClient();
  if (!client || !client.info) {
    console.log('WhatsApp is not ready yet. Wait for "whatsapp client ready" in the logs.\n');
    return;
  }
  const oneShot = rest.join(' ').trim();
  if (oneOffLabel && !oneShot) {
    console.log(`Usage: ${oneOffLabel} <group title as shown in WhatsApp> (case-insensitive)\n`);
    return;
  }
  console.log(oneShot ? `One-off summarize: "${oneShot}" (effective group unchanged)\n` : 'Running summarize…\n');
  const r = await runSummarization({
    client,
    groupName: oneShot || undefined,
  });
  printSummarizeResult(r);
  console.log('');
}

async function cmdGroups() {
  const client = getActiveClient();
  if (!client || !client.info) {
    console.log('WhatsApp is not ready yet. Wait for "whatsapp client ready" in the logs.');
    return;
  }
  const chats = await client.getChats();
  const names = chats
    .filter((c) => c.isGroup)
    .map((c) => (c.name || '').trim() || '(unnamed group)')
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  console.log('');
  console.log('WhatsApp group names');
  console.log('---------------------');
  if (names.length === 0) console.log('(no groups)');
  else names.forEach((n) => console.log(n));
  console.log('');
  console.log(`Total: ${names.length} group(s)`);
  console.log('');
}

function cmdCron(rest) {
  const sub = (rest[0] || 'status').toLowerCase();
  if (sub === 'start') {
    startDailySummaryCron();
    const i = getDailySummaryCronInfo();
    console.log('');
    console.log(
      `Daily cron is ON — runs at ${i.timeLocal} ${i.timezone} (Brasília): summarize the effective group, then post.`
    );
    console.log('(Stops when you exit the app or run `cron stop`.)\n');
    return;
  }
  if (sub === 'stop') {
    stopDailySummaryCron();
    console.log('Daily cron is OFF.\n');
    return;
  }
  if (sub === 'status') {
    const i = getDailySummaryCronInfo();
    console.log('');
    console.log(
      `Daily cron: ${i.running ? 'ON' : 'OFF'} — ${i.timeLocal} ${i.timezone} (summarize + post to effective group)`
    );
    console.log('');
    return;
  }
  console.log('Usage: cron start | cron stop | cron status\n');
}

function cmdGroup(rest) {
  const sub = rest.join(' ').trim();
  if (!sub) {
    const eff = getTargetGroupName() || '(not set)';
    const env = (config.targetGroupName || '').trim() || '(empty)';
    const o = getSessionTargetGroupOverride();
    console.log('');
    console.log(`Effective group (listener + summarize): "${eff}"`);
    console.log(`TARGET_GROUP_NAME in .env:              "${env}"`);
    console.log(
      `Session override:                       ${o != null ? `"${o}"` : '(none)'}`
    );
    console.log('');
    console.log('Set:   group <exact group title>');
    console.log('Clear: group reset');
    console.log('');
    return;
  }
  const low = sub.toLowerCase();
  if (low === 'reset' || low === 'clear' || low === '--reset') {
    setSessionTargetGroup(null);
    console.log('Session override cleared. Using TARGET_GROUP_NAME from .env.\n');
    return;
  }
  setSessionTargetGroup(sub);
  console.log(`Target group set for this session to: "${getTargetGroupName()}"`);
  console.log('(Incoming messages and summarize use this name until you `group reset` or restart.)\n');
}

async function cmdPost(rest) {
  const client = getActiveClient();
  if (!client || !client.info) {
    console.log('WhatsApp is not ready yet. Wait for "whatsapp client ready" in the logs.\n');
    return;
  }
  const text = formatLatestSummaryText();
  if (!text) {
    console.log('No summary to post. Run `summarize` or `once` first.\n');
    return;
  }
  if (text.startsWith('(invalid')) {
    console.log('Latest summary in the database is invalid. Run `summarize` again.\n');
    return;
  }
  const explicit = rest.join(' ').trim();
  const latest = getLatestSummary();
  const fromSummary =
    latest && latest.group_name != null && String(latest.group_name).trim() !== ''
      ? String(latest.group_name).trim()
      : '';
  const groupTitle = explicit || fromSummary || getTargetGroupName();
  if (!groupTitle) {
    console.log(
      'No target group. This summary has no stored group (older DB row); set `group <title>` or: post <group title>\n'
    );
    return;
  }
  try {
    await postTextToGroup(client, groupTitle, text);
    console.log(`Posted latest summary to group: "${groupTitle}"\n`);
  } catch (e) {
    console.error(String(e && e.message ? e.message : e));
    console.log('');
  }
}

function startRepl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const help = () => {
    console.log(`
Commands:
  help       — list commands
  group      — show or set the default group for this session (\`group <title>\`, \`group reset\`)
  summarize  — summarize that default group
  once <title> — one-off summary for another group only (does not change \`group\`; name must match WhatsApp, case-insensitive)
  summarize <title> — same as \`once\`
  report     — latest saved summary
  status     — DB + effective group
  groups     — list WhatsApp group names (copy/paste a title for \`once\`)
  post       — send the **latest saved summary** to the **group that summary was built from** (override: \`post <title>\`)
  post <title> — post to another group (same title rules as \`once\`; case-insensitive)
  cron start — schedule daily 23:00 (Brasília): summarize + post to the **effective** group
  cron stop  — cancel that schedule
  cron status — show whether the daily job is on
  exit       — quit
`);
  };

  const prompt = () => {
    rl.question('WhatsUp> ', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        prompt();
        return;
      }
      const [cmd0, ...rest] = trimmed.split(/\s+/);
      const cmd = cmd0.toLowerCase();

      try {
        if (cmd === 'help' || cmd === '?') {
          help();
        } else if (cmd === 'exit' || cmd === 'quit') {
          logger.info('goodbye');
          stopDailySummaryCron();
          rl.close();
          process.exit(0);
          return;
        } else if (cmd === 'cron') {
          cmdCron(rest);
        } else if (cmd === 'group') {
          cmdGroup(rest);
        } else if (cmd === 'once') {
          await runSummarizeWithOptionalGroup(rest, { oneOffLabel: 'once' });
        } else if (cmd === 'summarize') {
          await runSummarizeWithOptionalGroup(rest, { oneOffLabel: null });
        } else if (cmd === 'report') {
          const text = formatLatestSummaryText();
          if (text) console.log(text);
          else console.log('No summaries yet. Run `summarize` first.\n');
        } else if (cmd === 'status') {
          console.log(formatStatusText());
        } else if (cmd === 'groups') {
          await cmdGroups();
        } else if (cmd === 'post') {
          await cmdPost(rest);
        } else {
          console.log(`Unknown command: "${cmd0}". Type \`help\` for a list.\n`);
        }
      } catch (e) {
        console.error(String(e && e.message ? e.message : e));
        console.log('');
      }

      prompt();
    });
  };

  console.log('');
  console.log('Interactive mode — type `help` (try `once <group name>` for a one-off summary).');
  prompt();

  return rl;
}

module.exports = { startRepl };
