# AGENTS.md — panduan untuk AI agent dan pengembang

Story Creator adalah aplikasi desktop (Electron + React + TypeScript) yang mengubah ide cerita menjadi video YouTube:
AI menulis naskah dan rencana visual, Higgsfield membuat gambar dan video (atau pengguna mengimpor gambar/video sendiri),
Gemini, ElevenLabs, Edge (gratis), atau Voicebox lokal membuat suara narator, lalu semuanya dirangkai di editor timeline
bersama musik dan SFX bawaan, dan diekspor jadi MP4 dengan FFmpeg.

Baca file ini dulu sebelum mengubah kode. Detail lengkapnya ada di folder [`docs/`](docs/README.md).

## Perintah

```bash
npm install            # pasang dependensi (better-sqlite3 dibangun ulang untuk Electron lewat postinstall)
npm run dev            # jalankan aplikasi dalam mode pengembangan (hot reload renderer)
npm run typecheck      # wajib bersih sebelum selesai: tsconfig.node.json + tsconfig.web.json
npm run build          # build ke folder out/ (main, preload, renderer)
npm run dist           # build + installer Windows (NSIS) ke folder dist/
```

Tidak ada framework unit test. Verifikasi dilakukan dengan `npm run typecheck`, `npm run build`, dan **dev harness**
yang menjalankan aplikasi dari skrip JSON (lihat [docs/pengembangan.md](docs/pengembangan.md)).

## Peta kode

```
src/
  main/            proses utama Electron (Node): database, AI, FFmpeg, file
    index.ts       startup, jendela, folder data, switch Chromium
    ipc.ts         semua handler IPC (window.api)
    repo.ts        akses SQLite (proyek, klip, pemeran, aset, job)
    db/index.ts    skema + migrasi (PRAGMA user_version)
    story.ts       naskah, rencana visual, prompt musik (LLM)
    generation.ts  gambar/video Higgsfield atau model gratis, lembar karakter, TTS per klip, estimasi kredit
    narration.ts   narasi satu rekaman utuh lalu dipotong per adegan; sinkron caption
    whisper.ts     whisper.cpp lokal (unduh model, kenali kata)
    align.ts, cuts.ts  cocokkan kata naskah ke hasil Whisper; pilih titik potong antar-adegan
    editing.ts     potong (split) klip, lepas suara klip
    importer.ts    impor gambar/video/suara: satu file, batch, JSON, seret ke kartu klip
    beats.ts       ketukan kasar musik (untuk "Musik + atur gambar")
    exporter.ts    render MP4 dengan FFmpeg
    fontMetrics.ts lebar teks dari file TTF (untuk kotak caption di ekspor)
    jobs.ts, events.ts  antrean job + event ke renderer
    secrets.ts     kunci API terenkripsi (safeStorage/DPAPI)
    services/      klien API: gemini, elevenlabs, edgetts, localtts (Voicebox), higgsfield, cloudflare, pollinations, llm (OpenAI-compatible), audio, http
    devharness.ts  otomatisasi uji (hanya mode pengembangan)
  preload/         jembatan aman: window.api (lihat src/shared/api.ts)
  shared/          kode yang dipakai main DAN renderer (tipe, aturan gerak, caption, timeline)
  renderer/src/    tampilan React + Tailwind v4 + Zustand
    pages/project/  langkah Ide, Naskah, Storyboard, Editor
    pages/project/editor/  pratinjau (Player), Timeline, Inspector (panel kanan), engine pemutaran
resources/         font caption, whisper-cli.exe + DLL, pustaka SFX CC0 (sfx/), file lisensi
scripts/           sfx-catalog.cjs: bangun ulang src/shared/sfx-catalog.json
docs/              dokumentasi pengembang
```

## Aturan yang tidak boleh dilanggar

