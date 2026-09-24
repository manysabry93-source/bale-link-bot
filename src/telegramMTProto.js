import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Readable } from 'node:stream';
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

/** No-op kept for compatibility with relay.js */
export async function waitUntilReady() {
  return;
}

/**
 * Downloads the media from a specific Telegram message (chatId + messageId)
 * using the user account (MTProto), which has no 20MB limit like the Bot API.
 */
export async function openFileStream(fileId, chatId, messageId) {
  const tgClient = await getClient();

  console.log(`Fetching message ${messageId} from chat ${chatId}...`);
  const messages = await tgClient.getMessages(chatId, { ids: [messageId] });
  const message = messages[0];

  if (!message || !message.media) {
    throw new Error(`Could not find media in message ${messageId} of chat ${chatId}`);
  }

  console.log('Downloading media into memory...');
  const buffer = await tgClient.downloadMedia(message, {
    progressCallback: (progress) => {
      // progress is a fraction 0..1
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
