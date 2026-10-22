#!/bin/bash
# Story Creator - klik 2x file ini untuk membuka aplikasi di macOS.
cd "$(dirname "$0")" || exit 1

# Terminal yang dibuka lewat klik 2x kadang belum memuat PATH Homebrew atau nvm.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo " Node.js belum terpasang di Mac ini."
  echo " Unduh versi LTS dari https://nodejs.org, pasang, lalu klik 2x 'START - MAC.command' lagi."
  echo
  open "https://nodejs.org/en/download"
  read -r -p " Tekan Enter untuk menutup..."
  exit 1
fi

# Pertama kali dibuka, atau folder node_modules berasal dari OS lain: pasang ulang.
if [ ! -f "node_modules/.bangstory-mac" ]; then
  if [ -d "node_modules" ]; then
    echo " Membersihkan node_modules lama..."
    rm -rf node_modules
  fi
  echo
  echo " Menyiapkan Story Creator untuk pertama kali."
  echo " Butuh koneksi internet dan beberapa menit, jangan tutup jendela ini..."
  echo
  if ! npm install; then
    echo
    echo " Gagal memasang. Periksa koneksi internet lalu coba lagi."
    read -r -p " Tekan Enter untuk menutup..."
    exit 1
  fi
  echo ok > node_modules/.bangstory-mac
fi

# Versi lama belum memuat paket suara Edge (gratis). Lengkapi tanpa menghapus apa pun.
if [ ! -d "node_modules/msedge-tts" ]; then
  echo " Memasang paket tambahan..."
  if ! npm install; then
    echo
    echo " Gagal memasang. Periksa koneksi internet lalu coba lagi."
    read -r -p " Tekan Enter untuk menutup..."
    exit 1
  fi
fi

# Electron mengunduh programnya sendiri saat pertama dipakai.
if [ ! -d "node_modules/electron/dist/Electron.app" ]; then
  echo " Mengunduh Electron..."
  if ! node node_modules/electron/install.js; then
    echo
    echo " Gagal mengunduh Electron. Periksa koneksi internet lalu coba lagi."
    read -r -p " Tekan Enter untuk menutup..."
    exit 1
  fi
fi

if [ ! -f "out/main/index.js" ]; then
  echo " Menyusun aplikasi..."
  if ! npm run build; then
    echo
    echo " Gagal menyusun aplikasi."
    read -r -p " Tekan Enter untuk menutup..."
    exit 1
  fi
fi

nohup ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . >/dev/null 2>&1 &
echo " Story Creator sedang dibuka. Jendela Terminal ini boleh ditutup."
exit 0
