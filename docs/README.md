# Dokumentasi pengembang Story Creator

Dokumentasi ini untuk siapa pun yang ingin mengembangkan Story Creator, baik sendiri maupun dibantu AI agent
(Claude Code, Codex, Cursor, Gemini CLI, dan lainnya). Untuk cara *memakai* aplikasi, lihat
[README di root](../README.md).

Mulai dari [AGENTS.md](../AGENTS.md): ringkasan proyek, perintah, peta kode, dan aturan yang tidak boleh dilanggar.

| Dokumen | Isi |
|---|---|
| [arsitektur.md](arsitektur.md) | Proses Electron, IPC, event, antrean job, penyimpanan file dan database, keamanan |
| [data-model.md](data-model.md) | Skema SQLite, migrasi, arti setiap kolom klip dan pengaturan editor, cara menambah kolom |
| [alur-produksi.md](alur-produksi.md) | Ide → naskah → visual → gambar/video → narasi → caption, termasuk prompt AI |
| [editor-dan-ekspor.md](editor-dan-ekspor.md) | Model timeline, pratinjau, transisi, gerak kamera, caption, dan susunan render FFmpeg |
| [layanan-ai.md](layanan-ai.md) | LLM, TTS, Higgsfield, Whisper, kunci API, cara menambah penyedia/model |
| [pengembangan.md](pengembangan.md) | Setup, perintah, dev harness, cara menguji, debugging, build installer, rilis |
| [konvensi.md](konvensi.md) | Gaya kode, bahasa, design token, komponen, aturan UI |
| [keputusan-teknis.md](keputusan-teknis.md) | Kenapa sesuatu dibuat begitu (dan bug apa yang muncul kalau diubah) |
| [masalah-diketahui.md](masalah-diketahui.md) | Masalah yang belum selesai, batasan, dan ide pengembangan |

Riwayat versi ada di [CHANGELOG.md](../CHANGELOG.md).

## Cara memakai dokumen ini dengan AI agent

- Banyak agent otomatis membaca `AGENTS.md` (Claude Code membacanya lewat `CLAUDE.md`).
- Saat meminta perubahan besar, sebutkan dokumen yang relevan, misalnya:
  "Baca docs/editor-dan-ekspor.md dan docs/keputusan-teknis.md, lalu tambahkan transisi baru *wipe*."
- Minta agent menjalankan `npm run typecheck` dan `npm run build` di akhir, dan menguji dengan dev harness untuk
  perubahan tampilan atau ekspor.
- Kalau ada keputusan teknis baru (misalnya mengganti cara render), minta agent mencatatnya di
  `keputusan-teknis.md`, supaya pengembang berikutnya tidak mengulang masalah yang sama.
