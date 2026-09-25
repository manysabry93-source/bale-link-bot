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

  // Use allSettled so a failure on one platform never cuts off the other -
  // both streams must be allowed to finish (or fail) independently.
  const results = await Promise.allSettled([
    sendStreamToBale(toBale, payload.size || size, payload.fileName, { asVideo: payload.asVideo }),
    sendStreamToRubika(toRubika, payload.size || size, payload.fileName, { caption: payload.caption }),
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

main().catch((err) => {
  console.error('Relay run failed:', err);
  process.exit(1);
});
