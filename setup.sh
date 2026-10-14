#!/bin/bash
# setup.sh — Menu VPS Elaina AI Bot (Bahasa Indonesia).
# Jalankan: bash setup.sh
cd "$(dirname "$0")"

HIJAU='\e[32m'; MERAH='\e[31m'; KUNING='\e[33m'; BIRU='\e[34m'; RESET='\e[0m'
ok() { echo -e "${HIJAU}OK${RESET}     $1"; }
hilang() { echo -e "${MERAH}HILANG${RESET} $1"; }
judul() { echo -e "\n${BIRU}━━━ $1 ━━━${RESET}"; }

command -v node >/dev/null 2>&1 || export PATH="$HOME/.hermes/tools/node-26.7.0-linux-x64/bin:$PATH"

cek_node() {
  command -v node >/dev/null 2>&1 || { echo "Node.js belum ada. Pilih menu 1 dulu."; return 1; }
}

status_tools() {
  for b in node npm yt-dlp ffmpeg ffprobe pdftotext python3; do
    if command -v "$b" >/dev/null 2>&1; then ok "$b : $(command -v "$b")";
    else hilang "$b : belum terpasang"; fi
  done
  echo ""
  if [ -f .env ]; then
    grep -q "^BOT_TOKEN=.\+" .env 2>/dev/null && ok "BOT_TOKEN terisi" || hilang "BOT_TOKEN kosong"
    grep -q "^OWNER_ID=.\+" .env 2>/dev/null && ok "OWNER_ID : $(grep ^OWNER_ID= .env | cut -d= -f2)" || hilang "OWNER_ID kosong"
    echo "WA : $(grep ^WA_LOGIN= .env 2>/dev/null | cut -d= -f2 || echo belum-set) -> $(grep ^WA_PAIR_NUMBER= .env 2>/dev/null | cut -d= -f2)"
  else hilang ".env belum ada"; fi
  systemctl is-active --quiet elaina-bot 2>/dev/null && ok "service elaina-bot JALAN" || hilang "service elaina-bot BERHENTI"
}

pasang_semua() {
  judul "1. Setup awal VPS (Node.js + npm install + tools)"
  if command -v node >/dev/null 2>&1; then ok "node sudah ada: $(node -v)";
  else
    sudo apt update && sudo apt install -y curl ca-certificates \
      && curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - \
      && sudo apt install -y nodejs && node -v && npm -v || { echo "Pasang Node gagal."; return 1; }
  fi
  command -v node >/dev/null 2>&1 || export PATH="$HOME/.hermes/tools/node-26.7.0-linux-x64/bin:$PATH"
  npm install || { echo "npm install gagal."; return 1; }
  sudo apt install -y ffmpeg poppler-utils curl python3
  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  sudo chmod +x /usr/local/bin/yt-dlp
  echo ""
  status_tools
  echo "Setup awal selesai."
}

