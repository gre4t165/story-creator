# Alur produksi

Satu proyek melewati empat langkah (`Project.step`): **1 Ide → 2 Naskah → 3 Storyboard → 4 Editor**, lalu ekspor.

```
Ide cerita ──LLM──► Naskah (adegan + narasi) ──LLM──► Rencana visual per adegan
                                                     │
            ┌────────────────────────────────────────┼─────────────────────────┐
            ▼                                         ▼                         ▼
   Lembar karakter (Higgsfield)          Gambar klip (Higgsfield)       Narasi satu rekaman (TTS)
            └────────── referensi ──────────────────►│                         │
                                                     ▼                         ▼
                                          Video AI (opsional)        Potong per adegan + Whisper
                                                     └──────────► Editor ◄─────┘
                                                                     │
                                                                  FFmpeg → MP4
```

## 1. Ide → naskah (`generateScript`, `src/main/story.ts`)

- Masukan: sinopsis, target durasi, bahasa.
- Jumlah adegan: `clipCountFor(durasi)` = sekitar satu adegan per 5,5 detik (minimal 3).
- Skema JSON keluaran: `{ title, scenes: [{ title, story, narration }] }`.
- Narasi 10–18 kata per adegan dan boleh memakai satu dua tag ekspresi berbahasa Inggris (`<short pause>`,
  `<long pause>`, `<chuckles>`, `<sigh>`, `<gasp>`, `<whispers>`). Daftar tag: `VOICE_TAGS` di `shared/speech.ts`.
- Hasil disimpan dengan `replaceScript`. Durasi awal tiap klip diperkirakan dari jumlah kata
  (`estimateNarrationMs`: sekitar 2,6 kata per detik).

Di langkah **Naskah** pengguna boleh mengubah, menambah, menghapus, dan mengurutkan adegan.

## 2. Naskah → rencana visual (`generateVisuals`)

Skema JSON keluaran:

```
world                         satu kalimat dunia cerita (tempat, era, teknologi, siapa orangnya)
characters[]                  { name, identity (tubuh/wajah, tanpa baju), outfit (baju bawaan) }
scenes[]                      { scene, setting, action, wardrobe[{name, source: reference|custom, outfit}],
                                framing, avoid, characters[], camera, strength, motion, transition }
```

Aturan penting di system prompt (dibuat setelah gambar keluar tidak sesuai cerita):

1. Setiap adegan berdiri sendiri: dunia/planet/era selalu disebut, karena model gambar tidak membaca naskah.
2. Narasi yang umum diubah jadi momen konkret yang bisa digambar.
3. Orang disebut "human"; kata yang bisa dibaca sebagai makhluk fantasi ("Martian", "alien", "-born") dilarang.
4. Baju harus cocok dengan tempatnya; "custom" untuk baju khusus adegan, "reference" untuk baju bawaan pemeran.

`visualText()` menyusun prompt berlabel yang disimpan di `clip.visualPrompt` dan bisa diedit pengguna:

```
Setting: ...
Action: ...
Wardrobe: Leo - custom for this scene: light-blue scrubs; the teenager - custom for this scene: grey tunic
Framing: ...
Avoid: Earth landscape, aliens, spacesuits indoors
```

Mode `missing` hanya menyusun adegan yang naskahnya berubah sejak rencana terakhir (`needsVisual`); mode `all`
menyusun ulang semuanya. Pemeran lama tidak ditimpa; pemeran baru ditambahkan berdasarkan nama.

## 3. Gambar, lembar karakter, video (`src/main/generation.ts`)

- **Lembar karakter** (`sheetPrompt`): gaya + deskripsi pemeran, tampak depan/tiga perempat/samping, latar polos.
  Dibuat lebih dulu kalau model gambar menerima referensi (`maxRefs(model) > 0`).
- **Gambar klip** (`clipPrompt`): adegan dulu, lalu pemeran (tubuh dari lembar karakter, baju mengikuti baris
  `Wardrobe`), lalu gaya visual, lalu baris `Avoid` sebagai "Must not appear", lalu format frame. Lembar karakter
  dikirim sebagai gambar referensi.
