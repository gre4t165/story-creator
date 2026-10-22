# Konvensi

## Bahasa

- **Teks yang dilihat pengguna: Bahasa Indonesia** yang santai dan jelas, menyapa dengan "kamu". Pesan error
  menjelaskan apa yang terjadi dan apa yang bisa dilakukan, misalnya: "Kredit Higgsfield tidak cukup. Isi ulang
  di dashboard Higgsfield."
- **Kode, nama, dan komentar: bahasa Inggris.** Komentar menjelaskan *kenapa* (alasan, jebakan, batasan), bukan
  mengulang apa yang sudah jelas dari kode.
- Angka desimal di UI memakai koma ("3,5 dtk"); satuan pendek: `dtk`, `dB`, `px`.
- Prompt untuk model AI ditulis dalam bahasa Inggris (lebih akurat), kecuali bagian yang memang untuk pengguna.

## TypeScript

- `strict`, `noUnusedLocals`, `noUnusedParameters`. Kode harus lolos `npm run typecheck` tanpa error.
- Tipe data bersama di `src/shared/types.ts`; tipe IPC di `src/shared/api.ts`.
- Fungsi murni yang dipakai main dan renderer ditaruh di `src/shared/` (tanpa impor Electron atau DOM).
- Ikuti gaya file di sekitarnya: kepadatan komentar, penamaan, pola yang sama.
- Belum ada konfigurasi Prettier/ESLint. Gaya yang dipakai: indentasi 2 spasi, tanpa titik koma, kutip tunggal.
  Komentar dibungkus sekitar 110 karakter; baris kode boleh lebih panjang kalau masih mudah dibaca.

## Tampilan (renderer)

### Design token (`src/renderer/src/styles.css`, Tailwind v4 `@theme`)

| Token | Warna | Dipakai untuk |
|---|---|---|
| `paper` / `surface` / `sand` | `#faf7f2` / `#ffffff` / `#f3efe8` | latar halaman / kartu / isian |
| `ink`, `ink-2`, `muted` | `#1f1d1a`, `#57524a`, `#6b665e` | teks utama, sekunder, redup |
| `line`, `line-2`, `line-3` | krem keabuan | garis dan border |
| `accent` (+ `-dark`, `-soft`) | `#c93a1b` | tombol utama, **tanda terpilih** |
| `sun` (+ `-soft`, `-ink`) | `#ffc93c` | sorotan, pilihan aktif di daftar |
| `ok-*`, `info-*`, `bad-*` | hijau, biru, merah | status |

Font UI: Plus Jakarta Sans (teks), Bricolage Grotesque (judul, `font-display`), JetBrains Mono (angka/waktu).
Bayangan "tinta" (`shadow-ink`) memberi kesan kertas dan tinta. Font caption ada terpisah di `captions.ts`.

### Komponen yang dipakai ulang

| Komponen | File | Catatan |
|---|---|---|
| `Button`, `IconButton`, `Chip`, `Segmented`, `Badge`, `Switch`, `Field`, `inputCls`, `Progress`, `Spinner`, `Kbd`, `Modal`, `Menu`, `confirmDialog` | `components/ui.tsx` | dasar semua halaman; `confirmDialog` mengembalikan `Promise<boolean>` |
| `Select` | `components/Select.tsx` | dropdown bergaya, dengan pencarian, grup, ikon, dan aksi per baris |
| `Popover` | `components/Popover.tsx` | panel mengambang di portal; menghentikan event agar tidak bocor ke elemen di belakangnya |
| `ModelPicker`, `ModelLogo`, `ProviderLogo` | `components/` | pemilih model AI dengan ikon dan biaya |
| `AutoTextarea` | `components/AutoTextarea.tsx` | textarea yang tumbuh mengikuti isi dan tetap bisa diubah ukurannya |
| `StyleMenu`, `StylePicker` | `components/` | pemilih gaya visual berupa grid thumbnail 1:1 |

### Aturan UI (hasil masukan pemilik aplikasi)

1. **Jangan pakai `<select>` bawaan.** Pakai `Select`/`Popover` supaya tampilannya seragam.
2. **Pilihan visual** (gaya gambar dll.) dipilih dari **grid thumbnail persegi 1:1**, bukan daftar teks. Contoh
   gambarnya berfokus pada karakter, menghadap kamera, dengan subjek berbeda tiap pilihan.
3. **Satu dropdown penyedia per bagian** (misalnya LLM atau TTS): hanya formulir penyedia terpilih yang
   ditampilkan. Kunci Higgsfield cukup satu kolom (format `KEY_ID:KEY_SECRET` dari tombol "Copy API key").
4. **Pilihan yang tidak bisa dipakai dinonaktifkan**, misalnya penyedia TTS tanpa kunci valid.
5. **Kurangi klik manual.** AI mengisi pengaturan per klip (gerak kamera, kekuatan, transisi, arahan video), dan
   pratinjau berjalan otomatis.
6. **Pilihan terpilih ditandai warna latar** (`bg-sun-soft`), bukan kolom centang. Baris model diberi ikon
   keluarganya.
7. **Pengaturan ada di tempat itemnya.** Contohnya transisi: tombol bulat di sambungan antar klip yang membuka
   panel Transisi, bukan isian di panel klip yang terkesan berlaku untuk semua.
8. **Timeline seperti CapCut.** Setiap item (klip, potongan caption, suara, musik, overlay, sambungan) bisa diklik
   dan membuka panelnya sendiri. Hanya item yang sedang diedit yang ditandai, dengan satu gaya cincin untuk semua
   (`SELECTED` di `Timeline.tsx`). Item yang tidak dipilih tidak boleh memakai warna accent.
9. **Pratinjau tanpa menggeser playhead** untuk pengaturan yang perlu dilihat (gerak kamera, transisi): pakai
   `useAudition`.
10. **Perubahan tersimpan otomatis** bila memungkinkan (misalnya edit teks caption), tanpa tombol "Simpan" terpisah.
11. Tata letak harus tetap rapi di jendela minimal 1180×720 dan tidak boleh melebar keluar layar. Grid berisi
    konten panjang perlu `min-w-0` atau `minmax(0,1fr)`.

## Keamanan dan privasi

- Kunci API hanya lewat `secrets.ts`; jangan pernah mencetak atau mengirimnya ke tempat lain.
- Tautan keluar hanya lewat `window.api.app.openExternal` (https saja).
- Jangan melonggarkan CSP kecuali perlu, dan sebutkan domain secara spesifik (seperti `frame-src https://www.youtube.com`).
- Saat menguji dengan data asli pengguna, pakai salinan dengan tabel `secrets` dikosongkan.
