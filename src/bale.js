import fs from 'node:fs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { config } from './config.js';

const base = `${config.bale.apiUrl}/bot${config.bale.botToken}`;

// Verify field/endpoint names against current tapi.bale.ai docs before production use.
// Uses a streamed multipart body (via the 'form-data' package) instead of reading the
// whole file into memory, since files here can be up to ~2GB.
export async function sendFileToBale(chatId, localPath, { asVideo = false, caption } = {}) {
  const method = asVideo ? 'sendVideo' : 'sendDocument';
  const fieldName = asVideo ? 'video' : 'document';
  const { size } = fs.statSync(localPath);

  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append(fieldName, fs.createReadStream(localPath), {
    filename: 'file',
    knownLength: size,
  });

  const res = await fetch(`${base}/${method}`, { method: 'POST', body: form, headers: form.getHeaders() });
  const data = await res.json();
  if (!data.ok) throw new Error(`Bale API error on ${method}: ${JSON.stringify(data)}`);
  return data.result;
}