1. **Pratinjau dan ekspor harus sama.** Semua aturan yang memengaruhi gambar atau suara final ditulis sekali di
   `src/shared/` lalu dipakai pratinjau (renderer) dan ekspor (main):
   `motion.ts` (gerak kamera, transisi), `captions.ts` (gaya, font, pemenggalan baris caption),
   `timeline.ts` (potongan suara/musik, kata caption per klip), `overlays.ts`, `higgsfield.ts`, `sfx.ts` (cara SFX diputar).
   Jangan menghitung ulang aturan itu di satu sisi saja.
2. **Kunci API milik pengguna (BYOK).** Kunci hanya disimpan terenkripsi lewat `secrets.ts`, hanya dikirim ke
   layanannya masing-masing, dan tidak pernah dicetak ke log, error, atau file.
3. **Migrasi database hanya ditambah di akhir** array `MIGRATIONS` di `src/main/db/index.ts`. Jangan mengubah
   migrasi lama; `PRAGMA user_version` menghitung berapa yang sudah dijalankan.
4. **Kolom klip baru** harus ditambahkan di semua tempat: tipe `Clip` (`shared/types.ts`), migrasi, `toClip`,
   upsert di `saveSnapshot`, `duplicateProject`, `insertClipAfter`, `CLIP_COLS` (kalau di-patch dari main), dan
   nilai bawaan `addClip` di `renderer/src/store/project.ts`. Detail: [docs/data-model.md](docs/data-model.md).
5. **IPC baru** butuh tiga tempat: `handle(...)` di `main/ipc.ts`, tipe di `shared/api.ts`, dan `call(...)` di
   `preload/index.ts`.
6. **Teks antarmuka berbahasa Indonesia** (santai, pakai "kamu"); **komentar dan nama di kode berbahasa Inggris**.
   Komentar menjelaskan *kenapa*, bukan *apa*.
7. **TypeScript strict** dengan `noUnusedLocals`/`noUnusedParameters`: hapus impor dan variabel yang tidak dipakai.
8. Jangan memakai `<select>` bawaan browser; pakai komponen `Select`/`Popover`. Aturan UI lain ada di
   [docs/konvensi.md](docs/konvensi.md).
9. Jangan mengulang bug yang sudah diperbaiki. Baca [docs/keputusan-teknis.md](docs/keputusan-teknis.md) sebelum
   mengubah ekspor, narasi, Whisper, caption, atau pratinjau video.

## Cara menguji perubahan

- Selalu: `npm run typecheck` lalu `npm run build`.
- Perubahan tampilan atau alur: jalankan aplikasi dengan dev harness (`STUDIO_CAPTURE_PLAN`), ambil screenshot,
  dan periksa isi halaman lewat `console.log` (lebih andal daripada screenshot saja).
- Perubahan ekspor: ekspor proyek demo (`{"main":"seed"}` lalu `{"main":"export"}`), lalu periksa hasilnya dengan
  ffmpeg (durasi video vs audio, cuplikan frame).
- Gunakan folder data sementara (`STUDIO_USER_DATA`) agar data dan kunci pengguna tidak tersentuh.

## Dokumentasi lanjutan

| Topik | File |
|---|---|
| Arsitektur, proses, IPC, penyimpanan | [docs/arsitektur.md](docs/arsitektur.md) |
| Skema database dan tipe data | [docs/data-model.md](docs/data-model.md) |
| Alur produksi (naskah → visual → suara → caption) | [docs/alur-produksi.md](docs/alur-produksi.md) |
| Editor, timeline, pratinjau, ekspor | [docs/editor-dan-ekspor.md](docs/editor-dan-ekspor.md) |
| Layanan AI dan kunci API | [docs/layanan-ai.md](docs/layanan-ai.md) |
| Setup, dev harness, build, rilis | [docs/pengembangan.md](docs/pengembangan.md) |
| Gaya kode dan aturan UI | [docs/konvensi.md](docs/konvensi.md) |
| Keputusan teknis dan alasannya | [docs/keputusan-teknis.md](docs/keputusan-teknis.md) |
| Masalah yang diketahui dan ide lanjutan | [docs/masalah-diketahui.md](docs/masalah-diketahui.md) |
