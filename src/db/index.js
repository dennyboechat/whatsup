const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('../utils/config');
const logger = require('../utils/logger');

let dbInstance;

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

function columnExists(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === col);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_message_id TEXT UNIQUE,
      timestamp INTEGER NOT NULL,
      author TEXT NOT NULL,
      group_name TEXT NOT NULL,
      message_text TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_name);

    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      summary_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  if (!columnExists(db, 'summaries', 'group_name')) {
    db.exec('ALTER TABLE summaries ADD COLUMN group_name TEXT');
  }
}

function getDb() {
  if (dbInstance) return dbInstance;
  ensureDataDir();
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  dbInstance = db;
  return db;
}

function insertMessageIfNew({
  waMessageId,
  timestamp,
  author,
  groupName,
  messageText,
}) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO messages (wa_message_id, timestamp, author, group_name, message_text)
    VALUES (@waMessageId, @timestamp, @author, @groupName, @messageText)
  `);
  const info = stmt.run({
    waMessageId: waMessageId || null,
    timestamp,
    author,
    groupName,
    messageText,
  });
  return info.changes > 0;
}

function getState(key) {
  const row = getDb()
    .prepare('SELECT value FROM app_state WHERE key = ?')
    .get(key);
  return row ? row.value : null;
}

function setState(key, value) {
  getDb()
    .prepare(
      'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, String(value));
}

function groupNameMatchLower() {
  return `lower(trim(group_name))`;
}

/**
 * Incremental messages: strictly after lastProcessedTs, capped by maxMessages.
 * Scoped to one group when groupName is set (case-insensitive).
 */
function getMessagesForSummary({ lastProcessedTs, maxMessages, groupName }) {
  const db = getDb();
  const after = lastProcessedTs;
  const g = (groupName || '').trim().toLowerCase();

  const sql = g
    ? `
    SELECT id, timestamp, author, group_name, message_text
    FROM messages
    WHERE timestamp > @after AND ${groupNameMatchLower()} = @g
    ORDER BY timestamp ASC
    LIMIT @maxMessages
  `
    : `
    SELECT id, timestamp, author, group_name, message_text
    FROM messages
    WHERE timestamp > @after
    ORDER BY timestamp ASC
    LIMIT @maxMessages
  `;

  const rows = g
    ? db.prepare(sql).all({ after, maxMessages, g })
    : db.prepare(sql).all({ after, maxMessages });

  return rows;
}

/**
 * First run (no prior summary): the N most recent messages for a group, oldest-first for the LLM.
 */
function getLastMessagesChronological({ limit, groupName }) {
  const db = getDb();
  const g = (groupName || '').trim().toLowerCase();

  const sql = g
    ? `
    SELECT id, timestamp, author, group_name, message_text
    FROM messages
    WHERE ${groupNameMatchLower()} = @g
    ORDER BY timestamp DESC
    LIMIT @limit
  `
    : `
    SELECT id, timestamp, author, group_name, message_text
    FROM messages
    ORDER BY timestamp DESC
    LIMIT @limit
  `;

  const rows = g
    ? db.prepare(sql).all({ limit, g })
    : db.prepare(sql).all({ limit });
  return rows.reverse();
}

function countMessagesForGroup(groupName) {
  const g = (groupName || '').trim().toLowerCase();
  if (!g) return countMessages();
  const row = getDb()
    .prepare(
      `
    SELECT COUNT(*) AS c FROM messages WHERE ${groupNameMatchLower()} = @g
  `
    )
    .get({ g });
  return row ? row.c : 0;
}

function listDistinctGroupNames() {
  return getDb()
    .prepare(
      `
    SELECT DISTINCT group_name AS name FROM messages ORDER BY name COLLATE NOCASE
  `
    )
    .all()
    .map((r) => r.name);
}

function insertSummary({ startTime, endTime, summaryJson, groupName }) {
  const db = getDb();
  const info = db
    .prepare(
      `
    INSERT INTO summaries (start_time, end_time, summary_json, created_at, group_name)
    VALUES (@startTime, @endTime, @summaryJson, @createdAt, @groupName)
  `
    )
    .run({
      startTime,
      endTime,
      summaryJson,
      createdAt: Date.now(),
      groupName: groupName != null && String(groupName).trim() !== '' ? String(groupName).trim() : null,
    });
  return info.lastInsertRowid;
}

function countMessages() {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM messages')
    .get();
  return row ? row.c : 0;
}

function getLatestSummary() {
  return getDb()
    .prepare(
      `
    SELECT id, start_time, end_time, summary_json, created_at, group_name
    FROM summaries
    ORDER BY id DESC
    LIMIT 1
  `
    )
    .get();
}

function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (e) {
      logger.warn('db close failed', { err: String(e && e.message ? e.message : e) });
    }
    dbInstance = null;
  }
}

module.exports = {
  getDb,
  insertMessageIfNew,
  getState,
  setState,
  getMessagesForSummary,
  getLastMessagesChronological,
  countMessagesForGroup,
  listDistinctGroupNames,
  insertSummary,
  getLatestSummary,
  countMessages,
  closeDb,
};
