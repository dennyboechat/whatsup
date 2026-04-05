const logger = require('../utils/logger');

/** WhatsApp caps vary; stay under a safe size per message. */
const MAX_CHUNK = 3800;

/**
 * Find a group chat by title (case-insensitive, trimmed).
 */
async function findGroupChat(client, groupName) {
  const target = (groupName || '').trim().toLowerCase();
  if (!target) throw new Error('group name is required');
  const chats = await client.getChats();
  const chat = chats.find(
    (c) => c.isGroup && (c.name || '').trim().toLowerCase() === target
  );
  if (!chat) {
    throw new Error(
      `Group not found: "${groupName}". Use \`groups\` to list exact titles.`
    );
  }
  return chat;
}

function splitForWhatsApp(text) {
  if (text.length <= MAX_CHUNK) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX_CHUNK) {
    chunks.push(text.slice(i, i + MAX_CHUNK));
  }
  return chunks;
}

/**
 * Sends text to a group as the logged-in user. Long text is split into multiple messages.
 */
async function postTextToGroup(client, groupName, text) {
  const chat = await findGroupChat(client, groupName);
  const chunks = splitForWhatsApp(text.trim());
  logger.info('posting message(s) to whatsapp group', {
    group: groupName,
    parts: chunks.length,
  });

  for (let i = 0; i < chunks.length; i++) {
    const body =
      chunks.length > 1
        ? `Part ${i + 1}/${chunks.length}\n\n${chunks[i]}`
        : chunks[i];
    await chat.sendMessage(body);
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 700));
    }
  }
}

module.exports = { postTextToGroup, findGroupChat };
