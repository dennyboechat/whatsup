const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { config } = require('../utils/config');
const { getTargetGroupName } = require('../utils/targetGroup');
const logger = require('../utils/logger');
const { getChromeExecutablePath } = require('../utils/chromePath');
const { insertMessageIfNew } = require('../db');

const SESSION_DIR = path.join(config.dataDir, 'wwebjs_session');

/** Current listener client (updated on reconnect). Used by interactive commands. */
let activeClient = null;

function getActiveClient() {
  return activeClient;
}

function buildPuppeteerOptions() {
  const executablePath = getChromeExecutablePath();
  if (executablePath) {
    logger.info('using chrome executable', { executablePath });
  } else {
    logger.warn(
      'no system chrome found — install Google Chrome or set PUPPETEER_EXECUTABLE_PATH, or run: npx puppeteer browsers install chrome'
    );
  }
  return {
    headless: true,
    executablePath: executablePath || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
}

/**
 * Base client: same session folder as the listener, no event handlers yet.
 * Use for one-off tools (e.g. listing group names) — stop `npm run start` first to avoid session conflicts.
 */
function createSessionClient() {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: buildPuppeteerOptions(),
  });
}

/**
 * WhatsApp Web client with persisted session (LocalAuth) and automatic reconnect.
 * Listens for messages, filters by target group name, persists text to SQLite.
 */
function createClient() {
  const client = createSessionClient();

  client.on('qr', (qr) => {
    logger.info('scan this qr code with whatsapp mobile app');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    logger.info('whatsapp authenticated');
  });

  client.on('auth_failure', (m) => {
    logger.error('whatsapp auth failure', { detail: String(m) });
  });

  client.on('ready', () => {
    logger.info('whatsapp client ready', { targetGroup: getTargetGroupName() });
  });

  client.on('message', async (message) => {
    try {
      const chat = await message.getChat();
      if (!chat.isGroup) return;

      const name = (chat.name || '').trim();
      const target = getTargetGroupName();
      if (!target) return;
      if (name.toLowerCase() !== target.toLowerCase()) return;

      if (message.hasMedia) {
        // Optional: log metadata only, do not store binary
        logger.debug('skipped media message', {
          group: name,
          type: message.type,
          id: message.id?._serialized,
        });
        return;
      }

      const body = (message.body || '').trim();
      if (!body) {
        logger.debug('skipped empty message', { group: name });
        return;
      }

      const author = message.author || message.from || 'unknown';
      let authorLabel = author;
      try {
        const contact = await message.getContact();
        if (contact && contact.pushname) authorLabel = contact.pushname;
        else if (contact && contact.name) authorLabel = contact.name;
      } catch (_) {
        /* best-effort display name */
      }

      const ts = message.timestamp ? message.timestamp * 1000 : Date.now();
      const waId = message.id?._serialized || null;

      const inserted = insertMessageIfNew({
        waMessageId: waId,
        timestamp: ts,
        author: authorLabel,
        groupName: name,
        messageText: body,
      });

      if (inserted) {
        logger.info('stored message', { group: name, author: authorLabel });
      }
    } catch (e) {
      logger.error('message handler error', {
        err: String(e && e.message ? e.message : e),
      });
    }
  });

  return client;
}

/**
 * Initialize client and keep reconnecting after disconnects (recoverable errors).
 */
async function runWithReconnect(getClient) {
  let client = getClient();
  activeClient = client;
  let reconnecting = false;

  const connect = async () => {
    try {
      await client.initialize();
    } catch (e) {
      logger.error('whatsapp initialize failed', {
        err: String(e && e.message ? e.message : e),
      });
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (reconnecting) return;
    reconnecting = true;
    const delayMs = 5000;
    logger.info('scheduling whatsapp reconnect', { delayMs });
    setTimeout(async () => {
      reconnecting = false;
      try {
        await client.destroy().catch(() => {});
      } catch (_) {}
      client = getClient();
      activeClient = client;
      attach();
      await connect();
    }, delayMs);
  };

  const attach = () => {
    client.removeAllListeners('disconnected');
    client.on('disconnected', (reason) => {
      logger.warn('handling disconnect — will reconnect', { reason: String(reason) });
      scheduleReconnect();
    });
  };

  attach();
  await connect();
  return client;
}

module.exports = {
  createClient,
  createSessionClient,
  runWithReconnect,
  getActiveClient,
};
