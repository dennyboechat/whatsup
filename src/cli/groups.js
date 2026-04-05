#!/usr/bin/env node
/**
 * Lists all WhatsApp group chat titles (uses the same saved session as `npm run start`).
 * Stop the listener first if it is running, so the session is not used by two processes at once.
 */
const qrcode = require('qrcode-terminal');
const logger = require('../utils/logger');
const { createSessionClient } = require('../whatsapp/client');

async function main() {
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
    process.exit(1);
  });

  client.on('ready', async () => {
    try {
      const chats = await client.getChats();
      const groups = chats.filter((c) => c.isGroup);
      const names = groups
        .map((c) => (c.name || '').trim() || '(unnamed group)')
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

      console.log('');
      console.log('WhatsApp group names');
      console.log('---------------------');
      if (names.length === 0) {
        console.log('(no groups found)');
      } else {
        names.forEach((n) => console.log(n));
      }
      console.log('');
      console.log(`Total: ${names.length} group(s)`);
      console.log('');
    } catch (e) {
      logger.error('failed to list chats', {
        err: String(e && e.message ? e.message : e),
      });
      process.exitCode = 1;
    } finally {
      await client.destroy().catch(() => {});
    }
    process.exit(process.exitCode || 0);
  });

  await client.initialize();
}

main().catch((e) => {
  logger.error('groups command failed', {
    err: String(e && e.message ? e.message : e),
  });
  process.exit(1);
});
