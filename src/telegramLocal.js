import fetch from 'node-fetch';
import { config } from './config.js';

const officialBase = `https://api.telegram.org/bot${config.telegram.botToken}`;
const officialFileBase = `https://api.telegram.org/file/bot${config.telegram.botToken}`;

const localBase = `${config.telegram.localApiUrl}/bot${config.telegram.botToken}`;
const localFileBase = `${config.telegram.localApiUrl}/file/bot${config.telegram.botToken}`;

/** Waits for the local Bot API service container to actually be ready. */
export async function waitUntilReady(maxAttempts = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${localBase}/getMe`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('Local Bot API server did not become ready in time');
}

/** Resolves a file_id to a downloadable stream. 
 *  For files <= 20MB: uses official Telegram API directly.
 *  For larger files: uses Local Bot API.
 */
export async function openFileStream(fileId) {
  // First try official API to get file info
  const res = await fetch(`${officialBase}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const data = await res.json();

  if (data.ok) {
    // Official API works (file <= 20MB)
    const filePath = data.result.file_path;
    const size = data.result.file_size;
    const downloadRes = await fetch(`${officialFileBase}/${filePath}`);
    if (downloadRes.ok && downloadRes.body) {
      return { stream: downloadRes.body, size };
    }
  }

  // Fallback: use Local Bot API for larger files
  const localRes = await fetch(`${localBase}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const localData = await localRes.json();
  if (!localData.ok) throw new Error(`getFile failed: ${JSON.stringify(localData)}`);

  const filePath = localData.result.file_path;
  const size = localData.result.file_size;
  const downloadRes = await fetch(`${localFileBase}/${filePath}`);
  if (!downloadRes.ok || !downloadRes.body) {
    throw new Error(`Downloading file failed: HTTP ${downloadRes.status}`);
  }
  return { stream: downloadRes.body, size };
}
