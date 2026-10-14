#  Bot & AI — WhatsApp + Telegram

Bot WhatsApp (Baileys) + Telegram (grammY) dalam satu repo. Bahasa Indonesia.

## Fitur

AI:
- /ai setup — hubungkan AI sendiri (pilih provider: tiprouter/openrouter/openai/custom URL, pilih model, kirim API key)
- /ai status — lihat AI aktifmu
- /ai ganti — ganti model
- /ai reset — hapus key + riwayat
- /model — sama dengan /ai ganti
- /lupa — hapus riwayat chat
- Chat bebas — kirim teks langsung dijawab AI (setelah setup)

Downloader:
- /dl <link> — download video (YouTube, TikTok, IG Reels, FB, X), maks 150 MB
- /mp3 <link> — YouTube ke MP3 (atau kirim link + tulis "jadi mp3")
- Kirim video (.mp4 .mov .mkv .webm) — otomatis dikonversi ke MP3, dikirim balik

File & dokumen:
- Kirim file (.log .txt .docx .pdf .csv .json .md gambar) — langsung diringkas AI
- /tanya >soal< — tanya soal file yang baru dikirim (berlaku 3 menit)

Anime:
- /anime [jumlah] — rilisan ongoing terbaru Samehadaku (gambar + judul + link, 1 album)

Tools:
- /kalk 12*8+5 — kalkulator
- /cuaca Jakarta — info cuaca
- /tr en halo — translate
- /wiki Soekarno — Wikipedia
- /qr <teks> — link gambar QR
- /short <link> — perpendek link
- /jam wib — jam dunia
- /sholat Jakarta — jadwal sholat

Fun:
- /quote /joke /fakta /pantun
- /dadu /koin /suit batu
- /ramal /tebak /jawab /nama Budi

Grup & jadwal:
- /promo <menit> <pesan> — promo terjadwal ke chat ini
- /promo list/hapus/clear — kelola jadwal promo
- /auto — status pesan otomatis grup (sholat + libur nasional)
- /auto sholat on|off — pengingat tiap waktu sholat
- /auto zona wib|wita|wit — pilih zona waktu
- /auto libur on|off — ucapan libur nasional

Lainnya:
- /ping — cek hidup
- /id — lihat ID WhatsApp/Telegram kamu (untuk daftar owner)
- /help /menu /start — bantuan

Owner (khusus owner):
- /owner stats — statistik pemakaian AI
- /sh <perintah> — remote VPS (contoh: /sh df -h)

## Pasang

```
git clone https://github.com/RizkyXLoli/Script-bot-Telegram-vps
cd Script-bot-Telegram-vps
npm install
cp .env.example .env
bash setup.sh
```

Isi BOT_TOKEN (dari @BotFather), tambah owner via menu 4 (kirim /id ke bot untuk dapat ID).
Pairing WA: kode 8 digit muncul di log, ketik di HP > Perangkat Tertaut.
