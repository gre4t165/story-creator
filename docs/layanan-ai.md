# Layanan AI dan kunci API

Semua panggilan ke layanan luar dilakukan di **proses utama** (`src/main/services/`). Renderer tidak pernah
memegang kunci API.

## Kunci API (BYOK)

Pengguna memasukkan kuncinya sendiri di **Pengaturan › Layanan AI dan kunci**.

- Disimpan di tabel `secrets` setelah dienkripsi dengan Electron `safeStorage`. Di Windows ini memakai DPAPI,
  terikat ke akun Windows pengguna, jadi salinan `studio.db` di komputer lain tidak bisa membuka kuncinya.
- Kunci kriptonya dibuat saat startup (`warmUpEncryption`) supaya tidak hilang kalau aplikasi ditutup paksa tepat
  setelah menyimpan kunci pertama.
- `requireSecret(provider)` melempar error berbahasa Indonesia kalau kunci belum ada.
- `revealSecret` hanya dipanggil tombol "tampilkan kunci" di Pengaturan.
- **Jangan pernah** menulis kunci ke log, pesan error, file, URL, atau mengirimnya ke layanan lain.
- Mengganti kunci Higgsfield menghapus cache estimasi kredit (`forgetEstimates`).

| Penyedia (`ApiProvider`) | Dipakai untuk |
|---|---|
| `higgsfield` | gambar, lembar karakter, video |
| `gemini` | LLM (naskah/visual), Gemini TTS, dan gambar Nano Banana |
| `elevenlabs` | TTS |
| `cloudflare` | gambar gratis (Workers AI). Kunci: `ACCOUNT_ID:API_TOKEN` |
| `pollinations` | gambar gratis (eksperimental) |
| `openrouter`, `groq`, `custom` | LLM lewat API kompatibel OpenAI |

## LLM (`services/llm.ts`, `services/gemini.ts`)

- `generateJson({ system, prompt, schema, name })` memanggil penyedia aktif (`settings.llmProvider` +
  `llmModels[provider]`).
  - Gemini: `@google/genai` dengan `responseJsonSchema` (dan cadangan: skema ditulis di system instruction).
  - Lainnya: `/chat/completions`, dicoba berurutan `json_schema` (strict) → `json_object` → teks biasa, lalu JSON
    diambil dari teks (`extractJson`) untuk model yang tidak mendukung structured output.
- `listModels(source)`: daftar model live dari penyedia, dicache di tabel `cache` dan disegarkan saat basi.
- **Menambah penyedia LLM baru** yang kompatibel OpenAI: tambahkan ke `LlmProvider` dan `ApiProvider`
  (`types.ts`), `LLM_PROVIDERS` (`shared/models.ts`), konfigurasi base URL di `llm.ts`, dan `DEFAULT_SETTINGS.llmModels`.

## TTS

| Penyedia | File | Catatan |
|---|---|---|
| Gemini TTS | `services/gemini.ts` | PCM 24 kHz → WAV; daftar suara dari Voice Library (`listVoices`, cache 24 jam) dengan cadangan statis di `shared/models.ts`; contoh suara bawaan di `renderer/src/assets/voices` |
| ElevenLabs | `services/elevenlabs.ts` | memakai endpoint with-timestamps untuk waktu per kata; tag `<...>` diubah ke `[tag]` untuk model v3, atau ke `<break>` untuk model lama (`toElevenLabsText`) |

| Edge TTS | `services/edgetts.ts` | Gratis, tanpa kunci, lewat paket `msedge-tts` (layanan baca-nyaring Edge, **tidak resmi**). Memberi waktu tiap kata. Tag jeda diubah jadi tanda baca (`<short pause>` → koma, `<long pause>` → titik) karena SSML tidak dihormati. Daftar suara di-cache 24 jam, cadangan statis di `shared/models.ts`. |
| Voicebox / voice studio lokal | `services/localtts.ts` | Server suara di komputer pengguna, alamat di `localTtsUrl` (bawaan `http://127.0.0.1:17493`). Voicebox: `GET /profiles` untuk daftar suara, `POST /generate` lalu `GET /history/{id}` sampai `completed`, lalu `GET /audio/{id}` (WAV). Tanpa `/profiles` dipakai format OpenAI `POST /v1/audio/speech`. Tidak memberi waktu kata: caption diperkirakan lalu dirapikan Whisper. |

