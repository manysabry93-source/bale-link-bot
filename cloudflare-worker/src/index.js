/**
 * Receives Telegram's webhook the instant the admin sends a file, and immediately
 * tells GitHub Actions to run - turning the ~5 minute polling delay into a few
 * seconds. Does NOT touch the file itself: only tiny JSON metadata (file_id,
 * size, name) passes through here, so this stays well within the free Workers plan.
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

    // Always ack with 200 quickly - Telegram retries aggressively otherwise.
    if (!message || String(message.chat?.id) !== String(env.ADMIN_CHAT_ID)) {
      return new Response('ignored', { status: 200 });
    }

    const file = extractFile(message);
    if (!file) {
      return new Response('ignored', { status: 200 });
    }

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
      console.error('GitHub dispatch failed:', dispatchRes.status, await dispatchRes.text());
      return new Response('dispatch failed', { status: 502 });
    }

    return new Response('ok', { status: 200 });
  },
};
