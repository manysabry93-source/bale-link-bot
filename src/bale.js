import fetch from 'node-fetch';
import FormData from 'form-data';
import { config } from './config.js';

const base = `${config.bale.apiUrl}/bot${config.bale.botToken}`;

// Verify field/endpoint names against current tapi.bale.ai docs before production use.
export async function sendStreamToBale(stream, size, fileName, { asVideo = false, caption } = {}) {
  const method = asVideo ? 'sendVideo' : 'sendDocument';
  const fieldName = asVideo ? 'video' : 'document';

  const form = new FormData();
  form.append('chat_id', String(config.bale.channelId));
  if (caption) form.append('caption', caption);
  form.append(fieldName, stream, { filename: fileName, knownLength: size });

  const res = await fetch(`${base}/${method}`, { method: 'POST', body: form, headers: form.getHeaders() });
  const data = await res.json();
  if (!data.ok) throw new Error(`Bale API error on ${method}: ${JSON.stringify(data)}`);
  return data.result;
}
