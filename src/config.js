import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  telegram: {
    botToken: required('TELEGRAM_BOT_TOKEN'),
    apiUrl: process.env.LOCAL_BOT_API_URL || 'http://127.0.0.1:8081',
    adminChatId: String(required('ADMIN_CHAT_ID')),
  },
  bale: {
    botToken: process.env.BALE_BOT_TOKEN || '',
    apiUrl: process.env.BALE_API_URL || 'https://tapi.bale.ai',
  },
  rubika: {
    botToken: process.env.RUBIKA_BOT_TOKEN || '',
    apiUrl: process.env.RUBIKA_API_URL || 'https://messengerg2b1.iranlms.ir',
  },
  r2: {
    accountId: required('R2_ACCOUNT_ID'),
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    bucket: required('R2_BUCKET_NAME'),
    endpoint: required('R2_ENDPOINT'),
  },
  encryptionKeyHex: required('ENCRYPTION_KEY_HEX'),
  tempDir: process.env.TEMP_DIR || '/home/ubuntu/bale-link-bot-tmp',
  channelsFile: process.env.CHANNELS_FILE || './data/channels.json',
};

export const tgApiBase = `${config.telegram.apiUrl}/bot${config.telegram.botToken}`;
export const tgFileBase = `${config.telegram.apiUrl}/file/bot${config.telegram.botToken}`;
