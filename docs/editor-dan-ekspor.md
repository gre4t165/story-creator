# Editor dan ekspor

Prinsip utama: **apa yang terlihat dan terdengar di pratinjau harus sama dengan MP4 hasil ekspor.** Karena itu
semua aturan yang memengaruhi hasil ditulis di `src/shared/` dan dipakai dua sisi:

| Modul bersama | Isi | Dipakai pratinjau | Dipakai ekspor |
|---|---|---|---|
| `motion.ts` | gerak kamera (`cameraAt`/`cameraCss` dan `cameraPerspective`), transisi, durasi transisi | Player | exporter |
| `captions.ts` | gaya caption, 15 font + metriknya, pemenggalan baris, potongan caption, kotak rounded | Player | exporter (ASS) |
| `timeline.ts` | `voiceSpan`, `clipCaptionWords`, `musicSpan`, `splitNarration` | engine, Timeline | exporter, editing |
| `overlays.ts` | posisi (anchor numpad), gaya teks overlay | Player, OverlayPanel | exporter |
| `higgsfield.ts` | body permintaan model, durasi, resolusi | ModelSection | generation |

## Model timeline

```
Klip   [ 01 ][ 02 ][ 03 ]...      bersambung tanpa celah (magnetis), panjang = clip.durationMs
Caption  ▭▭ ▭▭ ▭▭                  dari kata narasi tiap klip (meta.words), mengikuti potongan suara
Suara  [~~~][~~~ ][~~]            milik klipnya: bisa dipotong dan digeser di dalam klip, terpotong di akhir klip
Musik  [==========]               satu file, posisi editor.musicStartMs..musicEndMs, mulai musicInMs di dalam lagu
Overlay [logo.....] / [teks]      overlay yang waktunya bertumpuk otomatis pindah ke baris baru (overlayLanes)
```

Aturan edit (`renderer/src/pages/project/editor/Timeline.tsx`):

- **Tepi kanan klip**: panjang klip. Klip video tidak bisa lebih panjang dari sisa videonya
  (`video.durationMs - mediaInMs`).
- **Tepi kiri klip**: untuk video, memotong awal video (`mediaInMs`); untuk gambar, memendekkan klip dari awal.
- **Suara**: tepi kiri memotong awal suara tanpa menggeser sisanya (`voiceInMs` dan `voiceStartMs` naik
  bersama), tepi kanan memotong akhir (`voiceOutMs`), seret badan untuk memindahkan (`voiceStartMs`).
- **Caption**: tepi atau badan menggeser waktu kata potongan itu; disimpan lewat `assets:setWords` saat dilepas.
- **Musik dan overlay**: tepi untuk awal/akhir, badan untuk memindahkan.
- Tepi menempel (snap) ke playhead dan sambungan klip dalam radius 8 px. Skala timeline dibekukan selama menyeret.
- **Potong** (`S`/Ctrl+B): `clips:split` di `editing.ts` membelah klip di playhead. Titik potong digeser ke jeda
  antar kata terdekat; file suara dan teks narasi dibelah (`splitNarration`), dan bagian kedua memakai gambar/video
  yang sama dengan `mediaInMs` bertambah. Bagian pertama berakhir dengan transisi `cut`.
- **Hapus** (`Delete`): klip (dengan konfirmasi), suara (`clips:detachVoice`), potongan caption (kata dihapus),
  musik, overlay, atau transisi (menjadi `cut`).

## Pratinjau (`Player.tsx` + `engine.ts`)

- `usePlayback` menyimpan `t` (detik) dan `playing`; jam berjalan dengan `requestAnimationFrame`.
- `usePlaybackEngine` menyinkronkan elemen `<audio>` narasi (per klip, mengikuti `voiceWindow`) dan musik
  (mengikuti `musicSpan`). Volume di atas 0 dB tidak bisa diputar `<audio>`, jadi semua suara diturunkan bersama
  agar perbandingannya tetap benar.
- **Frame**: klip sebelum, sekarang, dan sesudah playhead selalu terpasang, berurutan, di wadah `isolate`. Klip
  berikutnya menunggu tersembunyi di titik mulainya, sehingga perpindahan klip tidak membuat elemen video baru
  (yang sempat menampilkan frame pertama sebelum seek). Klip yang sedang menunggu langsung diputar tanpa seek
  ulang (seek ulang menahan video sekitar 150 ms di sambungan).