isi_env() {
  judul "3. Isi pengaturan (.env)"
  [ -f .env ] || { [ -f .env.example ] && cp .env.example .env || touch .env; }
  read -p "Token Telegram dari @BotFather (kosongkan=lompati): " BOT
  [ -n "$BOT" ] && { grep -q "^BOT_TOKEN=" .env && sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$BOT|" .env || echo "BOT_TOKEN=$BOT" >> .env; }
  echo "Cari ID Telegram kamu: chat ke @userinfobot, salin angkanya."
  read -p "ID Telegram owner (angka, kosongkan=lompati): " OID
  [ -n "$OID" ] && { grep -q "^OWNER_ID=" .env && sed -i "s|^OWNER_ID=.*|OWNER_ID=tg:$OID|" .env || echo "OWNER_ID=tg:$OID" >> .env; }
  echo "Tersimpan di .env"
}

atur_wa() {
  judul "5. Atur login WhatsApp"
  echo "Metode: 1=pairing code (8 digit)  2=QR scan"
  read -p "Pilih [1/2]: " M
  if [ "$M" = "2" ]; then
    grep -q "^WA_LOGIN=" .env && sed -i "s|^WA_LOGIN=.*|WA_LOGIN=qr|" .env || echo "WA_LOGIN=qr" >> .env
    echo "Mode QR. Restart service, lalu: journalctl -u elaina-bot -f (scan QR) atau lihat db/wa-session/wa-qr.png"
  else
    read -p "Nomor WA (628xx tanpa +): " N
    [[ "$N" =~ ^628[0-9]{7,12}$ ]] || { echo "Nomor tidak valid."; return 1; }
    grep -q "^WA_LOGIN=" .env && sed -i "s|^WA_LOGIN=.*|WA_LOGIN=pair|" .env || echo "WA_LOGIN=pair" >> .env
    grep -q "^WA_PAIR_NUMBER=" .env && sed -i "s|^WA_PAIR_NUMBER=.*|WA_PAIR_NUMBER=$N|" .env || echo "WA_PAIR_NUMBER=$N" >> .env
    grep -q "^WA_ENABLED=" .env && sed -i "s|^WA_ENABLED=.*|WA_ENABLED=1|" .env || echo "WA_ENABLED=1" >> .env
    echo "Nomor tersimpan. Restart service lalu ambil kode: journalctl -u elaina-bot --since '1 min ago' | grep PAIRING"
  fi
}

pasang_service() {
  judul "6. Pasang auto-jalan (systemd service)"
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

kelola_owner() {
  judul "Kelola owner (akses menu owner)"
  [ -f .env ] || touch .env
  gabung() {
    local ids="$1"
    grep -q "^OWNER_IDS=" .env && sed -i "s|^OWNER_IDS=.*|OWNER_IDS=$ids|" .env || echo "OWNER_IDS=$ids" >> .env
  }
  while true; do
    cur="$(grep ^OWNER_IDS= .env 2>/dev/null | cut -d= -f2)"
    [ -z "$cur" ] && cur="$(grep ^OWNER_ID= .env 2>/dev/null | cut -d= -f2)"
    echo ""
    echo "Daftar owner sekarang: ${cur:-belum ada}"
    echo "  a. Tambah ID Telegram (angka)"
    echo "  b. Tambah ID WhatsApp (kirim /id ke bot)"
    echo ""
    echo "  Cara ambil ID WhatsApp: chat ke bot, kirim /id,"
    echo "  lalu salin angka yang dibalas bot (mis. 123456789)."
    echo "  c. Hapus satu"
    echo "  d. Kembali"
    read -p "Pilih [a-d]: " Q
    case "$Q" in
      a) read -p "ID Telegram (angka): " I
         [[ "$I" =~ ^[0-9]+$ ]] || { echo "Tidak valid."; continue; }
         I="tg:$I"
         echo "$cur" | grep -qw "$I" && { echo "Sudah ada."; continue; }
         gabung "${cur:+$cur,}$I"; cur="$(grep ^OWNER_IDS= .env | cut -d= -f2)"
         echo "Ditambah. Restart bot (menu 5) agar berlaku." ;;
      b) read -p "ID WhatsApp (angka dari /id): " N
         [[ "$N" =~ ^[0-9]{5,20}$ ]] || { echo "Tidak valid. Kirim /id ke bot untuk dapat ID yang benar."; continue; }
         N="wa:$N"
         echo "$cur" | grep -qw "$N" && { echo "Sudah ada."; continue; }
         gabung "${cur:+$cur,}$N"; cur="$(grep ^OWNER_IDS= .env | cut -d= -f2)"
         echo "Ditambah. Restart bot (menu 5) agar berlaku." ;;
      c) read -p "Hapus yang mana (tulis persis, mis. tg:123 atau wa:456): " H
         baru="$(echo ",$cur," | sed "s|,$H,|,|" | sed 's/^,//;s/,$//')"
         gabung "$baru"; echo "Daftar sekarang: ${baru:-kosong}" ;;
      d) break ;;
      *) echo "Pilihan tidak ada." ;;
    esac
  done
}

