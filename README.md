# bale-link-bot

Relays every file/video an admin sends to a Telegram bot straight into one fixed
Bale channel and one fixed Rubika channel - automatically, in order, with **no
persistent server and nothing ever written to disk or stored anywhere**.

## How it works (instant path)

1. Telegram is configured to use a **webhook**: the instant the admin sends a
   file, Telegram POSTs the message metadata (not the file itself, just its
   `file_id`, size, name) to a tiny **Cloudflare Worker**.
2. The Worker checks the message is really from Telegram and really from the
   admin, then immediately tells **GitHub Actions** to run via a
   `repository_dispatch` event - carrying just that small metadata along.
3. GitHub Actions spins up a brand-new, throwaway virtual machine ("runner"),
   usually within a few seconds.
4. On that runner, a prebuilt Docker image of Telegram's **Local Bot API
   Server** starts (only for this one run) - this lifts the normal 20MB
   file-size limit up to 2GB, needed for the download step.
5. `src/relay.js` **streams** the file directly from Telegram into Bale and
   Rubika at the same time - the bytes flow through memory only, never
   touching the runner's disk as a saved file.
6. The runner (and everything on it) is destroyed the moment the job ends.

Nothing persists between runs and nothing is stored anywhere at any point -
Telegram, the Worker, and the runner are all just relaying bytes through.

**Typical delay from "user sends file" to "file lands in both channels":**
usually a few seconds to a couple of minutes, dominated by the file's own
upload/download time, not by polling delay.

## One-time setup

### 1. Deploy the Cloudflare Worker (no local Node.js needed)
Deployment runs entirely inside GitHub Actions via `.github/workflows/deploy-worker.yml`:

1. Get a Cloudflare API token: Cloudflare dashboard -> profile icon -> **My Profile** ->
   **API Tokens** -> **Create Token** -> use the "Edit Cloudflare Workers" template.
2. Get your Cloudflare **Account ID**: dashboard -> Workers & Pages -> it's shown on
   the right sidebar of the overview page.
3. Add both as GitHub repo secrets (Settings -> Secrets and variables -> Actions):
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Push this repo to GitHub (or re-run the "Deploy Cloudflare Worker" workflow from
   the Actions tab) - it deploys the Worker automatically.
5. Once deployed, go to the Cloudflare dashboard -> **Workers & Pages** -> your
   worker (`bale-link-bot-trigger`) to find its `*.workers.dev` URL - you'll need
   it next.
6. On that same worker's page, go to **Settings -> Variables and Secrets** and add
   these as **secret** (encrypted) variables, all through the dashboard - no CLI:
   `TELEGRAM_WEBHOOK_SECRET` (any long random string you make up),
   `ADMIN_CHAT_ID`, `GITHUB_TOKEN` (see step 3 below), `GITHUB_OWNER`, `GITHUB_REPO`.

### 2. Point Telegram's webhook at the Worker
Run this once (replace the placeholders), using the SAME random string you
used for `TELEGRAM_WEBHOOK_SECRET` above:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<WORKER_URL>&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

### 3. Create a GitHub token for the Worker to use
GitHub -> Settings -> Developer settings -> Fine-grained tokens -> generate
one scoped to just this repo, with **Actions: Read and write** permission.
Use this as `GITHUB_TOKEN` in step 1.

### 4. Add the GitHub Actions repo secrets
Repo -> Settings -> Secrets and variables -> Actions -> "New repository secret".
Add every value listed in `.env.example` (bot tokens, API id/hash, channel ids).

### 5. Add the bots as channel admins
Add the Telegram bot, the Bale bot, and the Rubika bot as **admins** of their
respective destination channels, so each has permission to post.

### 6. Test it
Send a small file to your Telegram bot. Check the Actions tab - a run should
start within seconds. You can also trigger a run manually from the Actions
tab (`Run workflow`, fill in a real `fileId`) without needing a live Telegram
message.

## Known limitations
- Verify the exact Bale (`tapi.bale.ai`) and Rubika (`botapi.rubika.ir`)
  request/response field names against their current docs before relying on
  this in production - third-party bot APIs change without much notice.
- Since Telegram is in webhook mode, there's no polling fallback: if the
  Worker or the GitHub dispatch call fails, that one file is not retried
  automatically - the admin would need to resend it. This trades a small
  amount of reliability for near-instant delivery.
- GitHub Actions free-tier minutes are generous but not unlimited - fine for
  personal/occasional use; heavy daily multi-GB traffic could approach the
  monthly limit.
