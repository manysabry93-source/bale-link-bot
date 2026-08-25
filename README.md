# Bale Link Bot

تلگرام → رمزگذاری AES-256-GCM → ذخیره موقت روی Cloudflare R2 → ارسال به بله و/یا روبیکا (طبق انتخاب ادمین).

## نصب روی VM (Oracle Free Tier)
پیش‌نیاز: سرور Local Bot API تلگرام باید از قبل نصب و در حال اجرا باشه (فایل `deploy/telegram-bot-api.service` رو با API_ID/HASH خودت پر کن و فعالش کن).

```bash
git clone <your-repo-url> /opt/bale-link-bot
cd /opt/bale-link-bot
npm install
cp .env.example .env
nano .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # مقدار ENCRYPTION_KEY_HEX
sudo cp deploy/bale-link-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bale-link-bot
```

## مدیریت کانال‌های مقصد (فقط ادمین، داخل تلگرام)
```
/addchannel work-channel bale -100123456789
/addchannel rubika-main rubika b0Abc123XYZ
/channels
/removechannel work-channel
```

## نکات امنیتی
- ربات فقط به `ADMIN_CHAT_ID` پاسخ می‌ده؛ به بقیه کاملاً سکوت می‌کنه.
- Bucket مربوط به R2 باید **Private** باشه.
- فایل روی R2 رمزشده ذخیره می‌شه و فقط با دکمه «🗑 حذف نسخه موقت» پاک می‌شه.

## نکته مهم
قبل از استفاده واقعی، فرمت دقیق API بله (tapi.bale.ai) و روبیکا (rubika.ir/botapi) رو با آخرین مستندات‌شون تطبیق بده — این دو API گاهی بدون اطلاع‌رسانی تغییر می‌کنن.
