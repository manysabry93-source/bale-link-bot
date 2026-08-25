import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { startPolling, sendMessage, editMessageText, answerCallbackQuery, downloadFile } from './telegram.js';
import { encryptFile, decryptFile } from './encryption.js';
import { uploadToR2, downloadFromR2, deleteFromR2 } from './storage.js';
import { sendFileToBale } from './bale.js';
import { sendFileToRubika } from './rubika.js';
import { listChannels, addChannel, removeChannel } from './destinations.js';

if (!fs.existsSync(config.tempDir)) fs.mkdirSync(config.tempDir, { recursive: true });

const pending = new Map(); // pendingId -> { r2Key, fileName, isVideo }

const isAdmin = (chatId) => String(chatId) === config.telegram.adminChatId;

function destinationKeyboard(pendingId) {
  const channels = listChannels();
  if (channels.length === 0) return null;
  return { inline_keyboard: channels.map((c) => [
    { text: `${c.platform === 'bale' ? '🔵' : '🟣'} ${c.name}`, callback_data: `dest:${pendingId}:${c.name}` },
  ]) };
}

const postSendKeyboard = (pendingId) => ({
  inline_keyboard: [
    [{ text: '📤 ارسال به مقصد دیگر', callback_data: `redo:${pendingId}` }],
    [{ text: '🗑 حذف نسخه موقت', callback_data: `del:${pendingId}` }],
  ],
});

async function handleIncomingFile(message) {
  const file = message.document || message.video;
  const chatId = message.chat.id;
  const pendingId = crypto.randomBytes(6).toString('hex');
  const rawPath = path.join(config.tempDir, `${pendingId}.raw`);
  const encPath = path.join(config.tempDir, `${pendingId}.enc`);

  await sendMessage(chatId, '⏳ در حال دریافت فایل...');
  await downloadFile(file.file_id, rawPath);
  await encryptFile(rawPath, encPath);
  fs.unlinkSync(rawPath);

  const r2Key = `tmp/${pendingId}`;
  await uploadToR2(encPath, r2Key);
  fs.unlinkSync(encPath);

  pending.set(pendingId, {
    r2Key,
    fileName: file.file_name || (message.video ? 'video.mp4' : 'file'),
    isVideo: Boolean(message.video),
  });

  const keyboard = destinationKeyboard(pendingId);
  if (!keyboard) {
    await sendMessage(chatId, '✅ فایل رمزگذاری و ذخیره شد، ولی هنوز کانالی ثبت نشده.\nبا این دستور اضافه کن:\n<code>/addchannel نام bale|rubika chat_id</code>');
    return;
  }
  await sendMessage(chatId, '✅ فایل آماده‌ست. مقصد رو انتخاب کن:', { reply_markup: keyboard });
}

async function handleDestinationChoice(cq, pendingId, channelName) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const item = pending.get(pendingId);
  const channel = listChannels().find((c) => c.name === channelName);

  if (!item || !channel) {
    await answerCallbackQuery(cq.id, 'این آیتم دیگه معتبر نیست.');
    return;
  }

  await answerCallbackQuery(cq.id, 'در حال ارسال...');
  await editMessageText(chatId, messageId, `⏳ در حال ارسال به ${channel.name}...`);

  const decEnc = path.join(config.tempDir, `${pendingId}.dl`);
  const decPath = path.join(config.tempDir, `${pendingId}.dec`);
  try {
    await downloadFromR2(item.r2Key, decEnc);
    await decryptFile(decEnc, decPath);
    fs.unlinkSync(decEnc);

    if (channel.platform === 'bale') {
      await sendFileToBale(channel.chatId, decPath, { asVideo: item.isVideo });
    } else if (channel.platform === 'rubika') {
      await sendFileToRubika(channel.chatId, decPath, { fileName: item.fileName });
    }

    await editMessageText(chatId, messageId,
      `✅ با موفقیت به «${channel.name}» ارسال شد.\nنسخه موقت رمزشده هنوز روی R2 هست.`,
      { reply_markup: postSendKeyboard(pendingId) });
  } catch (err) {
    console.error('[send] failed:', err);
    await editMessageText(chatId, messageId, `❌ ارسال به «${channel.name}» با خطا مواجه شد:\n${err.message}`);
  } finally {
    if (fs.existsSync(decPath)) fs.unlinkSync(decPath);
  }
}

async function handleRedo(cq, pendingId) {
  const keyboard = destinationKeyboard(pendingId);
  await answerCallbackQuery(cq.id);
  if (!keyboard) {
    await editMessageText(cq.message.chat.id, cq.message.message_id, 'هیچ کانالی ثبت نشده.');
    return;
  }
  await editMessageText(cq.message.chat.id, cq.message.message_id, 'مقصد بعدی رو انتخاب کن:', { reply_markup: keyboard });
}

async function handleDelete(cq, pendingId) {
  const item = pending.get(pendingId);
  if (!item) {
    await answerCallbackQuery(cq.id, 'قبلاً حذف شده.');
    return;
  }
  await deleteFromR2(item.r2Key);
  pending.delete(pendingId);
  await answerCallbackQuery(cq.id, 'حذف شد.');
  await editMessageText(cq.message.chat.id, cq.message.message_id, '🗑 نسخه موقت رمزشده حذف شد.');
}

async function handleCommand(message) {
  const chatId = message.chat.id;
  const [cmd, ...args] = message.text.trim().split(/\s+/);
  if (cmd === '/start') {
    await sendMessage(chatId, '👋 آماده‌ام. فایل یا ویدیو بفرست.');
  } else if (cmd === '/channels') {
    const channels = listChannels();
    const text = channels.length
      ? channels.map((c) => `• ${c.name} — ${c.platform} — <code>${c.chatId}</code>`).join('\n')
      : 'هیچ کانالی ثبت نشده.';
    await sendMessage(chatId, text);
  } else if (cmd === '/addchannel') {
    const [name, platform, chatIdArg] = args;
    if (!name || !['bale', 'rubika'].includes(platform) || !chatIdArg) {
      await sendMessage(chatId, 'فرمت درست: <code>/addchannel نام bale|rubika chat_id</code>');
      return;
    }
    try {
      addChannel(name, platform, chatIdArg);
      await sendMessage(chatId, `✅ کانال «${name}» اضافه شد.`);
    } catch (err) {
      await sendMessage(chatId, `❌ ${err.message}`);
    }
  } else if (cmd === '/removechannel') {
    removeChannel(args[0]);
    await sendMessage(chatId, `🗑 کانال «${args[0]}» حذف شد (اگه وجود داشت).`);
  }
}

async function onUpdate(update) {
  if (update.message) {
    const message = update.message;
    if (!isAdmin(message.chat.id)) return;
    if (message.text && message.text.startsWith('/')) await handleCommand(message);
    else if (message.document || message.video) await handleIncomingFile(message);
    return;
  }
  if (update.callback_query) {
    const cq = update.callback_query;
    if (!isAdmin(cq.message.chat.id)) { await answerCallbackQuery(cq.id); return; }
    const [action, pendingId, channelName] = cq.data.split(':');
    if (action === 'dest') await handleDestinationChoice(cq, pendingId, channelName);
    else if (action === 'redo') await handleRedo(cq, pendingId);
    else if (action === 'del') await handleDelete(cq, pendingId);
  }
}

console.log('[bale-link-bot] starting...');
startPolling(onUpdate);
