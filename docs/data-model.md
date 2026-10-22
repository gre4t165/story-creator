# Model data

Tipe TypeScript-nya ada di `src/shared/types.ts`; skema SQLite di `src/main/db/index.ts`; akses database di
`src/main/repo.ts`. Kolom database memakai `snake_case`, properti TypeScript memakai `camelCase`.

## Tabel

| Tabel | Isi |
|---|---|
| `projects` | satu baris per proyek; pengaturan editor disimpan sebagai JSON di `editor_json` |
| `clips` | adegan/klip berurutan (`sort`) dalam proyek |
| `characters` | pemeran proyek + lembar karakternya (`sheet_asset_id`) |
| `assets` | setiap file: gambar, video, audio narasi, musik, overlay, ekspor; menyimpan `local_path` relatif |
| `jobs` | pekerjaan AI/render beserta status dan progresnya |
| `settings` | pengaturan aplikasi (key → JSON) |
| `secrets` | kunci API terenkripsi + hasil tes terakhir |
| `cache` | cache bebas (daftar model, estimasi kredit, daftar suara), dengan `updated_at` |

Relasi `project_id` memakai `ON DELETE CASCADE`. Tidak ada foreign key antara klip dan aset; klip menunjuk aset
lewat `image_asset_id`, `video_asset_id`, `audio_asset_id`. Aset lama tetap tersimpan sebagai riwayat versi.

## Migrasi

`MIGRATIONS` adalah array SQL. Saat database dibuka, setiap migrasi setelah `PRAGMA user_version` dijalankan
dalam transaksi, lalu `user_version` dinaikkan.

| # | Isi |
|---|---|
| 1 | Skema awal (semua tabel di atas kecuali `cache`) |
| 2 | Tabel `cache` |
| 3 | `projects.video_model` |
| 4 | `clips.story`, `clips.visual_source`; langkah lama digeser karena langkah Naskah disisipkan |
| 5 | `projects.video_resolution` |
| 6 | `clips.video_camera`, `video_strength`, `transition_ms`, `voice_gain_db` |
| 7 | `clips.media_in_ms`, `voice_in_ms`, `voice_out_ms`, `voice_start_ms` |

**Aturan:** tambahkan migrasi baru di akhir. Jangan mengubah migrasi yang sudah ada, karena pengguna lama sudah
menjalankannya.

## Proyek (`Project`)

| Properti | Arti |
|---|---|
| `title`, `synopsis` | judul (diisi AI saat menulis naskah) dan ide cerita |
| `durationSec`, `language`, `aspectRatio` | target durasi, bahasa naskah/suara, `16:9` atau `9:16` |
| `styleId` | gaya visual (`src/shared/styles.ts`, 20 gaya) |
| `ttsProvider`, `ttsVoice` | `gemini` atau `elevenlabs` + ID suara |
| `imageModel`, `videoModel`, `videoResolution` | model Higgsfield per proyek (null = bawaan aplikasi) |
| `status`, `step` | `draft`/`script`/`storyboard`/`editing`/`exported`; langkah 1 Ide, 2 Naskah, 3 Storyboard, 4 Editor |
| `coverAssetId` | gambar sampul kartu proyek |
| `editor` | `EditorSettings` (JSON), lihat di bawah |

## Klip (`Clip`)

Satu klip = satu adegan: gambar atau video, suara narasinya, dan geraknya.

| Properti | Arti |
|---|---|
| `sort` | urutan di timeline (klip selalu bersambung tanpa celah) |
| `title`, `story`, `narration` | judul adegan, alur cerita (langkah Naskah), teks narasi (VO, boleh berisi tag `<short pause>` dll.) |
| `visualPrompt` | prompt gambar berlabel: `Setting:`, `Action:`, `Wardrobe:`, `Framing:`, `Avoid:` |
| `visualSource` | teks naskah saat rencana visual dibuat; kalau berbeda dari naskah sekarang, adegan perlu visual baru (`needsVisual`) |
| `characterIds` | pemeran yang tampil |
| `durationMs` | panjang klip di timeline (diatur ulang ke panjang suara setiap narasi direkam) |
| `motionType` | `camera` (gerak kamera di atas gambar) atau `video` (video AI) |
| `cameraPreset`, `motionStrength` | gerak kamera untuk gambar: zoomin/zoomout/panleft/panright/kenburns/shake/static; halus/sedang/kuat |
| `videoPrompt` | arahan gerak untuk video AI |
| `videoCamera`, `videoStrength` | gerak kamera tambahan di atas video AI (`static` = tanpa gerak) |
| `transition`, `transitionMs` | transisi ke klip berikutnya (`fade`/`slideleft`/`zoomin`/`cut`) dan durasinya (null = 0,4 dtk) |
| `voiceGainDb` | volume suara klip ini (dB) |
| `mediaInMs` | titik mulai video di dalam filenya (tepi kiri klip video yang ditarik) |
| `voiceInMs`, `voiceOutMs`, `voiceStartMs` | potongan suara: bagian file yang dipakai (`out` null = sampai akhir) dan posisinya dari awal klip |
| `imageAssetId`, `videoAssetId`, `audioAssetId` | aset aktif (dimiliki proses utama, tidak ikut snapshot) |

