import fs from 'node:fs';
import { Readable } from 'node:stream';
import { downloadMediaBuffer } from './telegramMTProto.js';
import { splitVideo } from './split.js';
import { teeStream } from './tee.js';
import { sendStreamToBale } from './bale.js';
import { sendStreamToRubika } from './rubika.js';

const MAX_SIZE_BYTES = 40 * 1024 * 1024; // 40MB
const BALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - Bale genuinely uploads
const RUBIKA_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

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

  const results = await Promise.allSettled([
    withTimeout(sendStreamToBale(toBale, size, fileName, { asVideo }), BALE_TIMEOUT_MS, 'Bale upload'),
    withTimeout(sendStreamToRubika(toRubika, size, fileName, { caption, asVideo }), RUBIKA_TIMEOUT_MS, 'Rubika upload'),
  ]);

  const [baleResult, rubikaResult] = results;

  if (baleResult.status === 'fulfilled') console.log(`✅ [${fileName}] Sent to Bale successfully.`);
  else console.error(`❌ [${fileName}] Bale failed:`, baleResult.reason?.message || baleResult.reason);

  if (rubikaResult.status === 'fulfilled') console.log(`✅ [${fileName}] Sent to Rubika successfully.`);
  else console.error(`❌ [${fileName}] Rubika failed:`, rubikaResult.reason?.message || rubikaResult.reason);

  return { baleOk: baleResult.status === 'fulfilled', rubikaOk: rubikaResult.status === 'fulfilled' };
}

async function main() {
  const payload = readTriggerPayload();
  if (!payload) {
    console.log('No file in this trigger - nothing to do.');
    return;
  }

  console.log(`Relaying "${payload.fileName}"...`);
  const buffer = await downloadMediaBuffer(payload.fileId, payload.chatId, payload.messageId, payload.size);

  let anyBaleFail = false;
  let anyRubikaFail = false;

  if (buffer.length <= MAX_SIZE_BYTES) {
    const { baleOk, rubikaOk } = await sendOnePart(buffer, payload.fileName, payload.asVideo, payload.caption);
    if (!baleOk) anyBaleFail = true;
    if (!rubikaOk) anyRubikaFail = true;
  } else if (payload.asVideo) {
    console.log(`File is ${buffer.length} bytes, above the ${MAX_SIZE_BYTES} byte limit - splitting into parts...`);
    const parts = await splitVideo(buffer, MAX_SIZE_BYTES);
    const total = parts.length;

    const baseName = payload.fileName.replace(/\.[^/.]+$/, '') || 'video';

    for (let i = 0; i < total; i++) {
      const partNum = i + 1;
      const partFileName = `${baseName} - قسمت ${partNum} از ${total}.mp4`;
      const partCaption = [
        `🎬 ${baseName}`,
        payload.caption || null,
        '───────────────',
        `📦 قسمت ${partNum} از ${total}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      console.log(`Sending part ${partNum}/${total} (${parts[i].length} bytes)...`);
      const { baleOk, rubikaOk } = await sendOnePart(parts[i], partFileName, true, partCaption);
      if (!baleOk) anyBaleFail = true;
      if (!rubikaOk) anyRubikaFail = true;
    }
  } else {
    console.log(
      `File is ${buffer.length} bytes, above the ${MAX_SIZE_BYTES} byte limit, and is not a video - cannot split. Sending as-is (will likely fail).`
    );
    const { baleOk, rubikaOk } = await sendOnePart(buffer, payload.fileName, false, payload.caption);
    if (!baleOk) anyBaleFail = true;
    if (!rubikaOk) anyRubikaFail = true;
  }

  console.log('--- Summary ---');
  console.log(anyBaleFail ? '❌ Bale: one or more parts failed.' : '✅ Bale: all parts sent.');
  console.log(anyRubikaFail ? '❌ Rubika: one or more parts failed.' : '✅ Rubika: all parts sent.');

  // Only hard-fail the whole run if Bale (the platform that actually works)
  // had failures. Rubika failures are logged but don't fail the run, since
  // Rubika appears unreachable from this network regardless of file size.
  if (anyBaleFail) {
    throw new Error('One or more parts failed to reach Bale - see logs above.');
  }

  console.log(`Done: "${payload.fileName}" relayed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Relay run failed:', err);
    process.exit(1);
  });