- **Gerak kamera**: `cameraAt()` → `cameraCss()` (transform CSS) untuk gambar dan untuk video (`videoCamera`).
  Video yang diberi gerak kamera dibuat opasitas 0,999 agar tidak dijadikan overlay hardware.
- **Transisi**: `transitionStyles()` (`transitionStyle.ts`). Durasi = `transitionSecOf(klip)`, dibatasi panjang
  kedua klip yang disambung (sama dengan ekspor).
- **Audition** (`useAudition`): memutar ulang sebagian timeline **hanya di pratinjau**, tanpa menggeser playhead
  dan tanpa suara. Dipakai saat mengganti gerak kamera (satu klip) dan di panel Transisi (sambungan, termasuk
  mencoba jenis transisi lain saat kursor di atas pilihannya). Berhenti saat Putar, seek, ganti panel, atau klik
  pratinjau.
- **Caption**: dirender di DOM dengan font yang sama dengan ekspor; pemenggalan baris memakai
  `layoutCaptionLines` dengan lebar dari canvas, sehingga barisnya sama dengan ekspor.

## Ekspor (`src/main/exporter.ts`)

1. **Rencana segmen** (`planSegments`): awal setiap klip dibulatkan ke frame utuh. Setiap segmen dirender
   `own + overlap + pad` frame (`pad` = 2 frame cadangan), supaya xfade tidak pernah kehabisan gambar.
2. **Render per klip** (2 sekaligus), H.264 tanpa audio:
   - gambar: `-loop 1`, lalu `cameraChain`: scale+crop ke ukuran kerja (resolusi asli sumber, 1×–2× output),
     filter `perspective` untuk gerak kamera, scale ke ukuran output;
   - video: `-ss mediaIn`, `fps`, `tpad` (frame terakhir ditahan kalau video lebih pendek), gerak kamera opsional
     dengan cara yang sama.
3. **Satu pass FFmpeg** untuk semuanya:
   - rantai `xfade` antar segmen (offset = awal segmen berikutnya, durasi = overlap);
   - overlay gambar (`overlay` dengan `enable=between(t,...)`);
   - caption + teks overlay lewat filter `ass` (libass) dengan `fontsdir` berisi font bawaan;
   - audio: setiap suara `atrim` (potongan) → fade pendek kalau terpotong akhir klip → `volume` → `adelay`
     (posisi), lalu `amix`; musik `-stream_loop -1` → `atrim` mulai di `musicIn` → panjang → `volume` → fade
     out → `adelay`; turunkan musik saat narasi dengan `sidechaincompress`; `loudnorm` −14 LUFS (opsional).
4. Hasil: MP4 (H.264 + AAC, `+faststart`), dan `.srt` opsional. Nama file yang sudah ada diberi akhiran `-2`, `-3`.

### Caption di ekspor

- File ASS dibuat `buildAss`. Ukuran font dikonversi dengan metrik `cell` tiap font (libass mengukur font dengan
  winAscent+winDescent, CSS dengan em).
- **Kotak rounded**: libass hanya bisa kotak siku, jadi kotak digambar sendiri sebagai drawing ASS (`\p1`,
  `roundedRectPath`) di layer 0. Lebar teks diukur dari file TTF (`fontMetrics.ts`), dan baris dipecah dengan
  `layoutCaptionLines` yang sama dengan pratinjau.
- Kata yang sedang diucapkan diwarnai lewat event per kata (`\c`).

## Menambah fitur di editor: daftar periksa

- Aturan baru yang memengaruhi hasil? Tulis di `src/shared/` dan pakai di Player **dan** exporter.
- Nilai baru per klip? Ikuti [data-model.md](data-model.md#menambah-kolom-klip).
- Item timeline baru? Beri klik → tab Inspector, gaya pilih `SELECTED`, dan aksi Hapus di `EditorStep`.
- Uji ekspor: durasi video = jumlah durasi klip, durasi audio sama dengan video, cuplikan frame di sambungan.
