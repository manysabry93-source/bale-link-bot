import fs from 'node:fs';
import { waitUntilReady, openFileStream } from './telegramMTProto.js';
import { teeStream } from './tee.js';
import { sendStreamToBale } from './bale.js';
import { sendStreamToRubika } from './rubika.js';

function readTriggerPayload() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));

  if (eventName === 'repository_dispatch') {
    return event.client_payload || null;
  }
  if (eventName === 'workflow_dispatch') {
    const inputs = event.inputs || {};
    if (!inputs.fileId) return null;
    return {
      fileId: inputs.fileId,
      size: Number(inputs.size) || undefined,
      fileName: inputs.fileName || 'file',
      asVideo: inputs.asVideo === 'true',
      caption: inputs.caption || '',
      chatId: inputs.chatId,
      messageId: Number(inputs.messageId) || undefined,
    };
  }
  return null;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

async function main() {
  const payload = readTriggerPayload();
  if (!payload) {
    console.log('No file in this trigger - nothing to do.');
    return;
  }

  await waitUntilReady();

  console.log(`Relaying "${payload.fileName}"...`);
  const { stream, size } = await openFileStream(payload.fileId, payload.chatId, payload.messageId, payload.size);
  const [toBale, toRubika] = teeStream(stream);

  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per platform

  const results = await Promise.allSettled([
    withTimeout(
      sendStreamToBale(toBale, payload.size || size, payload.fileName, { asVideo: payload.asVideo }),
      TIMEOUT_MS,
      'Bale upload'
    ),
    withTimeout(
      sendStreamToRubika(toRubika, payload.size || size, payload.fileName, { caption: payload.caption }),
      TIMEOUT_MS,
      'Rubika upload'
    ),
  ]);

  const [baleResult, rubikaResult] = results;

  if (baleResult.status === 'fulfilled') {
    console.log('✅ Sent to Bale successfully.');
  } else {
    console.error('❌ Bale failed:', baleResult.reason?.message || baleResult.reason);
  }

  if (rubikaResult.status === 'fulfilled') {
    console.log('✅ Sent to Rubika successfully.');
  } else {
    console.error('❌ Rubika failed:', rubikaResult.reason?.message || rubikaResult.reason);
  }

  const anyFailed = results.some((r) => r.status === 'rejected');
  if (anyFailed) {
    throw new Error('One or more platforms failed - see logs above.');
  }

  console.log(`Done: "${payload.fileName}" sent to Bale and Rubika.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Relay run failed:', err);
    process.exit(1);
  });
