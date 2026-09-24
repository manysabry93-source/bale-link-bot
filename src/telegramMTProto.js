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

async function getBotUsername() {
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/getMe`);
  const data = await res.json();
  if (!data.ok) throw new Error(`getMe failed: ${JSON.stringify(data)}`);
  return data.result.username;
}

/** Extracts the byte size from a Telegram media object (document or photo). */
function getMediaSize(message) {
  if (!message.media) return null;
  const doc = message.media.document;
  if (doc && doc.size) return Number(doc.size);
  const photo = message.media.photo;
  if (photo && photo.sizes && photo.sizes.length > 0) {
    const largest = photo.sizes[photo.sizes.length - 1];
    return largest.size ? Number(largest.size) : null;
  }
  return null;
}

export async function waitUntilReady() {
  return;
}

/**
 * Downloads the media for a message in the chat with the bot.
 * Bot-API message IDs and MTProto message IDs for the SAME private chat can
 * differ (a Telegram quirk with bot chats), so instead of trusting messageId,
 * we scan recent messages and match by exact media byte size, which is
 * unique enough in practice for files relayed one at a time.
 */
export async function openFileStream(fileId, chatId, messageId, expectedSize) {
  const tgClient = await getClient();

  const username = await getBotUsername();
  console.log(`Resolving entity for @${username}...`);
  const entity = await tgClient.getEntity(username);

  console.log(`Scanning recent messages in chat with @${username} for a media size match (${expectedSize} bytes)...`);
  const recentMessages = await tgClient.getMessages(entity, { limit: 30 });

  let message = null;
  for (const m of recentMessages) {
    const size = getMediaSize(m);
    if (size !== null) {
      console.log(`  candidate id=${m.id} size=${size}`);
      if (expectedSize && size === Number(expectedSize)) {
        message = m;
        break;
      }
    }
  }

  // Fallback: if no exact size match, just take the most recent message with media
  if (!message) {
    console.log('No exact size match, falling back to most recent message with media...');
    message = recentMessages.find((m) => !!m.media) || null;
  }

  if (!message || !message.media) {
    throw new Error(`Could not find any media message in the chat with @${username}`);
  }

  console.log(`Using message id=${message.id}`);
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
