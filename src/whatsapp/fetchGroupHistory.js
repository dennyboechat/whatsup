const qrcode = require('qrcode-terminal');
const logger = require('../utils/logger');
const { createSessionClient } = require('./client');
const { insertMessageIfNew } = require('../db');

function oldestMessageMs(msgs) {
  if (!msgs.length) return Date.now();
  return Math.min(...msgs.map((m) => (m.timestamp || 0) * 1000));
}

/**
 * Fetch enough history that either the oldest message is before `cutoffMs` or we hit `maxFetch`.
 */
async function fetchMessagesCoveringWindow(group, { cutoffMs, maxFetch, minFirstFetch }) {
  let limit = Math.min(Math.max(minFirstFetch, 50), maxFetch);
  let msgs = [];
  for (;;) {
    msgs = await group.fetchMessages({ limit });
    if (!msgs.length) break;
    const oldestMs = oldestMessageMs(msgs);
    if (msgs.length < limit || oldestMs < cutoffMs || limit >= maxFetch) break;
    limit = Math.min(Math.max(limit * 2, limit + 1), maxFetch);
  }
  return msgs;
}

/**
 * Uses an already-connected client (e.g. from `npm run start`) — no second browser.
 */
async function loadGroupMessagesFromClient(
  client,
  {
    groupName,
    windowHours,
    fallbackMessageCount,
    maxFetchMessages,
    persistToDb = true,
  }
) {
  if (!client || !client.info) {
    throw new Error('WhatsApp is not connected yet. Wait until the client is ready.');
  }

  const target = (groupName || '').trim().toLowerCase();
  if (!target) throw new Error('groupName is required');

  const chats = await client.getChats();
  const group = chats.find(
    (c) => c.isGroup && (c.name || '').trim().toLowerCase() === target
  );

  if (!group) {
    throw new Error(
      `Group "${groupName}" not found. Try the \`groups\` command to list names.`
    );
  }

  const cutoffMs = Date.now() - windowHours * 3600 * 1000;
  const minFirstFetch = Math.min(
    maxFetchMessages,
    Math.max(fallbackMessageCount, 100)
  );

  logger.info('fetching messages from WhatsApp', {
    group: group.name,
    windowHours,
    fallbackMessageCount,
    maxFetchMessages,
    cutoffIso: new Date(cutoffMs).toISOString(),
  });

  const msgs = await fetchMessagesCoveringWindow(group, {
    cutoffMs,
    maxFetch: maxFetchMessages,
    minFirstFetch,
  });

  const rows = [];
  for (const m of msgs) {
    if (m.hasMedia) continue;
    const body = (m.body || '').trim();
    if (!body) continue;

    let authorLabel = m.author || m.from || 'unknown';
    try {
      const contact = await m.getContact();
      if (contact && contact.pushname) authorLabel = contact.pushname;
      else if (contact && contact.name) authorLabel = contact.name;
    } catch (_) {
      /* best-effort */
    }

    const ts = m.timestamp ? m.timestamp * 1000 : Date.now();
    const waId = m.id?._serialized || null;
    const gname = (group.name || groupName).trim();

    rows.push({
      timestamp: ts,
      author: authorLabel,
      group_name: gname,
      message_text: body,
    });

    if (persistToDb) {
      insertMessageIfNew({
        waMessageId: waId,
        timestamp: ts,
        author: authorLabel,
        groupName: gname,
        messageText: body,
      });
    }
  }

  rows.sort((a, b) => a.timestamp - b.timestamp);

  const inWindow = rows.filter((r) => r.timestamp >= cutoffMs);
  if (inWindow.length > 0) {
    logger.info('summary batch: using messages in time window', {
      count: inWindow.length,
      windowHours,
    });
    return inWindow;
  }

  const fallback = rows.slice(-fallbackMessageCount);
  logger.info('summary batch: no messages in window; using fallback tail', {
    count: fallback.length,
    fallbackMessageCount,
  });
  return fallback;
}

/**
 * Standalone: own session, then disconnect. Use when `npm run start` is not running.
 */
async function fetchRecentGroupMessagesForSummary({
  client: existingClient,
  groupName,
  windowHours,
  fallbackMessageCount,
  maxFetchMessages,
  persistToDb = true,
}) {
  if (existingClient) {
    return loadGroupMessagesFromClient(existingClient, {
      groupName,
      windowHours,
      fallbackMessageCount,
      maxFetchMessages,
      persistToDb,
    });
  }

  const target = (groupName || '').trim().toLowerCase();
  if (!target) throw new Error('groupName is required');

  const client = createSessionClient();

  client.on('qr', (qr) => {
    logger.info('scan this qr code with whatsapp mobile app');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    logger.info('whatsapp authenticated');
  });

  try {
    await new Promise((resolve, reject) => {
      const ms = 180000;
      const timer = setTimeout(
        () => reject(new Error('Timeout waiting for WhatsApp (ready)')),
        ms
      );
      client.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
      client.once('auth_failure', (m) => {
        clearTimeout(timer);
        reject(new Error(`WhatsApp auth failure: ${String(m)}`));
      });
      client.initialize().catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
    });

    return await loadGroupMessagesFromClient(client, {
      groupName,
      windowHours,
      fallbackMessageCount,
      maxFetchMessages,
      persistToDb,
    });
  } finally {
    await client.destroy().catch(() => {});
  }
}

module.exports = {
  fetchRecentGroupMessagesForSummary,
  loadGroupMessagesFromClient,
};
