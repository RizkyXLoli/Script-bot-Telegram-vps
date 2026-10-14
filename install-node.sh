#!/bin/bash
# install-node.sh — pasang Node.js 22 system-wide (Ubuntu/Debian) via NodeSource.
# Jalankan sekali: bash install-node.sh
set -e

if command -v node >/dev/null 2>&1; then
  echo "Node sudah ada: $(node -v)"
  exit 0
fi

echo "== Pasang Node.js 22 (NodeSource) =="
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
echo "Selesai: $(node -v) / npm $(npm -v)"
