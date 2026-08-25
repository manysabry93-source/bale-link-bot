import fs from 'node:fs';
import { Readable } from 'node:stream';
import { config, tgApiBase, tgFileBase } from './config.js';

async function api(method, params = {}) {
  const res = await fetch(`${tgApiBase}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API error on ${method}: ${JSON.stringify(data)}`);
  return data.result;
}

export async function startPolling(onUpdate) {
  let offset = 0;
  console.log('[telegram] starting long polling...');
  for (;;) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 30 });
      for (const update of updates) {
        offset = update.update_id + 1;
        try { await onUpdate(update); } catch (err) { console.error('[telegram] update error:', err); }
      }
    } catch (err) {
      console.error('[telegram] polling error, retry in 5s:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export const sendMessage = (chatId, text, extra = {}) =>
  api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

export const editMessageText = (chatId, messageId, text, extra = {}) =>
  api('editMessageText', { chat_id: chatId, message_id: messageId, text, ...extra });

export const answerCallbackQuery = (callbackQueryId, text = '') =>
  api('answerCallbackQuery', { callback_query_id: callbackQueryId, text });

export async function downloadFile(fileId, destPath) {
  const fileInfo = await api('getFile', { file_id: fileId });
  const url = `${tgFileBase}/${fileInfo.file_path}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download file: HTTP ${res.status}`);
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    Readable.fromWeb(res.body).pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  return { fileSize: fileInfo.file_size, filePath: fileInfo.file_path };
}
