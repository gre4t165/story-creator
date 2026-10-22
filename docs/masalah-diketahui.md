# Masalah yang diketahui dan ide pengembangan

## Masalah terbuka

| Masalah | Keterangan | Petunjuk |
|---|---|---|
| Gerak kamera di atas **video** bergetar di **pratinjau** | Hasil ekspor sudah halus; yang bergetar hanya pratinjau editor. Overlay hardware sudah dimatikan dan opasitasnya 0,999, tapi pemilik aplikasi masih melihat getaran (kartu grafis NVIDIA). | Kemungkinan lain: konten video 24 fps vs transform 60 fps, atau compositor. Ide: gambar frame video ke `<canvas>` dan terapkan transform di canvas, atau putar pratinjau dari frame yang sudah diskalakan. |
| Belum ada undo/redo | Hapus overlay, caption, atau suara langsung terjadi (hapus klip ada konfirmasi). | Undo bisa dibuat di store renderer (riwayat snapshot) + IPC untuk aksi di main (split, setWords). |
| Whisper hanya untuk Windows | Biner yang disertakan hanya `whisper-cli.exe`. Di macOS, narasi baru otomatis kembali ke waktu perkiraan (`whisperTimes` menangkap error-nya), tapi tombol sinkron caption akan error. | Tambahkan biner whisper.cpp macOS, pilih sesuai `process.platform` di `cliPath()` (`whisper.ts`), dan sembunyikan fitur ini kalau binernya tidak ada. |
| Installer hanya Windows | `npm run dist` menghasilkan NSIS Windows. | Tambahkan target `mac` di `electron-builder.yml` (perlu sertifikat untuk distribusi). |
| Rekam ulang narasi mereset durasi | Durasi klip dan potongan suara manual kembali mengikuti suara baru. | Disengaja; bisa ditambah opsi "pertahankan durasi". |
| Suara asli video impor tidak dipakai | Video yang diimpor diputar dan diekspor tanpa suaranya sendiri (`-an`), sama seperti video AI. | Tambah pilihan per klip untuk mencampur audio video, di pratinjau (`engine.ts`) dan ekspor. |
| Riwayat versi aset setelah split | Bagian kedua memakai gambar/video milik klip asal; riwayat versinya ada di klip asal. | Salin baris aset untuk klip baru kalau riwayat per bagian diperlukan. |
| Caption sulit digeser utuh | Potongan caption berdempetan, jadi menyeret badannya sering tidak punya ruang. | Tarik tepinya; atau izinkan geser yang ikut mendorong potongan tetangga. |
| Tidak semua model sudah diuji langsung | Katalog Higgsfield berisi 48 model; sebagian besar baru diuji lewat body permintaan, belum lewat generate sungguhan. Penyedia LLM selain Gemini juga belum semuanya diuji. | Uji model yang sering dipakai, lalu catat model yang bermasalah. |
| Layanan gratis belum diuji ke server asli | Cloudflare, Pollinations, dan Edge TTS ditulis dan diuji dengan layanan tiruan; panggilan sungguhan baru teruji saat dipakai pengguna. | Pollinations paling berisiko (eksperimental). Tes koneksi ada di Pengaturan. |
| Edge TTS tidak resmi | Memakai layanan baca-nyaring Edge yang tidak didokumentasikan Microsoft; bisa berubah atau diblokir. | Gemini dan ElevenLabs tetap jadi pilihan yang andal. |
| Model gambar gratis tanpa referensi karakter | Tidak ada lembar karakter, jadi wajah dan baju bisa berbeda antar adegan. FLUX schnell juga selalu persegi lalu dipotong. | Tulis deskripsi tokoh yang rinci, atau pakai Higgsfield untuk konsistensi. |
| Tidak ada video AI gratis | Hanya gerak kamera di atas gambar yang gratis. | Higgsfield untuk video AI. |

## Ide pengembangan

- Undo/redo dan riwayat versi per klip di editor.
- Ekspor langsung ke YouTube (OAuth) dengan judul dan deskripsi dari naskah.
- Template intro/outro dan watermark tersimpan per channel.
- Suara asli video impor sebagai pilihan per klip.
- Dukungan macOS penuh (Whisper, installer).
- Unit test untuk modul `src/shared/` (caption, timeline, motion) dengan Vitest.
