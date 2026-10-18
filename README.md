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
- Cover, jumlah episode, musim & studio diambil dari halaman situs sumber, bukan dari AniList.
  AniList hanya dipakai untuk mendapatkan daftar judul yang rilis di tanggal/musim itu.
- /wallpaper [jumlah 1-5] — wallpaper anime random (alias: /wp)

Stiker:
- Kirim gambar + caption /stiker [atas | bawah] — jadi sticker webp + teks meme (alias: /sticker, /smeme)
- Contoh: kirim foto + caption "/stiker halo | apa kabar"

Tools:
- /kalk 7+2 — kalkulator
- /cuaca Jakarta — info cuaca (tambah angka 3 untuk prakiraan 3 hari)
- /tr en halo — translate
- /wiki Soekarno — Wikipedia
- /qr teks — gambar QR dikirim sebagai foto
- /short link — perpendek link
- /jam wib — jam dunia
- /sholat Jakarta — jadwal sholat
- /gempa — gempa terkini BMKG (+ peta guncangan); /gempa list — 5 gempa terakhir
- /kurs — kurs rupiah hari ini; /kurs 100 SGD — nominal tertentu
- /bmi 170 65 — indeks massa tubuh + berat ideal
- /umur 17-08-1995 — hitung umur (tahun, bulan, hari)
- /quran 2:255 — ayat Al-Quran + terjemahan; /quran acak — ayat random
- /ip example.com — DNS (A/AAAA/MX/NS/TXT) + lokasi server
- /libur — cek hari libur nasional (bisa /libur 2026-08-17)

Pengingat:
- /ingatkan 10m minum obat — pengingat 10 menit lagi
- /ingatkan 2j rapat — 2 jam; /ingatkan 3 hari cek vps — 3 hari
- /ingatkan besok 08:00 olahraga — waktu absolut (WIB)
- /ingatkan 17/10 20:00 bayar listrik — tanggal + jam
- /ingat list — daftar pengingat aktif
- /ingat hapus 3 — batalkan nomor 3; /ingat clear — hapus semua

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
- /mod antilink on|off — hapus + peringatkan pesan berisi link
- /mod tambah/hapus/list/clear kata — kelola kata berbahaya
- /mod batas 1-10 — peringatan sebelum kick (default 3)
- /mod pesan teks — custom pesan peringatan (pakai @nama @hitung @batas)
- /mod unwarn — reply pesan pelanggar untuk reset hitungan
- /mod welcome on|off — sambutan member baru
- /mod setwelcome teks — teks sambutan (pakai @nama)
- /mod setimg link — gambar anime untuk welcome
- Pelanggar: peringatan 1/3, 2/3, ke-3 = kick otomatis (bot harus admin)

Admin grup (owner atau admin grup, bot harus admin):
- /kick — reply pesan target (atau /kick 62812xxx)
- /promote /demote — jadikan / cabut admin
- /tutup /buka — kunci / buka grup
- /tagall pesan — tag semua anggota (WA) atau admin (TG)
- /admin — daftar admin; /info — info grup
- /setname Nama Baru — ganti nama grup
- /warn — peringatan manual, 3x = kick

Lainnya:
- /ping — cek hidup
- /id — lihat ID WhatsApp/Telegram kamu (untuk daftar owner)
- /help /menu /start — bantuan
- /panduan — penjelasan tiap fitur (/panduan 3 untuk bagian tertentu)

Owner (khusus owner, ketik /owner — menu bernomor 1-20):
- /ai setup/status/ganti/reset, /model, /lupa — kelola AI
- /sh perintah — remote VPS (contoh: /sh df -h)
- /promo, /auto, /mod — jadwal, pesan otomatis, moderasi grup
- /broadcast teks — kirim pesan ke semua chat yang pernah memakai bot
- /chats — daftar chat terdaftar
- /stats — statistik bot (user, chat, RAM, uptime)
- /backup — kirim file database ke chat ini
- /restart — restart service bot
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
