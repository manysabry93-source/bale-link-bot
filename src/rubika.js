import fs from 'node:fs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { config } from './config.js';

const base = `${config.rubika.apiUrl}/v3/${config.rubika.botToken}`;

// Verify exact field/endpoint names against current rubika.ir/botapi docs before production use.
// The upload step streams the file (via 'form-data' + fs.createReadStream) instead of
// buffering it whole in memory, since files here can be up to ~2GB.
export async function sendFileToRubika(chatId, localPath, { fileName = 'file', caption } = {}) {
  const reqRes = await fetch(`${base}/requestSendFile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'File' }),
  });
  const reqData = await reqRes.json();
  const uploadUrl = reqData?.data?.upload_url;
  if (!uploadUrl) throw new Error(`Rubika requestSendFile failed: ${JSON.stringify(reqData)}`);

  const { size } = fs.statSync(localPath);
  const form = new FormData();
  form.append('file', fs.createReadStream(localPath), { filename: fileName, knownLength: size });
  const uploadRes = await fetch(uploadUrl, { method: 'POST', body: form, headers: form.getHeaders() });
  const uploadData = await uploadRes.json();
  const fileId = uploadData?.data?.file_id;
  if (!fileId) throw new Error(`Rubika file upload failed: ${JSON.stringify(uploadData)}`);

  const sendRes = await fetch(`${base}/sendFile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, file_id: fileId, text: caption }),
  });
  const sendData = await sendRes.json();
  if (sendData?.status !== 'OK') throw new Error(`Rubika sendFile failed: ${JSON.stringify(sendData)}`);
  return sendData.data;
}
