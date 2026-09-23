import fetch from 'node-fetch';
import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const officialBase = `https://api.telegram.org/bot${config.telegram.botToken}`;
const officialFileBase = `https://api.telegram.org/file/bot${config.telegram.botToken}`;

const localBase = `${config.telegram.localApiUrl}/bot${config.telegram.botToken}`;

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

  // Large file: trigger download via Local Bot API
  console.log('File >20MB, requesting via Local Bot API...');
  const localRes = await fetch(`${localBase}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const localData = await localRes.json();
  if (!localData.ok) throw new Error(`getFile failed: ${JSON.stringify(localData)}`);

  const filePath = localData.result.file_path;
  const size = localData.result.file_size;
  console.log(`File path on server: ${filePath}, size: ${size}`);

  // filePath is like /var/lib/telegram-bot-api/TOKEN/videos/file_0
  // Map it to the mounted volume on the host
  const localFileRoot = process.env.LOCAL_FILE_ROOT || '/tmp/telegram-bot-api';
  const tokenPart = filePath.split('/').slice(4).join('/'); // TOKEN/videos/file_0
  const hostPath = path.join(localFileRoot, tokenPart);
  console.log(`Mapped host path: ${hostPath}`);

  // Wait for file to be fully downloaded
  for (let attempt = 1; attempt <= 60; attempt++) {
    if (fs.existsSync(hostPath)) {
      const stat = fs.statSync(hostPath);
      console.log(`File exists, size on disk: ${stat.size} / ${size}`);
      if (stat.size >= size) {
        console.log('File fully downloaded, streaming...');
        return { stream: createReadStream(hostPath), size };
      }
      console.log(`Attempt ${attempt}: still downloading (${stat.size}/${size})...`);
    } else {
      console.log(`Attempt ${attempt}: file not yet on disk...`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  throw new Error('File download timed out');
}
