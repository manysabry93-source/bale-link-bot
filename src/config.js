import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var / secret: ${name}`);
  return value;
}

export const config = {
  telegram: {
    botToken: required('TELEGRAM_BOT_TOKEN'),
    // Points at the ephemeral local Bot API server started as a GitHub Actions "service"
    // for this run only - not a persistent server.
    localApiUrl: process.env.LOCAL_BOT_API_URL || 'http://localhost:8081',
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
