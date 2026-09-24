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
 * Downloads the media from a specific message.
 * NOTE: chatId coming from the Bot API webhook is the admin's OWN id
 * (since that's how private chats work from a bot's perspective).
 * But the MTProto client is logged in AS the admin, so from its point of
 * view the conversation partner is the BOT itself, not the admin.
 * So we always look the message up in the chat with the bot (peer = bot's user id),
 * which is the numeric prefix of the bot token, ignoring the passed chatId.
 */
export async function openFileStream(fileId, chatId, messageId) {
  const tgClient = await getClient();

  const botUserId = Number(config.telegram.botToken.split(':')[0]);
  console.log(`Fetching message ${messageId} from chat with bot (${botUserId})...`);

  const messages = await tgClient.getMessages(botUserId, { ids: [messageId] });
  const message = messages[0];

  if (!message || !message.media) {
    throw new Error(`Could not find media in message ${messageId} in chat with bot ${botUserId}`);
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
