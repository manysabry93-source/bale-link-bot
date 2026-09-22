import fetch from 'node-fetch';
import FormData from 'form-data';
import { config } from './config.js';

const base = `${config.rubika.apiUrl}/v3/${config.rubika.botToken}`;

// Verify exact field/endpoint names against current rubika.ir/botapi docs before production use.
export async function sendStreamToRubika(stream, size, fileName, { caption } = {}) {
  const reqRes = await fetch(`${base}/requestSendFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'File' }),
  });
  const reqData = await reqRes.json();
  const uploadUrl = reqData?.data?.upload_url;
  if (!uploadUrl) throw new Error(`Rubika requestSendFile failed: ${JSON.stringify(reqData)}`);

  const form = new FormData();
  form.append('file', stream, { filename: fileName, knownLength: size });
  const uploadRes = await fetch(uploadUrl, { method: 'POST', body: form, headers: form.getHeaders() });
  const uploadData = await uploadRes.json();
  const fileId = uploadData?.data?.file_id;
  if (!fileId) throw new Error(`Rubika file upload failed: ${JSON.stringify(uploadData)}`);

  const sendRes = await fetch(`${base}/sendFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.rubika.channelId, file_id: fileId, text: caption }),
  });
  const sendData = await sendRes.json();
  if (sendData?.status !== 'OK') throw new Error(`Rubika sendFile failed: ${JSON.stringify(sendData)}`);
  return sendData.data;
}
