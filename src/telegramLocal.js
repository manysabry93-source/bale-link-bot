import fetch from 'node-fetch';
import { config } from './config.js';

const officialBase = `https://api.telegram.org/bot${config.telegram.botToken}`;
const officialFileBase = `https://api.telegram.org/file/bot${config.telegram.botToken}`;

const localBase = `${config.telegram.localApiUrl}/bot${config.telegram.botToken}`;
const localFileBase = `${config.telegram.localApiUrl}/file/bot${config.telegram.botToken}`;

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

export async function openFileStream(fileId) {
  // Try official API first (files <= 20MB)
  try {
    const res = await fetch(`${officialBase}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const data = await res.json();
    if (data.ok) {
      const filePath = data.result.file_path;
      const size = data.result.file_size;
      const downloadRes = await fetch(`${officialFileBase}/${filePath}`);
      if (downloadRes.ok && downloadRes.body) {
        console.log(`Using official API (${size} bytes)`);
        return { stream: downloadRes.body, size };
      }
    }
  } catch (e) {
    console.log('Official API failed, trying local...', e.message);
  }

  // Large file: use Local Bot API
  // getFile triggers the local server to START downloading from Telegram
  console.log('File >20MB, requesting via Local Bot API...');
  const localRes = await fetch(`${localBase}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const localData = await localRes.json();
  if (!localData.ok) throw new Error(`getFile failed: ${JSON.stringify(localData)}`);

  const filePath = localData.result.file_path;
  const size = localData.result.file_size;
  console.log(`File path: ${filePath}, size: ${size}`);

  // Retry downloading - local server needs time to fetch the file from Telegram
  for (let attempt = 1; attempt <= 20; attempt++) {
    console.log(`Download attempt ${attempt}...`);
    const downloadRes = await fetch(`${localFileBase}/${filePath}`);
    if (downloadRes.ok && downloadRes.body) {
      console.log(`Download started successfully on attempt ${attempt}`);
      return { stream: downloadRes.body, size };
    }
    console.log(`HTTP ${downloadRes.status}, waiting 10s...`);
    await new Promise((r) => setTimeout(r, 10000));
  }

  throw new Error('Downloading file failed after all retries');
}