tampil_menu() {
  clear
  echo -e "${BIRU}╔══════════════════════════════════════════╗${RESET}"
  echo -e "${BIRU}║${RESET}      ELAINA AI BOT — MENU VPS          ${BIRU}║${RESET}"
  echo -e "${BIRU}╠══════════════════════════════════════════╣${RESET}"
  echo -e "${BIRU}║${RESET}  SETUP                                    ${BIRU}║${RESET}"
  echo -e "${BIRU}║${RESET}   1. Setup awal VPS (node+npm+tools)     ${BIRU}║${RESET}"
  echo -e "${BIRU}║${RESET}   2. Isi token bot Telegram + owner      ${BIRU}║${RESET}"
  echo -e "${BIRU}║${RESET}   3. Atur login WhatsApp (pair/QR)       ${BIRU}║${RESET}"
  echo -e "${BIRU}║${RESET}   4. Kelola owner (tambah/hapus ID)      ${BIRU}║${RESET}"
  echo -e "${BIRU}║${RESET}  OPERASIONAL                              ${BIRU}║${RESET}"
  echo -e "${BIRU}║${RESET}   5. Pasang auto-jalan (systemd)         ${BIRU}║${RESET}"
  echo -e "${BIRU}║${RESET}   6. Restart bot                         ${BIRU}║${RESET}"
  echo -e "${BIRU}║${RESET}   7. Lihat log (QR tampil di sini)       ${BIRU}║${RESET}"
  echo -e "${BIRU}║${RESET}   8. Status tools + config               ${BIRU}║${RESET}"
  echo -e "${BIRU}║${RESET}   0. Keluar                              ${BIRU}║${RESET}"
  echo -e "${BIRU}╚══════════════════════════════════════════╝${RESET}"
}

tampil_splash() {
  clear
  local custom_txt="$(dirname "$0")/splash.txt"
  local custom_img="$(dirname "$0")/splash.png"
  if [ -f "$custom_txt" ]; then
    cat "$custom_txt"
  elif [ -f "$custom_img" ]; then
    if ! command -v chafa >/dev/null 2>&1; then
      echo "  Memasang chafa untuk tampilkan gambar..."
      (sudo apt update -qq && sudo apt install -y -qq chafa || apt install -y -qq chafa || sudo apt-get install -y -qq chafa) >/dev/null 2>&1
    fi
    if command -v chafa >/dev/null 2>&1; then
      chafa --symbols block --colors 256 "$custom_img" 2>/dev/null || echo "(gambar gagal tampil)"
    else
      echo "  (chafa gagal dipasang otomatis. Coba manual: sudo apt install chafa)"
    fi
  else
    echo -e "${BIRU}  E L A I N A  —  AI BOT WA+Telegram${RESET}"
    echo "  Taruh gambar sendiri sebagai splash.png di folder bot"
    echo "  atau ASCII custom: splash.txt di folder bot."
  fi
  echo ""
  echo "  Memuat menu dalam 5 detik..."
  sleep 5
}

tampil_splash
while true; do
  tampil_menu
  read -p "Pilih [0-8]: " P
  case "$P" in
    1) pasang_semua; read -p "Enter untuk kembali... " ;;
    2) isi_env; read -p "Enter untuk kembali... " ;;
    3) atur_wa; read -p "Enter untuk kembali... " ;;
    4) kelola_owner ;;
    5) pasang_service; read -p "Enter untuk kembali... " ;;
    6) sudo systemctl restart elaina-bot && sleep 2 && systemctl is-active elaina-bot; read -p "Enter untuk kembali... " ;;
    7) sudo journalctl -u elaina-bot -n 80 --no-pager; read -p "Enter untuk kembali... " ;;
    8) judul "Status"; status_tools; read -p "Enter untuk kembali... " ;;
    0) exit 0 ;;
    *) echo "Pilihan tidak ada."; sleep 1 ;;
  esac
done
