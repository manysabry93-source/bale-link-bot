import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var / secret: ${name}`);
  return value;
}

export const config = {
  telegram: {
    botToken: required('TELEGRAM_BOT_TOKEN'),
  },

  mtproto: {
    apiId: parseInt(required('TELEGRAM_API_ID'), 10),
    apiHash: required('TELEGRAM_API_HASH'),
    session: required('TELEGRAM_SESSION'),
  },

  bale: {
    botToken: required('BALE_BOT_TOKEN'),
    apiUrl: process.env.BALE_API_URL || 'https://tapi.bale.ai',
    channelId: required('BALE_CHANNEL_ID'),
  },

  rubika: {
    botToken: required('RUBIKA_BOT_TOKEN'),
    apiUrl: process.env.RUBIKA_API_URL || 'https://botapi.rubika.ir',
    channelId: required('RUBIKA_CHANNEL_ID'),
  },
};