- **Video AI** (`generateClipVideo`): gambar klip + `videoPrompt` (atau prompt cadangan). Setiap prompt video
  diakhiri `NO_MUSIC` ("Silent clip: no background music...") dan audio dimatikan lewat parameter kalau
  modelnya punya (`sound: off`, `generate_audio: false`). Durasi video = durasi terpendek model yang menutup
  panjang klip (`fitDuration`), resolusi dari `project.videoResolution`.
- Hasil diunduh ke folder proyek, dicatat di `assets`, lalu klip diperbarui lewat `patchClip` + `emit.clip`.

Detail API dan katalog model: [layanan-ai.md](layanan-ai.md).

## 4. Narasi (`src/main/narration.ts`)

Suara dibuat **dalam satu rekaman utuh** untuk banyak adegan sekaligus, lalu dipotong per adegan, supaya suara
dan intonasinya konsisten. (Rekaman per klip menghasilkan suara yang sedikit berbeda tiap klip.)

- **Gemini TTS**: adegan digabung dengan `<long pause>` di antaranya, per bagian maksimal sekitar 240 detik
  (`GEMINI_PART_SEC`).
- **ElevenLabs**: per bagian maksimal 2.400 karakter (`ELEVEN_PART_CHARS`), dengan `previous_text`/`next_text`
  agar intonasi bersambung. Waktu per kata datang dari API (alignment).
- **Titik potong antar-adegan**:
  - dengan Whisper: `cutsFromWords` (`cuts.ts`) memotong di jeda yang tumpang-tindih dengan celah antara kata
    terakhir satu adegan dan kata pertama adegan berikutnya, tidak pernah di tengah kata;
  - tanpa Whisper: `chooseCuts`, pemrograman dinamis atas jeda dari `silencedetect` FFmpeg dan perkiraan posisi
    dari panjang teks.
- Setiap potongan disimpan sebagai WAV dengan `meta.words`, dan durasi klip diatur ke panjang potongannya.
  Potongan suara (`voiceInMs` dll.) direset.

## 5. Caption akurat (Whisper lokal)

- `src/main/whisper.ts` menjalankan `whisper-cli.exe` dengan model **Whisper Small** (487.601.967 byte, dicek
  SHA-256, diunduh ke `models/whisper`).
- Argumen: `-ml 1 -sow` (satu kata per segmen), `-ojf` (JSON lengkap), `-nfa -dtw small` (waktu kata dari
  DTW). **Tanpa `--prompt`**: prompt berisi naskah membuat Whisper berhalusinasi mengulang kata.
- `align.ts` mencocokkan kata **naskah** ke kata yang didengar Whisper (edit distance). Ejaan caption tetap dari
  naskah; hanya waktunya dari Whisper.
- Berjalan otomatis setelah narasi Gemini (`whisperAuto`), atau manual lewat tab Caption
  (`syncCaptions`, mode `stale`/`all`). Hasil ditandai `meta.timedBy = 'whisper-dtw'`.

## Impor gambar dan suara sendiri (`src/main/importer.ts`)

Menu **Impor** di Storyboard dan tombol per klip (Pakai gambar sendiri, Impor suara):

- **Satu file** untuk klip yang dipilih (`imports:clipFile`).
- **Banyak file** (`imports:batch`): kalau semua nama file punya nomor berbeda (`03.png`, `adegan-12.wav`), tiap file
  masuk ke adegan bernomor itu; kalau tidak, diisi urut nama file dari adegan 1. Adegan yang belum ada dibuat (`appendClip`).
- **JSON** (`imports:json`), daftar adegan atau `{ "scenes": [...] }` dengan bawaan `voice`, `provider`, `generate`:

```json
{
  "provider": "voicebox",
  "voice": "Aksen Indonesia Baku (Pria)",
  "scenes": [
    { "scene": 1, "title": "Pembuka", "narasi": "Teks narasi adegan satu.", "image": "gambar/01.png" },
    { "scene": 2, "narasi": "Adegan dua pakai suara lain.", "voice": "id-ID-GadisNeural", "provider": "edge" },
    { "scene": 3, "audio": "suara/03.wav", "image": "https://contoh.com/03.jpg" },
    { "scene": 4, "prompt": "A quiet village at dawn", "generate": true }
  ]
}
```

