import fetch from 'node-fetch';
import { PassThrough } from 'node:stream';
import { config } from './config.js';

const officialBase = `https://api.telegram.org/bot${config.telegram.botToken}`;
const officialFileBase = `https://api.telegram.org/file/bot${config.telegram.botToken}`;

// No-op for compatibility - no local server needed anymore
export async function waitUntilReady() {
  return;
}

export async function openFileStream(fileId) {
  // Step 1: get file path from Telegram
  const res = await fetch(`${officialBase}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const data = await res.json();

  if (!data.ok) throw new Error(`getFile failed: ${JSON.stringify(data)}`);

  const filePath = data.result.file_path;
  const size = data.result.file_size;
  const url = `${officialFileBase}/${filePath}`;

  console.log(`File size: ${size} bytes, path: ${filePath}`);

  // Files <= 20MB: direct download
  if (size <= 20 * 1024 * 1024) {
    console.log('Small file, direct download...');
    const downloadRes = await fetch(url);
    if (!downloadRes.ok || !downloadRes.body) {
      throw new Error(`Direct download failed: HTTP ${downloadRes.status}`);
    }
    return { stream: downloadRes.body, size };
  }

  // Files > 20MB: chunked download via Range headers
  console.log('Large file, chunked download...');
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
  const passThrough = new PassThrough();

  (async () => {
    let offset = 0;
    while (offset < size) {
      const end = Math.min(offset + CHUNK_SIZE - 1, size - 1);
      console.log(`Downloading chunk ${offset}-${end} of ${size}...`);

      let chunkRes;
      for (let attempt = 1; attempt <= 3; attempt++) {
        chunkRes = await fetch(url, {
          headers: { Range: `bytes=${offset}-${end}` }
        });
        if (chunkRes.ok || chunkRes.status === 206) break;
        console.log(`Chunk attempt ${attempt} failed: HTTP ${chunkRes.status}, retrying...`);
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (!chunkRes.ok && chunkRes.status !== 206) {
        passThrough.destroy(new Error(`Chunk download failed: HTTP ${chunkRes.status}`));
        return;
      }

      const buf = await chunkRes.arrayBuffer();
      passThrough.write(Buffer.from(buf));
      offset += CHUNK_SIZE;
    }
    passThrough.end();
    console.log('All chunks downloaded.');
  })().catch((err) => passThrough.destroy(err));

  return { stream: passThrough, size };
}
