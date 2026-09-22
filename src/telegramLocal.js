import fetch from 'node-fetch';
import { config } from './config.js';

const base = `${config.telegram.localApiUrl}/bot${config.telegram.botToken}`;
const fileBase = `${config.telegram.localApiUrl}/file/bot${config.telegram.botToken}`;

/** Waits for the local Bot API service container to actually be ready to accept requests. */
export async function waitUntilReady(maxAttempts = 20, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${base}/getMe`);
      if (res.ok) return;
    } catch {
      // server not up yet - fall through and retry
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('Local Bot API server did not become ready in time');
}

/** Resolves a file_id to a downloadable stream, without ever writing it to disk. */
export async function openFileStream(fileId) {
  const res = await fetch(`${base}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`getFile failed: ${JSON.stringify(data)}`);

  const filePath = data.result.file_path;
  const size = data.result.file_size;
  const downloadRes = await fetch(`${fileBase}/${filePath}`);
  if (!downloadRes.ok || !downloadRes.body) {
    throw new Error(`Downloading file failed: HTTP ${downloadRes.status}`);
  }
  return { stream: downloadRes.body, size };
}
