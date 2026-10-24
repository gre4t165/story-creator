# Changelog

Semua perubahan penting dicatat di sini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/),
dan nomor versi mengikuti [Semantic Versioning](https://semver.org/lang/id/): **mayor** untuk perubahan yang merusak
data atau alur lama, **minor** untuk fitur baru, **patch** untuk perbaikan.

Cara menaikkan versi ada di [docs/pengembangan.md](docs/pengembangan.md#versi-dan-rilis).

## [Belum dirilis]

### Ditambahkan
- **Hapus semua gambar, suara, dan video** (Storyboard › Hapus media). Tiap aksi melepas medianya dari semua klip,
  membatalkan yang masih dibuat supaya tidak muncul lagi, dan bisa diurungkan (Ctrl+Z atau tombol Urungkan di pesan).
  Lembar karakter, musik, dan SFX tidak berubah. Sampul proyek ikut hilang atau kembali bersama gambarnya.
- **Hapus gambar** dan **Hapus suara** per klip di panel klip Storyboard.
- **Bersihkan file tak terpakai** menggantikan "Bersihkan file video": menghapus dari disk gambar, suara, dan video
  yang tidak terpasang di mana pun (termasuk versi lama gambar yang dibuat ulang). Lembar karakter, musik, dan logo
  tidak disentuh. Aturan "tidak terpakai" ada di `shared/media.ts`, dipakai penghitung di layar dan penghapus di main.

### Dihapus
- **Video tutorial YouTube yang disematkan** di halaman Tentang aplikasi. Header Referer untuk YouTube dan izin
  iframe di CSP ikut dihapus; sekarang tidak ada iframe sama sekali (`frame-src 'none'`).

## [1.2.0] - 2026-10-23

### Ditambahkan
- **Urungkan dan ulangi (Undo/Redo)** untuk semua pekerjaan di proyek: naskah, prompt, durasi, gerak, transisi,
  overlay, musik, SFX, caption, pemeran, tambah/hapus/pindah klip, sampai aksi besar seperti potong klip, impor
  gambar/video/suara, "Susun naskah", dan "Susun visual". Tombol di header proyek (label menyebut aksinya) dan
  pintasan Ctrl+Z, Ctrl+Y atau Ctrl+Shift+Z. Edit beruntun (mengetik, menggeser slider) menjadi satu langkah, begitu
  juga "Acak gerak" dan "Musik + atur gambar". Riwayat menyimpan 100 langkah per proyek yang sedang dibuka. Gambar
  atau suara yang baru selesai dibuat tidak ikut hilang saat mengurungkan hal lain.
- **Hapus semua video** (Storyboard › Video): setiap klip kembali ke gambar dengan gerak kamera, video yang masih
  dibuat dibatalkan, dan bisa diurungkan. Ada juga **Hapus video** per klip (Storyboard dan Inspector editor).
- **Bersihkan file video**: menghapus dari disk file video yang tidak terpasang di klip mana pun (Urungkan dikosongkan).

### Diubah
- Menekan Ctrl+Z di dalam kotak teks tetap mengurungkan ketikan di kotak itu; di luar kotak teks, ia mengurungkan proyek.

## [1.1.1] - 2026-10-22

### Diubah
- **Aturan gambar dan video (sembunyikan wajah, pakaian sopan) mati secara bawaan.** Bisa dinyalakan di Pengaturan ›
  Aturan gambar & video. Pengaturan yang sudah pernah kamu simpan tidak berubah.
- Tautan daftar Higgsfield dan ElevenLabs diperbarui (disatukan di `renderer/src/lib/links.ts`).

### Diperbaiki
- Sinkron caption dengan Whisper tidak lagi menimpa teks caption yang sudah diedit tangan: kata hasil edit yang
  diberi waktu ulang.

## [1.1.0] - 2026-10-22

### Diubah
- **Nama aplikasi menjadi Story Creator.** Folder data `%APPDATA%\Bang Story` (proyek, database, kunci) dipindahkan
  otomatis saat pertama dibuka. ID aplikasi tetap, jadi installer baru memperbarui instalasi lama.

### Ditambahkan
- **Impor video**: file MP4, MOV, atau WebM bisa dipakai di mana pun gambar bisa diimpor (satu klip, banyak
  sekaligus, JSON dengan kunci `video`, atau seret ke kartu klip). Video jadi video klip dengan frame pertamanya
  sebagai gambar. Klip tanpa narasi mengikuti panjang video; suara asli video tidak dipakai.
- Teks kredit menjadi "cc by Bang Story".
- **Suara lokal: Voicebox / voice studio** di `http://127.0.0.1:17493` (alamat bisa diganti di Pengaturan). Daftar suara
  diambil dari profil Voicebox (preset dan kloning); server lain dipanggil lewat format OpenAI `/v1/audio/speech`.
- **Impor gambar dan suara sendiri** di Storyboard: satu file per klip, banyak file sekaligus (dicocokkan dengan nomor
  di nama file atau urutannya), atau dari file JSON per adegan (gambar, audio, narasi, prompt, dan suara narator per
  adegan). JSON suara bisa langsung menyuarakan narasinya dengan suara berbeda per adegan.
- **Acak gerak**: satu klik memberi setiap gambar gerak kamera acak (zoom, geser, Ken Burns); klip bersebelahan
  tidak pernah sama.
- **Musik + atur gambar**: pilih musik, lalu panjang tiap klip diatur supaya video sepanjang musik dan gambar
  berganti di ketukan. Klip bersuara tidak dipotong lebih pendek dari narasinya. Juga ada di tab Musik editor.
- **SFX otomatis tanpa upload**: pustaka bawaan 96 suara berlisensi CC0 (paket Kenney.nl ditambah whoosh, riser,
  dan suasana hujan/angin/laut/malam/ruangan yang dibuat dengan FFmpeg). Tombol "Buat SFX otomatis" di tab SFX editor
  memasang whoosh di setiap transisi, suasana sesuai isi adegan, dan efek saat narasi menyebutnya (pintu, pedang,
  langkah, ledakan, dan lain-lain). SFX punya jalur sendiri di timeline: bisa digeser, dipotong, diganti, dan
  diatur volumenya; ikut terekspor.
- **Taruh file di kartu klip**: seret gambar atau suara dari Explorer ke kartu klip di Storyboard.

### Diperbaiki
- Storyboard bisa error saat proyek sedang dimuat karena urutan hook React berubah.
- File yang dijatuhkan di luar kartu klip tidak lagi membuka file itu menggantikan aplikasi.
- **Alternatif gratis untuk gambar**: Cloudflare Workers AI (FLUX.1 schnell dan SDXL Lightning, jatah harian gratis)
  dan Pollinations (eksperimental). Muncul di pemilih model gambar dengan tag "Gratis". Model gratis tidak memakai
  lembar karakter.
- **Alternatif gratis untuk suara**: Edge TTS, tanpa kunci, dengan waktu kata presisi untuk caption karaoke.
  Layanannya tidak resmi dari Microsoft.
- **Nano Banana (Google Gemini)** sebagai model gambar: Nano Banana 2.1, Nano Banana Pro, dan Nano Banana 2.5 Flash Image,
  memakai kunci Gemini yang sama. Murah (sekitar $0,03–0,13 per gambar) tetapi butuh billing aktif, dan memakai
  lembar karakter sebagai referensi.
- Antrean `freeimage` dan paket `msedge-tts`. Skrip START memasang paket tambahan otomatis untuk instalasi lama.
- **Aturan gambar dan video** (Pengaturan → Aturan gambar & video), menyala secara bawaan:
  - *Wajah tidak ditampakkan*, untuk manusia dan hewan. Storyboard, prompt gambar, lembar karakter (tampak belakang),
    dan prompt video AI meminta tokoh dari belakang, siluet, atau wajah tertutup; gaya stickman memakai kepala polos.
    Setiap gambar dan video AI yang jadi diperiksa Gemini, lalu wajah yang masih terlihat diblur atau dimozaik
    otomatis sebelum disimpan. Kalau pemeriksaan gagal, hasilnya ditahan dan "buat ulang" memeriksa hasil yang sama
    tanpa membuat gambar baru.
  - *Pakaian sopan untuk wanita*: longgar, menutup lengan dan kaki, dengan pilihan hijab.

## [1.0.0] - 2026-10-02

Rilis pertama Bang Story (sebelumnya bernama Studio Cerita).

### Alur produksi
- Empat langkah: **Ide cerita → Naskah → Storyboard → Editor**, tersimpan otomatis di database lokal.
- Penyusun cerita memakai Gemini, OpenRouter, Groq, atau endpoint custom yang kompatibel dengan OpenAI. Daftar
  modelnya diambil langsung dari penyedia.
- Naskah bisa diubah, ditambah, dihapus, dan diurutkan ulang. Narasi boleh memuat tag ekspresi suara.
- Rencana visual dibuat dari naskah final: prompt gambar berlabel (dunia dan era, aksi, baju per adegan, hal yang
  harus dihindari), pemeran beserta lembar karakter, gerak kamera, transisi, dan arahan gerak video.
- 14 model gambar dan 34 model video Higgsfield, dengan perkiraan kredit dari endpoint `estimate`. Resolusi video
  bisa dipilih per proyek.
- Narasi dibuat dalam satu rekaman utuh (Gemini TTS atau ElevenLabs), lalu dipotong otomatis per adegan.
- Caption akurat dengan Whisper lokal (mode DTW). Klip lama bisa disinkronkan ulang dari tab Caption.
- Panel Musik bisa membuat prompt musik latar untuk Suno atau AI musik lain.

### Editor
- Pratinjau langsung dengan gerak kamera, transisi, caption karaoke, musik latar, dan overlay (logo, watermark,
  teks) yang bisa digeser di pratinjau.
- Timeline seperti editor video:
  - tarik tepi klip untuk mengatur panjangnya (video tidak bisa melebihi panjang aslinya);
  - geser dan potong suara, caption, musik, dan overlay;
  - **Potong** (S atau Ctrl+B) dan **Hapus** (Delete);
  - snap ke playhead dan sambungan;
  - overlay bertumpuk di baris masing-masing.
- Transisi diatur per sambungan dari tombol di antara klip. Panelnya punya pratinjau yang diputar berulang, durasi
  0,2–2 detik, dan tombol terapkan ke semua.
- Gerak kamera bisa diatur untuk klip gambar maupun video. Pratinjaunya diputar tanpa menggeser playhead.
- Caption:
  - 4 gaya dan pilihan tanpa caption;
  - 15 font (4 tegas, 9 kartun/komik, 2 tulisan tangan/elegan) dengan contoh di daftar;
  - ukuran, posisi, warna, dan kotak latar rounded;
  - teksnya bisa diedit langsung dan tersimpan otomatis.
- Suara: volume per klip dan volume narasi. Musik: volume, otomatis mengecil saat narasi, dipotong, dan digeser.

### Ekspor
- MP4 dirender dengan FFmpeg di komputer pengguna. Hasilnya sama dengan pratinjau karena aturan gerak, transisi,
  caption, dan potongan suara dipakai bersama (`src/shared/`).
- Gerak kamera halus memakai filter `perspective`. Caption memakai libass dengan kotak rounded, dan ukurannya
  sama dengan pratinjau.
- Proyek bisa diekspor berulang kali setelah diedit.

### Lainnya
- Kunci API milik pengguna (BYOK), disimpan terenkripsi dengan DPAPI Windows (`safeStorage`).
- Halaman About menampilkan versi aplikasi, tautan ke channel Bang Tutorial, dan video tutorial.
- Salinan siap jalan dengan skrip START untuk Windows dan macOS.
- Dokumentasi pengembang: [AGENTS.md](AGENTS.md) dan folder [docs/](docs/README.md).

### Batasan yang diketahui
Lihat [docs/masalah-diketahui.md](docs/masalah-diketahui.md). Yang paling terasa:
- gerak kamera di atas video masih bergetar di pratinjau (hasil ekspor halus);
- belum ada undo/redo;
- Whisper dan installer baru tersedia untuk Windows.
