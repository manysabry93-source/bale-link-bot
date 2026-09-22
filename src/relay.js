import fs from 'node:fs';
import { waitUntilReady, openFileStream } from './telegramLocal.js';
import { teeStream } from './tee.js';
import { sendStreamToBale } from './bale.js';
import { sendStreamToRubika } from './rubika.js';

/**
 * Reads the file to relay from whatever triggered this run:
 * - repository_dispatch (the real path, fired instantly by the Cloudflare Worker)
 * - workflow_dispatch (manual run from the Actions tab, with inputs filled in by hand)
 */
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
  const { stream, size } = await openFileStream(payload.fileId);
  const [toBale, toRubika] = teeStream(stream);

  await Promise.all([
    sendStreamToBale(toBale, payload.size || size, payload.fileName, { asVideo: payload.asVideo }),
    sendStreamToRubika(toRubika, payload.size || size, payload.fileName, { caption: payload.caption }),
  ]);

  console.log(`Done: "${payload.fileName}" sent to Bale and Rubika.`);
}

main().catch((err) => {
  console.error('Relay run failed:', err);
  process.exit(1);
});
