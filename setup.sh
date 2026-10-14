#!/bin/bash
# setup.sh — Menu setting Elaina AI Bot di VPS (Bahasa Indonesia).
# Jalankan: bash setup.sh
cd "$(dirname "$0")"

say() { echo -e "\n== $1 =="; }

# pastikan node/npm ada
cek_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "!! Node.js belum terpasang. Jalankan: bash install-node.sh"
    return 1
  fi
  return 0
}

pasang_dep() {
  say "Install dependency (npm install)..."
  cek_node || return 1
  npm install || { echo "npm install gagal."; return 1; }
  echo "Selesai."
}

isi_env() {
  say "Isi pengaturan (.env)"
  [ -f .env ] || cp .env.example .env
  read -p "Token Telegram dari @BotFather: " BOT
  [ -n "$BOT" ] && sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$BOT|" .env
  echo "Cari ID Telegram kamu: chat ke @userinfobot, salin angkanya."
  read -p "ID Telegram owner (angka, mis. 123456789): " OID
  [ -n "$OID" ] && sed -i "s|^OWNER_ID=.*|OWNER_ID=tg:$OID|" .env
  echo "Tersimpan di .env"
}

cek_tools() {
  say "Status tools yang dibutuhkan bot"
  for b in node npm yt-dlp ffmpeg ffprobe pdftotext; do
    if command -v "$b" >/dev/null 2>&1; then
      echo "OK   $b : $(command -v "$b")"
    else
      echo "HILANG $b : belum terpasang"
    fi
  done
}

pasang_dl() {
  say "Pasang semua tools (yt-dlp + ffmpeg + ffprobe + pdftotext, butuh sudo)..."
  sudo apt update && sudo apt install -y ffmpeg poppler-utils curl
  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  sudo chmod +x /usr/local/bin/yt-dlp
  echo ""
  cek_tools
  echo "Selesai. /dl, /mp3, dan baca PDF aktif."
}

jalan() {
  say "Menjalankan bot... (Ctrl+C untuk berhenti)"
  cek_node || return 1
  node index.js
  echo "Bot berhenti."
}

pasang_service() {
  say "Pasang systemd service (auto-jalan saat VPS nyala)..."
  cek_node || return 1
  sudo tee /etc/systemd/system/elaina-bot.service > /dev/null <<EOF
[Unit]
Description=Elaina AI Bot (WA+Telegram)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=$(command -v node) $(pwd)/index.js
Restart=on-failure
RestartSec=5
MemoryHigh=300M
MemoryMax=450M

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now elaina-bot
  echo "Service elaina-bot aktif."
}

while true; do
  echo ""
  echo "===== Elaina AI Bot Telegram — Menu VPS ====="
  echo "1. Install dependency (npm install)"
  echo "2. Isi pengaturan (.env: token TG)"
  echo "3. Pasang semua tools (yt-dlp + ffmpeg + pdftotext)"
  echo "4. Jalankan bot sekarang"
  echo "5. Pasang auto-jalan (systemd service)"
  echo "6. Lihat log service"
  echo "7. Stop service"
  echo "8. Cek status tools"
  echo "0. Keluar"
  read -p "Pilih [0-8]: " P
  case "$P" in
    1) pasang_dep ;;
    2) isi_env ;;
    3) pasang_dl ;;
    4) jalan ;;
    5) pasang_service ;;
    6) sudo journalctl -u elaina-bot -n 50 --no-pager ;;
    7) sudo systemctl stop elaina-bot; echo "Berhenti." ;;
    8) cek_tools ;;
    0) exit 0 ;;
    *) echo "Pilihan tidak ada." ;;
  esac
done
