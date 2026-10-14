# wa-tg-ai-bot

Bot WhatsApp (Baileys) + Telegram (grammY) dalam satu repo. Bahasa Indonesia.

## Fitur

- **Chat AI custom provider** — tiap user `/ai setup`: pilih provider (tiprouter/openrouter/openai/custom URL), bot deteksi daftar model otomatis, user pilih model + kirim API key. Key disimpan per-user di SQLite.
- **Downloader sosmed** — `/dl <link>` (YouTube, TikTok, IG Reels, FB, X). Maks 150 MB. File di VPS dihapus setelah terkirim.
- **YT ke MP3** — `/mp3 <link>`.
- **Analisis file** — kirim `.log .txt .docx .pdf .csv .json .md` atau gambar, bot ringkas + bisa `/tanya`.
- **Umum** — `/ping /help /menu /lupa /model`, owner: `/owner stats`.

## Pasang

```
npm install
cp .env.example .env
# isi BOT_TOKEN (dari @BotFather) dan OWNER_NUMBER (628xx)
node index.js
```

Pairing WA: kode 8 digit muncul di log, ketik di HP > Perangkat Tertaut.

## Opsional (downloader)

```
sudo apt install ffmpeg poppler-utils
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp
```

Tanpa ini, `/dl` dan `/mp3` balas panduan install.

## Struktur

```
core/wa.js  core/tg.js      koneksi platform
commands/ai.js  commands/dl.js   perintah
services/ai.js  downloader.js  fileanalyzer.js
db/store.js     index.js  .env.example
```

`auth_info/` (sesi WA), `db/*.sqlite3`, `.env` masuk `.gitignore` — aman di-push ke GitHub.
