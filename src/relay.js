import fs from 'node:fs';
import { Readable } from 'node:stream';
import { downloadMediaBuffer } from './telegramMTProto.js';
import { splitVideo } from './split.js';
import { teeStream } from './tee.js';
import { sendStreamToBale } from './bale.js';
import { sendStreamToRubika } from './rubika.js';

// Conservative target: both Bale and Rubika have historically rejected
// files above ~42-50MB, so we aim comfortably under that.
const MAX_SIZE_BYTES = 40 * 1024 * 1024; // 40MB

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

async function sendOnePart(buffer, fileName, asVideo, caption) {
  const size = buffer.length;
  const [toBale, toRubika] = teeStream(Readable.from(buffer));
  const TIMEOUT_MS = 5 * 60 * 1000;

  const results = await Promise.allSettled([
    withTimeout(sendStreamToBale(toBale, size, fileName, { asVideo }), TIMEOUT_MS, 'Bale upload'),
    withTimeout(sendStreamToRubika(toRubika, size, fileName, { caption }), TIMEOUT_MS, 'Rubika upload'),
  ]);

  const [baleResult, rubikaResult] = results;

  if (baleResult.status === 'fulfilled') console.log(`✅ [${fileName}] Sent to Bale successfully.`);
  else console.error(`❌ [${fileName}] Bale failed:`, baleResult.reason?.message || baleResult.reason);

  if (rubikaResult.status === 'fulfilled') console.log(`✅ [${fileName}] Sent to Rubika successfully.`);
  else console.error(`❌ [${fileName}] Rubika failed:`, rubikaResult.reason?.message || rubikaResult.reason);

  return results.every((r) => r.status === 'fulfilled');
}

async function main() {
  const payload = readTriggerPayload();
  if (!payload) {
    console.log('No file in this trigger - nothing to do.');
    return;
  }

  console.log(`Relaying "${payload.fileName}"...`);
  const buffer = await downloadMediaBuffer(payload.fileId, payload.chatId, payload.messageId, payload.size);

  let allOk = true;

  if (buffer.length <= MAX_SIZE_BYTES) {
    // Small enough - send as a single file.
    allOk = await sendOnePart(buffer, payload.fileName, payload.asVideo, payload.caption);
  } else if (payload.asVideo) {
    // Too big - split into lossless parts (stream copy, no re-encoding).
    console.log(`File is ${buffer.length} bytes, above the ${MAX_SIZE_BYTES} byte limit - splitting into parts...`);
    const parts = await splitVideo(buffer, MAX_SIZE_BYTES);
    const total = parts.length;

    const baseName = payload.fileName.replace(/\.[^/.]+$/, '') || 'video';

    for (let i = 0; i < total; i++) {
      const partFileName = `${baseName} - قسمت ${i + 1} از ${total}.mp4`;
      const partCaption = `${payload.caption ? payload.caption + '\n\n' : ''}قسمت ${i + 1} از ${total}`;
      console.log(`Sending part ${i + 1}/${total} (${parts[i].length} bytes)...`);
      const ok = await sendOnePart(parts[i], partFileName, true, partCaption);
      if (!ok) allOk = false;
    }
  } else {
    console.log(
      `File is ${buffer.length} bytes, above the ${MAX_SIZE_BYTES} byte limit, and is not a video - cannot split. Sending as-is (will likely fail).`
    );
    allOk = await sendOnePart(buffer, payload.fileName, false, payload.caption);
  }

  if (!allOk) {
    throw new Error('One or more parts/platforms failed - see logs above.');
  }

  console.log(`Done: "${payload.fileName}" relayed to Bale and Rubika.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Relay run failed:', err);
    process.exit(1);
  });