Video (MP4, MOV, WebM) diterima di mana pun gambar diterima, termasuk kunci `video` di JSON: video jadi
`videoAssetId` klip (`motionType: 'video'`) dan frame pertamanya jadi gambar klip. Klip tanpa suara mengikuti
panjang video; suara asli video tidak ikut (ekspor memakai `-an`, sama seperti video AI).

Path relatif dihitung dari folder file JSON; boleh juga path absolut atau link http(s). JSON suara menyuarakan adegan
yang punya narasi tanpa file audio (kecuali `"generate": false`), dengan `voice`/`provider` per adegan
(`generateClipTts` dengan override). JSON gambar hanya menggambar adegan tanpa file gambar kalau `"generate": true`,
karena bisa memakai kredit. Gambar impor milik pengguna dan disimpan apa adanya (tanpa sensor wajah). Suara impor
memakai waktu kata perkiraan, lalu disinkronkan Whisper kalau modelnya ada.

## Gerak acak dan musik yang mengatur gambar

- **Acak gerak** (`randomMotions` di `shared/motion.ts`): zoom in/out, geser kiri/kanan, Ken Burns; tetangga tidak
  pernah sama, kekuatan condong halus.
- **Musik + atur gambar** (`renderer/src/lib/useMusicFit.ts`): `assets:musicBeats` mencari ketukan kasar (lonjakan
  kekerasan suara, `main/beats.ts`, disimpan di `meta.beats`), lalu `fitClipsToMusic` di `shared/timeline.ts`
  membagi panjang lagu ke klip berurutan. Klip bersuara minimal sepanjang suaranya + 0,3 dtk; sisanya dibagi rata,
  lalu tiap potongan digeser ke ketukan terdekat. Total klip = panjang lagu, jadi pratinjau dan ekspor sama.

## SFX otomatis (`src/shared/sfx.ts`)

- Pustaka bawaan di `resources/sfx` (dibundel lewat `extraResources`, disajikan sebagai `studio://sfx/...`):
  paket Kenney.nl `impact`, `rpg`, `interface`, `scifi` dan `generated` (dibuat dengan FFmpeg). Semuanya CC0;
  lisensinya di `resources/licenses`. `sfx-catalog.json` berisi grup variasi dan durasi tiap file; label,
  kategori, peran (`transition`/`spot`/`ambience`), loop, dan kata kunci ada di `META` di `sfx.ts`.
- `autoSfx`: whoosh di setiap transisi (swoosh untuk transisi pendek), sampai dua suasana per adegan (adegan
  bersebelahan dengan suasana sama digabung), dan sampai dua efek saat kata kuncinya muncul (waktunya diperkirakan
  dari posisi kata di narasi). Pemutaran: `sfxPlay` dipakai pratinjau (`engine.ts`) dan ekspor (`exporter.ts`).
- Item disimpan di `editor.sfx` (tanpa migrasi). `auto: true` diganti saat SFX otomatis dibuat ulang; item
  tambahan manual tetap. Menambah suara: taruh file `.ogg` (CC0) di `resources/sfx/<paket>/`, jalankan `node scripts/sfx-catalog.cjs`,
  lalu beri label dan kata kunci di `META`.

## 6. Prompt musik (`generateMusicPrompt`)

LLM membuat `{ title, style, exclude, description, reason }` untuk dipakai di Suno, Udio, atau ElevenLabs Music.
Hasilnya disimpan di `editor.musicPrompt`. File musik hasil AI itu lalu dipilih lewat tab Musik.

## Menambah atau mengubah prompt

- Prompt LLM ada di `story.ts`; prompt gambar dan video di `generation.ts`.
- Skema JSON harus memenuhi mode strict OpenAI (semua properti `required`, `additionalProperties: false`) dan
  tetap bisa dipakai Gemini.
- Uji dengan beberapa ide nyata. Kalau model gambar salah tafsir, perbaiki aturan di system prompt (umum),
  jangan menambal satu kasus.
