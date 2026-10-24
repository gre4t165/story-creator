# Arsitektur

## Teknologi

| Bagian | Teknologi |
|---|---|
| Aplikasi desktop | Electron 44 (Chromium + Node.js) |
| Build | electron-vite 5, Vite 7 |
| Tampilan | React 19, Tailwind CSS v4 (token di `@theme`), Zustand untuk state |
| Bahasa | TypeScript strict |
| Database | SQLite lewat better-sqlite3 |
| Video/audio | FFmpeg (`ffmpeg-static`), libass untuk caption |
| Pengenal suara | whisper.cpp (`resources/whisper/whisper-cli.exe`) + model Whisper Small |
| AI | Gemini (`@google/genai`), API OpenAI-compatible (OpenRouter, Groq, custom), ElevenLabs, Higgsfield |

## Tiga proses

```
┌──────────────── proses utama (Node, src/main) ────────────────┐
│ database, file proyek, kunci API, panggilan AI, FFmpeg, Whisper │
│ ipc.ts ◄── invoke ── preload ── window.api ── renderer          │
│ events.ts ──► webContents.send ──► window.api.on.* ──► store    │
└────────────────────────────────────────────────────────────────┘
┌─ preload (src/preload) ─┐   ┌─ renderer (src/renderer, React) ─┐
│ contextBridge: window.api│   │ halaman, editor, pratinjau        │
└──────────────────────────┘   └───────────────────────────────────┘
```

- **Renderer** tidak punya akses Node. Semua yang menyentuh disk, jaringan berkunci, atau FFmpeg lewat
  `window.api` (tipe lengkapnya di `src/shared/api.ts`).
- **Preload** hanya meneruskan panggilan: `call('kanal')` → `ipcRenderer.invoke`. Event dari main diterima lewat
  `listen('event:...')`.
- **Main** mendaftarkan handler di `src/main/ipc.ts`. Handler melempar `Error` dengan pesan berbahasa Indonesia
  yang langsung ditampilkan sebagai toast di renderer.

Jendela dibuat dengan `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.

## IPC (ringkasan)

| Kelompok | Kanal | Fungsi |
|---|---|---|
| `projects:*` | list, create, get, save, remove, duplicate | proyek dan snapshot |
| `story:*` | script, visuals, musicPrompt | LLM: naskah, rencana visual, prompt musik |
| `generate:*` | clipImage, clipVideo, clipTts, characterSheet, missingImages, missingVideos, missingTts, narration, syncCaptions, cancel, estimate | job AI dan estimasi kredit |
| `clips:*` | split, detachVoice | edit timeline yang menyentuh file |
| `assets:*` | setActive, setWords, pickMusic, pickImage | aset klip, caption, musik, logo |
| `settings:*` | get, set, keys, setKey, setCustom, clearKey, revealKey, testKey, voices | pengaturan dan kunci API |
| `models:list` | | daftar model live dari penyedia (dicache) |
| `export:*` | start, defaultFolder, pickFolder, reveal | ekspor MP4 |
| `whisper:*` | status, download, cancel, remove, openFolder | model Whisper lokal |
| `app:*` | openExternal (hanya https), copyText, version | utilitas |

Event dari main ke renderer (`src/main/events.ts`): `event:job`, `event:clip` (patch kolom klip),
`event:character`, `event:asset`, `event:whisper`. `App.tsx` meneruskannya ke store.

## Antrean job

`src/main/jobs.ts` menjalankan pekerjaan panjang sebagai **job** yang tersimpan di tabel `jobs` dan dikirim ke
renderer lewat `event:job` (progres, pesan, error).

| Antrean | Batas paralel | Dipakai untuk |
|---|---|---|
| `higgsfield` | 3 | gambar, lembar karakter, video |
| `freeimage` | 2 | gambar dan lembar karakter dari model langsung (Cloudflare, Pollinations, Gemini) |
| `tts` | 2 | narasi, TTS per klip |
| `whisper` | 1 | sinkron caption (Whisper memakai banyak core CPU) |
| `export` | 1 | ekspor MP4 |

Setiap job punya `AbortController` sehingga bisa dibatalkan (`generate:cancel`). Saat aplikasi dibuka lagi,
`resumeJobs()` melanjutkan permintaan Higgsfield yang sudah terkirim; job lain yang terputus ditandai gagal.

## Penyimpanan

Semua data pengguna ada di folder data aplikasi (`app.getPath('userData')`). Di Windows:
`%APPDATA%\Story Creator`.

```
%APPDATA%\Story Creator\
  studio.db                 SQLite: proyek, klip, pemeran, aset, job, pengaturan, kunci terenkripsi, cache
  projects\<id-proyek>\
    images\  videos\  audio\  music\  overlays\     file hasil generate dan unggahan
  models\whisper\ggml-small.bin                     model Whisper (diunduh dari Pengaturan)
  tmp\                                              file sementara render/Whisper (dihapus setelah selesai)
```

- Nama folder proyek dan file berupa ID acak; judul hanya ada di database.
- Path aset disimpan **relatif** terhadap folder proyek (`assets.local_path`), sehingga proyek bisa disalin utuh.
- Menghapus proyek menghapus foldernya.
- Folder data dari nama lama (`Bang Story`, lalu `Studio Cerita`) dipindahkan otomatis ke `Story Creator` saat pertama dibuka (`useDataFolder`).

### Protokol `studio://`

Renderer tidak memuat file lewat `file://`. Aset dan font disajikan oleh protokol khusus (`src/main/protocol.ts`)
dengan dukungan HTTP Range (supaya audio dan video bisa di-seek):

- `studio://asset/<id-proyek>/<path-relatif>`, dibuat oleh `assetUrl()` di `paths.ts`
- `studio://fonts/<file>.ttf`, font caption untuk `@font-face` di `styles.css`

## Simpan otomatis

Renderer menyimpan perubahan proyek sebagai **snapshot** (`projects:save` → `saveSnapshot` di `repo.ts`):
proyek, pemeran, dan klip. Penyimpanan berjalan 1,2 detik setelah perubahan terakhir, atau langsung dengan Ctrl+S
atau `flush()`.

Kolom aset klip (`image_asset_id`, `video_asset_id`, `audio_asset_id`) **tidak** ikut snapshot. Kolom itu milik
proses utama (hasil job, `setActive`, `split`) dan diubah dengan `patchClip` + `emit.clip`. Panggil `flush()`
sebelum IPC yang membaca klip dari database (generate, split, ekspor), supaya main melihat versi terbaru.

## Keamanan

- **CSP** di `src/renderer/index.html`: skrip hanya dari aplikasi sendiri; gambar/media dari `studio:`, `blob:`,
  `https:`; tidak ada iframe (`frame-src 'none'`), jadi tidak ada konten web yang disematkan di aplikasi.
- **Navigasi** jendela utama ke luar aplikasi diblok (`will-navigate`); `window.open` dibuka di browser bawaan
  hanya untuk URL https (`setWindowOpenHandler` → `shell.openExternal`).
- **Kunci API** dienkripsi dengan Electron `safeStorage` (DPAPI di Windows, terikat akun pengguna) di tabel
  `secrets`. Lihat [layanan-ai.md](layanan-ai.md#kunci-api-byok).

## Switch Chromium

Di `src/main/index.ts`:

- `disable-direct-composition-video-overlays`: video tidak diserahkan ke overlay hardware Windows, yang
  membulatkan posisi ke piksel bulat dan membuat gerak kamera di atas video bergetar di pratinjau.
- Dev harness (`prepareHarness`) menambah switch supaya jendela uji tetap menggambar walau tertutup jendela lain.
