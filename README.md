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
- /dl <link> — download video (YouTube, TikTok, IG Reels, FB, X), maks 150 MB , langsung kirim link tanpa perintah /dl juga bisa
- /mp3 <link> — YouTube ke MP3 
- Kirim video (.mp4 .mov .mkv .webm) — otomatis dikonversi ke MP3, dikirim balik

File & dokumen:
- Kirim file (.log .txt .docx .pdf .csv .json .md gambar) — langsung diringkas AI
- /tanya >soal< — tanya soal file yang baru dikirim (berlaku 3 menit)

Anime:
- /anime [jumlah] — rilisan ongoing terbaru Samehadaku (gambar + judul + link, 1 album)
- /anime <musim> <tahun> — anime per musim + cover + link tonton (contoh: /anime summer 2019)
- /anime <tanggal> <bulan> <tahun> — anime yang rilis di tanggal itu (contoh: /anime 12 juni 2025)
- /anime <bulan> <tahun> — sebulan penuh (contoh: /anime juli 2025); format angka juga bisa (12/6/2025)
- Link tonton & cover diambil langsung dari situs sumber (Samehadaku, Oploverz, Anoboy) — tanpa AniList.
  Arsip tanggal situs sumber tersedia mulai awal 2024.
- /wallpaper [jumlah 1-5] — wallpaper anime random (alias: /wp)

Stiker:
- Kirim gambar + caption /stiker [atas | bawah] — jadi sticker webp + teks meme (alias: /sticker, /smeme)
- Contoh: kirim foto + caption "/stiker halo | apa kabar"

Tools:
- /kalk 7+2 — kalkulator(biar tidak gblk kayak prabowo
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

Moderasi grup (kirim dari grup target, khusus owner):
- /mod — status + bantuan perintah
- /mod on|off — aktif/matikan filter kata berbahaya
- /mod tambah/hapus/list/clear <kata> — kelola kata berbahaya
- /mod batas <1-10> — peringatan sebelum kick (default 3)
- /mod pesan <teks> — custom pesan peringatan (pakai @nama @hitung @batas)
- /mod unwarn — reply pesan pelanggar untuk reset hitungan
- /mod welcome on|off — sambutan member baru
- /mod setwelcome <teks> — teks sambutan (pakai @nama)
- /mod setimg <link> — gambar anime untuk welcome
- Pelanggar: peringatan 1/3, 2/3, ke-3 = kick otomatis (bot harus admin)

Lainnya:
- /ping — cek hidup
- /id — lihat ID WhatsApp/Telegram kamu (untuk daftar owner)
- /help /menu /start — bantuan

Owner (khusus owner, ketik /owner — menu bernomor 1-15):
- /ai setup/status/ganti/reset, /model, /lupa — kelola AI
- /sh <perintah> — remote VPS (contoh: /sh df -h)
- /promo, /auto, /mod — jadwal, pesan otomatis, moderasi grup
- /owner stats — statistik pemakaian AI

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