Aturan potongan suara ada di `voiceSpan()` (`src/shared/timeline.ts`): suara yang melewati akhir klip dipotong.

### Menambah kolom klip

Tambahkan di semua tempat berikut, atau data akan hilang diam-diam:

1. `Clip` di `src/shared/types.ts`
2. Migrasi baru di `src/main/db/index.ts`
3. `toClip()` di `repo.ts` (beri nilai bawaan untuk baris lama, misalnya `r.kolom ?? 0`)
4. Upsert di `saveSnapshot()` (kolom INSERT, VALUES, `ON CONFLICT ... SET`, dan nilai bawaan saat `run`)
5. `duplicateProject()` dan `insertClipAfter()` di `repo.ts`
6. `CLIP_COLS` di `repo.ts` kalau proses utama perlu mengubahnya lewat `patchClip`
7. Nilai bawaan di `addClip` (`renderer/src/store/project.ts`)
8. `StoryClip` di `repo.ts` (daftar `Omit`) kalau kolom tidak berasal dari naskah AI

## Aset (`Asset`)

| Properti | Arti |
|---|---|
| `kind` | `image`, `video`, `audio`, `music`, `overlay`, `export` |
| `clipId` / `characterId` | pemiliknya (riwayat versi per klip/pemeran) |
| `provider`, `model`, `prompt` | asal file; untuk audio narasi `prompt` = teks narasi saat direkam |
| `remoteId`, `remoteUrl` | ID permintaan dan URL hasil di Higgsfield |
| `localPath` | path relatif di folder proyek; `url` = `studio://asset/...` |
| `durationMs`, `width`, `height` | hasil probe FFmpeg |
| `meta` | JSON bebas, lihat di bawah |

`meta` untuk audio narasi:

| Kunci | Arti |
|---|---|
| `words` | `WordTiming[]` (teks + detik mulai/selesai, relatif ke file) untuk caption |
| `estimatedTimings` | `true` kalau waktu kata masih perkiraan (belum disinkronkan) |
| `timedBy` | `whisper-dtw` kalau waktu kata dari Whisper metode terbaru |
| `voice`, `take` | ID suara dan ID rekaman utuh tempat potongan ini berasal |
| `editedWords` | `true` kalau teks caption diedit manual |

`meta.uploadedUrl`/`uploadedAt` dipakai untuk menggunakan ulang file yang sudah diunggah ke Higgsfield.

Narasi dianggap **basi** (perlu direkam ulang) kalau `asset.prompt` berbeda dari `clip.narration`.

## Pengaturan editor (`EditorSettings`, di `projects.editor_json`)

| Properti | Arti |
|---|---|
| `captionStyle`, `captionPosition`, `captionSize`, `captionScale` | gaya, posisi, dan ukuran caption |
| `captionFont`, `captionColor`, `captionHighlight`, `captionBg` | penyesuaian di atas gaya (font, warna, sorotan, latar) |
| `musicAssetId`, `musicVolumeDb`, `duckMusic` | musik latar, volume, dan turun otomatis saat narasi |
| `musicStartMs`, `musicEndMs`, `musicInMs` | posisi musik di timeline dan titik mulainya di dalam lagu |
| `voiceVolumeDb` | volume semua narasi |
| `overlays` | logo/gambar dan teks di atas video (`Overlay[]`) |
| `musicPrompt` | prompt musik AI terakhir (untuk Suno dll.) |

Properti opsional baru di `EditorSettings` tidak butuh migrasi; berikan nilai bawaan saat dibaca (`?? 0`).

## Pengaturan aplikasi (`AppSettings`, tabel `settings`)

`defaultTtsProvider`, `defaultLanguage`, `exportFolder`, `llmProvider`, `llmModels` (model per penyedia LLM),
`customBaseUrl`, `geminiTtsModel`, `elevenModel`, `imageModel`, `videoModel` (bawaan untuk proyek baru),
`whisperAuto` (sinkron caption otomatis setelah narasi Gemini).

Kunci baru harus ada di `DEFAULT_SETTINGS` (`src/main/settings.ts`); kunci yang tidak dikenal diabaikan saat
disimpan.
