/**
 * Receives Telegram's webhook the instant the admin sends a file, and immediately
 * tells GitHub Actions to run - turning the ~5 minute polling delay into a few
 * seconds. Does NOT touch the file itself: only tiny JSON metadata (file_id,
 * size, name) passes through here, so this stays well within the free Workers plan.
 *
 * DEBUG MODE: every decision this Worker makes is also reported straight back
 * to the admin's Telegram chat, so you can see exactly what happened without
 * needing to dig through the Cloudflare dashboard. Remove the sendDebug(...)
 * calls once everything is confirmed working, if you want a quieter bot.
 */

function extractFile(message) {
  if (message.document) {
    return {
      fileId: message.document.file_id,
      size: message.document.file_size,
      fileName: message.document.file_name || 'file',
      asVideo: false,
    };
  }
  if (message.video) {
    return {
      fileId: message.video.file_id,
      size: message.video.file_size,
      fileName: message.video.file_name || 'video.mp4',
      asVideo: true,
    };
  }
  if (message.audio) {
    return {
      fileId: message.audio.file_id,
      size: message.audio.file_size,
      fileName: message.audio.file_name || 'audio.mp3',
      asVideo: false,
    };
  }
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, size: largest.file_size, fileName: 'photo.jpg', asVideo: false };
  }
  return null;
}

async function sendDebug(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.ADMIN_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.ADMIN_CHAT_ID, text: `🔧 debug: ${text}` }),
    });
  } catch (err) {
    // Never let a debug-message failure break the real flow.
    console.error('sendDebug failed:', err);
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('ok', { status: 200 });
    }

    // Reject anything not actually from Telegram.
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }

    const update = await request.json();
    const message = update.message;

    if (!message) {
      await sendDebug(env, 'received a webhook call with no "message" field (probably not a normal chat message) - ignored.');
      return new Response('ignored', { status: 200 });
    }

    if (String(message.chat?.id) !== String(env.ADMIN_CHAT_ID)) {
      await sendDebug(
        env,
        `received a message, but its chat id (${message.chat?.id}) does not match the ADMIN_CHAT_ID secret (${env.ADMIN_CHAT_ID}) - ignored. Fix the ADMIN_CHAT_ID secret if this is actually you.`
      );
      return new Response('ignored', { status: 200 });
    }

    const file = extractFile(message);
    if (!file) {
      await sendDebug(env, 'message is from the admin, but has no document/video/audio/photo attached - nothing to relay.');
      return new Response('ignored', { status: 200 });
    }

    await sendDebug(env, `found file "${file.fileName}" (${file.size} bytes) - dispatching to GitHub Actions now...`);

    const dispatchRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'bale-link-bot-worker',
        },
        body: JSON.stringify({
          event_type: 'relay-file',
          client_payload: {
            fileId: file.fileId,
            size: file.size,
            fileName: file.fileName,
            asVideo: file.asVideo,
            caption: message.caption || '',
          },
        }),
      }
    );

    if (!dispatchRes.ok) {
      const bodyText = await dispatchRes.text();
      console.error('GitHub dispatch failed:', dispatchRes.status, bodyText);
      await sendDebug(env, `GitHub dispatch FAILED - HTTP ${dispatchRes.status}: ${bodyText.slice(0, 300)}`);
      return new Response('dispatch failed', { status: 502 });
    }

    await sendDebug(env, `GitHub dispatch succeeded (HTTP ${dispatchRes.status}) - check the Actions tab now.`);
    return new Response('ok', { status: 200 });
  },
};