Narasi selalu dibuat satu rekaman utuh lalu dipotong, kecuali suara lokal: tiap adegan disuarakan sendiri karena tidak ada waktu kata untuk memotong. Lihat [alur-produksi.md](alur-produksi.md#4-narasi-srcmainnarrationts).

## Gambar langsung: gratis dan Nano Banana (`services/cloudflare.ts`, `services/pollinations.ts`, `shared/freemodels.ts`)

Id model gratis disimpan di `Project.imageModel` berawalan penyedia (`cloudflare/flux-1-schnell`,
`cloudflare/sdxl-lightning`, `pollinations/default`), jadi tidak bertabrakan dengan id endpoint Higgsfield.
`resolveImageModelId` mengenali keduanya. Dijalankan di antrean `freeimage`.

- **Cloudflare Workers AI**: jatah gratis 10.000 neuron per hari (reset 00:00 UTC = 07:00 WIB), sekitar 170 gambar
  FLUX.1 schnell. FLUX schnell selalu menghasilkan gambar persegi (editor memotongnya ke 16:9 atau 9:16);
  SDXL Lightning menerima lebar dan tinggi. Kunci disimpan sebagai `ACCOUNT_ID:API_TOKEN`; token dibuat dari
  template "Workers AI".
- **Gemini (Nano Banana)**: `gemini/gemini-nano-banana-2.1` (bawaan), `gemini/gemini-3-pro-image`,
  `gemini/gemini-2.5-flash-image`, memakai kunci Gemini lewat Interactions API (`ai.interactions.create` dengan
  `response_format: { type: 'image', aspect_ratio, image_size }`). **Tidak ada tier gratis** untuk gambar di Gemini API,
  jadi proyek kuncinya butuh billing aktif; tanpa billing, error kuota `limit: 0` diterjemahkan jadi pesan yang jelas
  dan tidak diulang. Lembar karakter dikirim sebagai bagian gambar (base64) setelah prompt, maksimal `refs` per model.
- **Pollinations**: endpoint `POST https://gen.pollinations.ai/v1/images/generations` dengan kunci gratis (`sk_`/`pk_`).
  Ditulis dari dokumentasi publik dan belum diuji ke layanan asli, jadi ditandai eksperimental.
- Cloudflare dan Pollinations tidak menerima gambar referensi, jadi lembar karakter tidak dibuat otomatis dan konsistensi
  tokoh bergantung pada deskripsi di prompt.
- Tidak ada video AI gratis. Gerak kamera di atas gambar diam tetap gratis di editor.

## Higgsfield (`services/higgsfield.ts`, `shared/higgsfield.ts`)

- Base URL `https://api.higgsfield.ai`, header `Authorization: Key <kunci>`.
- Alur: `submit(endpoint, body)` → polling `getStatus` → unduh hasil. `uploadFile` mengunggah gambar referensi
  (lembar karakter, gambar klip untuk video).
- `estimate(endpoint, body)` memanggil `/estimate/<endpoint>` → `{ credits, usd }`, dicache 24 jam di tabel `cache`.
- Pesan error dibuat ramah (`friendly`): kunci salah, kredit habis, terlalu banyak proses, model tidak tersedia.
- Untuk pengembangan, `STUDIO_HF_BASE` bisa diarahkan ke server tiruan (mock) supaya UI bisa diuji tanpa kredit.

### Katalog model (`src/shared/higgsfield-catalog.json`)

48 model (gambar dan video). Satu entri:

```json
{
  "id": "kling-video/v3.0/std/image-to-video",
  "name": "Kling 3.0 · Standard · Image to video",
  "family": "Kling",
  "kind": "video",
  "input": { "field": "image_url", "mode": "first-frame", "max": 1 },
  "required": ["image_url"],
  "props": { "prompt": { "type": "string" }, "duration": { "type": "integer", "minimum": 3, "maximum": 15 }, "sound": { "enum": ["on", "off"] } },
  "durations": { "min": 3, "max": 15 },
  "tags": ["Kling"]
}
```

- `input.field`/`mode`/`max`: tempat gambar referensi atau frame pertama dikirim, dan berapa banyak.
- `props`: skema parameter dari dokumentasi Higgsfield. `imageBody`/`videoBody` di `shared/higgsfield.ts`
  mengisinya secara umum: rasio, resolusi, kualitas, durasi, mematikan `enhance_prompt`, `prompt_extend`, dan audio.
- `durations`: rentang (`min`/`max`) atau daftar (`values`) durasi video.
- **Menambah model**: tambahkan entri baru dengan format yang sama dari dokumentasi API Higgsfield
  (`https://docs.higgsfield.ai/docs/llms.txt`), lalu pastikan `imageBody`/`videoBody` tidak melempar error
  "butuh <field>" (`checkRequired`). Ikon keluarga model diatur di `components/ModelLogo.tsx`.
- Model bawaan: `DEFAULT_IMAGE_MODEL` dan `DEFAULT_VIDEO_MODEL` di `shared/higgsfield.ts`.

## Whisper lokal (`src/main/whisper.ts`)

- Biner: `resources/whisper/whisper-cli.exe` + DLL (whisper.cpp, lisensi MIT). Saat ini hanya untuk Windows.
- Model: `ggml-small.bin` dari Hugging Face (`ggerganov/whisper.cpp`), diunduh di Pengaturan, bisa dijeda dan
  dilanjutkan (HTTP Range), lalu dicek SHA-256. Untuk pengembangan, `STUDIO_WHISPER_URL` bisa menunjuk salinan lokal.
- Dijalankan di antrean `whisper` (satu per satu). Detail argumennya di [alur-produksi.md](alur-produksi.md#5-caption-akurat-whisper-lokal).

## YouTube (halaman About)

Video tutorial diputar lewat iframe `https://www.youtube.com/embed/<id>`. Sejak 2025 YouTube mewajibkan pemutar
embed mengirim identitas lewat header HTTP Referer (tanpa itu: Error 153). Aplikasi yang memuat halaman dari
`file://` tidak mengirim Referer, jadi `identifyToYouTube()` (`src/main/index.ts`) menambahkan
`Referer: https://id.bangtutorial.bangstory/` (ID aplikasi) hanya untuk permintaan embed. Iframe tanpa
autoplay, supaya putaran dari pengguna terhitung sebagai view.

## Membuka tautan

`app:openExternal` hanya menerima URL `https://` dan membukanya di browser bawaan. Pakai ini untuk semua tautan
ke luar (dokumentasi penyedia, channel YouTube, Suno, dan lainnya).


## Pemeriksaan wajah (aturan konten)

Kalau "Wajah tidak ditampakkan" menyala, `main/censor.ts` mengirim setiap gambar baru (dan sampel frame video AI,
maksimal 3 per detik dan 30 per klip, 16 per permintaan) ke Gemini lewat `generateContent` dengan skema JSON
`box_2d` (skala 0–1000). Modelnya model tulis Gemini yang dipilih di Pengaturan, lalu `gemini-2.5-flash` dan
`gemini-flash-latest` sebagai cadangan. Kotak wajah diperbesar (30% untuk gambar, 45% plus jendela waktu untuk video)
lalu ditutup blur atau mozaik dengan ffmpeg. Hasil yang gagal diperiksa disimpan di `pending/` proyek selama dua hari
dan dipakai ulang oleh job berikutnya untuk klip atau tokoh yang sama.
