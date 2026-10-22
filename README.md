# Story Creator

_cc by Bang Story_

Aplikasi desktop Windows untuk mengubah ide cerita jadi video YouTube: AI menyusun klip dan naskah, Higgsfield membuat gambar dan video, Gemini, ElevenLabs, atau Edge (gratis) membuat suara narator, lalu semuanya dirangkai di editor timeline dan diekspor jadi MP4.

## Cara membuka

Syarat: [Node.js](https://nodejs.org) versi LTS sudah terpasang, dan ada koneksi internet saat pertama kali dibuka.

- **Windows:** klik 2x `START - WIN.bat`.
- **macOS:** klik 2x `START - MAC.command`. Kalau muncul pesan tidak punya izin, buka Terminal di folder ini dan jalankan `chmod +x "START - MAC.command"` sekali. Kalau macOS memblokirnya, klik kanan file itu › Open.

Saat pertama kali dibuka, START memasang semua kebutuhan (`npm install`) dan mengunduh Electron. Ini butuh beberapa menit. Setelah itu aplikasi langsung terbuka setiap kali START diklik. Kalau folder ini dipindah ke OS lain, START otomatis memasang ulang kebutuhannya.

Setelah membuka, isi kunci API di **Pengaturan**: Higgsfield untuk gambar dan video, Google Gemini untuk menyusun cerita, dan Gemini, ElevenLabs, atau Edge untuk suara narator. Tanpa biaya sama sekali: Cloudflare Workers AI untuk gambar dan suara Edge untuk narasi (tidak perlu kunci).

Catatan macOS: fitur caption akurat (Whisper lokal) baru tersedia untuk Windows. Fitur lainnya tetap berjalan.

Kalau kode di `src` diubah, hapus folder `out` (atau jalankan `npm run build`) supaya START menyusun ulang aplikasinya.

## Alur

1. **Ide cerita**: tulis sinopsis, pilih durasi, bahasa, format (16:9 atau 9:16), suara narator, gaya visual (2D, 3D, atau realistis), serta model gambar dan model video Higgsfield untuk proyek ini. AI penyusun cerita (Gemini, OpenRouter, Groq, atau endpoint custom) lalu menulis naskah.
2. **Naskah**: baca dulu alurnya: berapa adegan, apa yang terjadi di tiap adegan, dan narasi (VO) masing-masing. Adegan bisa diubah, ditambah, dihapus, dan diurutkan ulang. Narasi boleh memuat tag ekspresi suara seperti `<short pause>`, `<long pause>`, `<chuckles>`, atau `<sigh>`. Setelah itu AI membuat visual dari naskah final: prompt gambar, pemeran, gerak kamera dan kekuatannya, transisi, serta arahan gerak untuk video AI. Kalau naskah diubah lagi, hanya adegan yang berubah yang disusun ulang visualnya.
3. **Storyboard**: setiap adegan punya gambar (Higgsfield), suara narasi (TTS), dan gerak: gerak kamera gratis atau video AI. Suara narasi dibuat dalam satu rekaman utuh lalu dipotong otomatis per adegan, supaya suara dan intonasinya konsisten. Pratinjau gerak kamera berputar otomatis dan tetap terlihat saat panel digulir.
4. **Editor**: pratinjau langsung dengan gerak kamera, transisi, caption karaoke, musik latar, serta overlay logo, watermark, atau teks yang bisa digeser langsung di pratinjau. Lalu ekspor MP4 dengan FFmpeg.

   Timeline-nya seperti editor video biasa: tarik tepi klip untuk memanjangkan atau memendekkan (video tidak bisa melebihi panjang aslinya; tepi kiri memotong awal video), tarik tepi atau geser suara, caption, musik, dan overlay, **Potong** (S) membelah klip di playhead (suara dan naskahnya ikut terbelah di jeda antar kata), dan **Hapus** (Delete) menghapus item yang dipilih. Tombol bulat di antara klip membuka panel transisi dengan pratinjau langsung.

## Durasi dan suara

Panjang tiap klip mengikuti panjang suara narasinya. Sebelum suara dibuat, durasinya diperkirakan dari jumlah kata (sekitar 2,6 kata per detik, tag ekspresi tidak dihitung). Video AI meminta durasi terpendek yang menutup panjang klip; kalau model tidak bisa sepanjang itu, frame terakhir ditahan sampai klip selesai.

Narasi utuh dibuat per bagian sampai sekitar 4 menit (Gemini) atau 2.400 karakter (ElevenLabs, dengan konteks teks sebelum dan sesudahnya). Untuk Gemini, antar-adegan disisipi `<long pause>`, lalu jeda itu dideteksi dengan FFmpeg dan dicocokkan ke posisi tiap adegan. Untuk ElevenLabs, batas adegan diambil dari waktu tiap kata yang dikirim API-nya. Potongan-potongannya diputar berurutan persis seperti rekaman utuh.

## Caption akurat (Whisper lokal)

Gemini TTS tidak mengirim waktu per kata. Kalau model **Whisper Small** sudah diunduh (Pengaturan › Caption akurat, 488 MB, disimpan di `%APPDATA%\Story Creator\models\whisper` dan dicek SHA-256-nya), aplikasi menjalankan `whisper-cli` (whisper.cpp, ikut terpasang di `resources/whisper`) di komputer ini untuk mencari kapan tiap kata diucapkan. Kata-kata naskah lalu dicocokkan ke hasil dengar Whisper, jadi ejaan caption tetap mengikuti naskah sedangkan waktunya mengikuti suara asli. Ini berjalan otomatis setelah narasi Gemini dibuat, dan titik potong antar-adegan ikut memakai posisi kata. Klip lama bisa disinkronkan dari tab Caption di Editor. Unduhan bisa dibatalkan dan dilanjutkan; di mode dev, `STUDIO_WHISPER_URL` bisa mengarahkannya ke salinan lokal.

Proyek tersimpan otomatis (juga lewat tombol Simpan atau Ctrl+S) di SQLite, di folder `%APPDATA%\Story Creator`. Data dari nama lama (`%APPDATA%\Bang Story` atau `%APPDATA%\Studio Cerita`) dipindahkan otomatis saat aplikasi pertama kali dibuka.

## Kunci API

Pengguna memasukkan kuncinya sendiri di **Pengaturan › Layanan AI dan kunci**. Setiap bagian (penyusun cerita, suara narator) punya satu dropdown penyedia, dan hanya konfigurasi penyedia yang dipilih yang tampil dan dipakai. Kunci dienkripsi dengan Windows DPAPI (`safeStorage`).

| Layanan | Dipakai untuk | Wajib |
|---|---|---|
| Cloudflare Workers AI (`ACCOUNT_ID:API_TOKEN`, jatah gratis harian) | Gambar gratis (FLUX.1 schnell, SDXL Lightning) | Tidak, alternatif gratis Higgsfield |
| Google Gemini (kunci yang sama, billing aktif) | Gambar Nano Banana, dengan lembar karakter | Tidak, alternatif murah Higgsfield |
| Pollinations (kunci gratis) | Gambar gratis, eksperimental | Tidak |
| Higgsfield (satu API key dari tombol **Copy API key** di console, format `KEY_ID:KEY_SECRET`) | Gambar, lembar karakter, video AI | Ya |
| Penyusun cerita, pilih satu: Google Gemini, OpenRouter, Groq, atau endpoint custom (OpenAI-compatible) | Menyusun klip, naskah, dan pemeran | Ya, salah satu |
| Google Gemini | Suara narator Gemini TTS | Kalau memakai Gemini TTS |
| ElevenLabs | TTS dengan waktu kata presisi | Opsional |
| Edge TTS | Suara narator gratis dengan waktu kata presisi, tanpa kunci (layanan tidak resmi) | Tidak |

Setelah kunci penyusun cerita disimpan, daftar modelnya diambil langsung dari penyedia (ratusan model untuk OpenRouter) dan dipilih lewat dropdown yang bisa dicari. Daftar disimpan di cache 24 jam dan bisa dimuat ulang kapan saja. Endpoint custom menerima server apa pun yang kompatibel dengan OpenAI API, misalnya Ollama (`http://localhost:11434/v1`), LM Studio, vLLM, DeepSeek, atau xAI Grok (`https://api.x.ai/v1`).

## Model Higgsfield

Semua model Higgsfield yang bisa membuat gambar dari teks (14 model) dan menganimasikan gambar klip (34 model) tersedia. Modelnya dipilih per proyek di bagian **Model AI** pada langkah Ide cerita, lengkap dengan pencarian, filter, dan perkiraan kredit dari endpoint `estimate`. Pilihan terakhir jadi bawaan proyek berikutnya.

API Higgsfield tidak punya daftar harga. Biaya tiap model diambil dari endpoint `estimate` (gratis, tidak memakai kredit) untuk akun pengguna, ditampilkan di tiap baris dropdown (kredit dan US$) dan bisa diurutkan dari yang termurah. Hasilnya disimpan sehari dan dihapus saat kunci Higgsfield diganti.

Daftarnya ada di `src/shared/higgsfield-catalog.json`, disusun dari dokumentasi API (docs.higgsfield.ai) beserta skema input tiap model. `src/shared/higgsfield.ts` membentuk isi request dari skema itu: rasio frame, resolusi 2K untuk gambar, resolusi video sesuai pilihan di proyek (bawaan 1080p, atau yang terdekat yang tersedia di model), durasi yang menutup panjang klip, lembar karakter sebagai referensi bila model menerimanya, serta audio bawaan model dimatikan. Model yang butuh video masukan (edit video, motion control) atau hanya teks-ke-video tidak dimasukkan karena tidak bisa menganimasikan gambar klip.

Untuk output JSON, aplikasi mencoba `json_schema` dulu, lalu `json_object`, lalu teks biasa dengan parser yang toleran (tag `<think>` dan code fence dibuang). Jadi model yang tidak mendukung structured output tetap bisa dipakai.

## Menjalankan

Butuh Node.js 22 atau lebih baru.

```bash
npm install
npm run dev
```

## Membuat installer .exe

```bash
npm run dist
```

Hasilnya ada di `dist/StoryCreator-Setup-<versi>.exe`. Untuk folder siap jalan tanpa installer: `npx electron-builder --win --dir`.

## Struktur

```
src/
  main/        proses utama (backend lokal)
    db/          skema SQLite + migrasi
    services/    higgsfield, cloudflare, pollinations, llm (Gemini/OpenRouter/Groq/custom), gemini, elevenlabs, edgetts, audio
    generation.ts  job gambar, lembar karakter, video, TTS
    exporter.ts    render MP4 dengan FFmpeg (gerak kamera, xfade, caption ASS, mix audio)
    jobs.ts        antrean dengan batas proses bersamaan
  preload/     jembatan aman window.api
  shared/      tipe, preset gaya visual, gerak kamera, caption, katalog model
  renderer/    tampilan React + Tailwind
resources/fonts  15 font caption (Google Fonts, lisensi di resources/licenses/fonts), dipakai pratinjau dan FFmpeg
```

`shared/motion.ts` dan `shared/captions.ts` dipakai oleh pratinjau di editor dan oleh ekspor FFmpeg, jadi hasil MP4 sama dengan yang terlihat di editor.

## Dokumentasi pengembang

Ingin mengembangkan aplikasi ini sendiri, atau dengan bantuan AI agent seperti Claude Code, Codex, Cursor, atau Gemini CLI? Mulai dari sini:

- [AGENTS.md](AGENTS.md): ringkasan proyek, perintah, peta kode, dan aturan yang tidak boleh dilanggar. Banyak AI agent membacanya otomatis; Claude Code membacanya lewat [CLAUDE.md](CLAUDE.md).
- [docs/](docs/README.md): arsitektur, model data, alur produksi, editor dan ekspor, layanan AI, cara menguji, konvensi, keputusan teknis, dan masalah yang diketahui.
- [CHANGELOG.md](CHANGELOG.md): riwayat versi.

## Catatan

- Seedream tidak tersedia di API Higgsfield, jadi model gambar bawaannya GPT Image 2.5 Sunburst dan model video bawaannya Kling 3.0 Standard.
- API Higgsfield tidak punya endpoint saldo. Aplikasi menampilkan perkiraan biaya dari endpoint `estimate`.
- Tanpa model Whisper, waktu caption untuk suara Gemini diperkirakan dari panjang kata. ElevenLabs dan Edge selalu memberi waktu yang presisi.
- Harness uji khusus mode dev ada di `src/main/devharness.ts` (variabel `STUDIO_CAPTURE_PLAN`, `STUDIO_USER_DATA`, `STUDIO_LOG`) dan tidak aktif di aplikasi terpasang. Di mode dev, `STUDIO_HF_BASE` bisa mengarahkan panggilan Higgsfield ke server tiruan lokal supaya tampilan bisa diuji tanpa memakai kredit.
- Lisensi: FFmpeg (GPL), whisper.cpp (MIT), 15 font caption (OFL dan Apache 2.0), dan LobeHub Icons (MIT, untuk logo penyedia) ikut terpasang. Teks lisensinya ada di `resources/licenses`; lisensi FFmpeg disalin dari paket `ffmpeg-static` saat installer dibuat. Model Whisper Small (MIT) diunduh terpisah. Logo penyedia adalah merek milik pemiliknya masing-masing.
