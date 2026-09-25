import fetch from 'node-fetch';
import FormData from 'form-data';
import { config } from './config.js';

const base = `${config.rubika.apiUrl}/v3/${config.rubika.botToken}`;

async function safeJson(res, label) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Rubika ${label} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Verify exact field/endpoint names against current rubika.ir/botapi docs before production use.
export async function sendStreamToRubika(stream, size, fileName, { caption } = {}) {
  const reqRes = await fetch(`${base}/requestSendFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'File' }),
  });
  const reqData = await safeJson(reqRes, 'requestSendFile');
  const uploadUrl = reqData?.data?.upload_url;
  if (!uploadUrl) throw new Error(`Rubika requestSendFile failed: ${JSON.stringify(reqData)}`);

  const form = new FormData();
  form.append('file', stream, { filename: fileName, knownLength: size });
  const uploadRes = await fetch(uploadUrl, { method: 'POST', body: form, headers: form.getHeaders() });
  const uploadData = await safeJson(uploadRes, 'upload');
  const fileId = uploadData?.data?.file_id;
  if (!fileId) throw new Error(`Rubika file upload failed: ${JSON.stringify(uploadData)}`);

  const sendRes = await fetch(`${base}/sendFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.rubika.channelId, file_id: fileId, text: caption }),
  });
  const sendData = await safeJson(sendRes, 'sendFile');
  if (sendData?.status !== 'OK') throw new Error(`Rubika sendFile failed: ${JSON.stringify(sendData)}`);
  return sendData.data;
}
