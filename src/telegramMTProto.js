import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Readable } from 'node:stream';
import fetch from 'node-fetch';
import { config } from './config.js';

let client = null;

async function getClient() {
  if (client) return client;
  client = new TelegramClient(
    new StringSession(config.mtproto.session),
    config.mtproto.apiId,
    config.mtproto.apiHash,
    { connectionRetries: 5, useWSS: true }
  );
  await client.connect();
  return client;
}

/** Looks up the bot's @username via the official Bot API (getMe). */
async function getBotUsername() {
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/getMe`);
  const data = await res.json();
  if (!data.ok) throw new Error(`getMe failed: ${JSON.stringify(data)}`);
  return data.result.username;
}

export async function waitUntilReady() {
  return;
}

/**
 * Downloads the media from a specific message in the chat with the bot.
 * We resolve the bot by @username (not by numeric id), because a fresh
 * MTProto session has no cached entity for a bare numeric peer id yet -
 * usernames can always be resolved directly.
 */
export async function openFileStream(fileId, chatId, messageId) {
  const tgClient = await getClient();

  const username = await getBotUsername();
  console.log(`Resolving entity for @${username}...`);
  const entity = await tgClient.getEntity(username);

  console.log(`Fetching message ${messageId} from chat with @${username}...`);
  const messages = await tgClient.getMessages(entity, { ids: [messageId] });
  const message = messages[0];

  if (!message || !message.media) {
    throw new Error(`Could not find media in message ${messageId} in chat with @${username}`);
  }

  console.log('Downloading media into memory...');
  const buffer = await tgClient.downloadMedia(message, {
    progressCallback: (progress) => {
      if (Math.floor(progress * 100) % 10 === 0) {
        console.log(`Download progress: ${Math.floor(progress * 100)}%`);
      }
    },
  });

  if (!buffer) {
    throw new Error('Download returned empty buffer');
  }

  const size = buffer.length;
  console.log(`Download complete: ${size} bytes`);

  return { stream: Readable.from(buffer), size };
}
