# Lisensi: versi gratis dan Pro

Story Creator gratis dengan batas; **Pro** membukanya lewat kode aktivasi yang diterbitkan Mayar setelah pembayaran.
Panduan untuk penjual (akun, pemasangan server) ada di [`license-server/README.md`](../license-server/README.md);
dokumen ini untuk pengembang.

## Yang dibatasi di versi gratis

Didefinisikan sekali di `src/shared/license.ts` (`FREE_LIMITS`, `PRO_FEATURES`):

| Batas | Ditegakkan di |
|---|---|
| Ekspor maksimal 720p, 30 fps | `exporter.ts` (`limitExport`, dipakai `startExport`) |
| Watermark "Dibuat dengan Story Creator" | `exporter.ts` (teks overlay ASS tambahan, tidak bisa dimatikan) |
| Maksimal 3 proyek (buat dan duplikat) | `ipc.ts` (`assertCanAddProject`); proyek yang sudah lebih dari 3 tidak dihapus |
| Impor sekaligus dan JSON (satu file di satu klip tetap gratis) | `importer.ts` (`requirePro('batch-import')`) |
| Video tidur/meditasi/ambience maksimal 10 menit (`FREE_LIMITS.maxRelaxSec`) | `exporter.ts` (`relaxLengthSec(..., isPro())` di `renderRelax`) |
| SFX otomatis, Musik + atur gambar | fitur ini murni di editor, jadi tombolnya memanggil `window.api.license.require(...)` ke main sebelum jalan |

**Aturan:** keputusan Pro/gratis dibuat di **proses main** (`main/license.ts`). Renderer hanya menampilkan kunci dan dialog;
jangan menaruh pengecekan penting hanya di renderer. Fitur Pro baru: tambahkan ke `LicenseFeature`, `PRO_FEATURES`,
`REASON`, panggil `requirePro(...)` di main (atau `ensure(...)` di renderer untuk fitur yang hanya ada di editor),
dan tandai kontrolnya dengan ikon `Lock` saat `useIsPro()` false.

## Cara kerja lisensi

1. Pembeli menempel kode di **Pengaturan › Lisensi**. Main (`activate`) mengirim `{code, device, name}` ke
   `LICENSE_SERVER_URL/activate`.
2. Server (`license-server/src/index.js`) menanyakan kodenya ke Mayar (`POST /saas/v1/license/verify`, API key rahasia
   di server), mencatat komputer di KV (maksimal `MAX_DEVICES`), dan menjawab **token**: `base64url(JSON).base64url(tanda tangan Ed25519)`.
3. Main memeriksa tanda tangan dengan `LICENSE_PUBLIC_KEY` dan memastikan `device` cocok dengan komputer ini, lalu
   menyimpan `{code, token}` di tabel `settings` (kunci `license`).
4. Setelahnya `isPro()` hanya memeriksa token secara **offline**. Token berumur 35 hari (`exp`); aplikasi memperbaruinya
   di latar belakang setelah 30 hari (`startLicenseChecks`, tiap 12 jam bila sudah waktunya). Offline, token lama tetap
   jalan sampai `exp`; kode yang ditolak server (refund) menghapus lisensi.
5. **ID komputer** = SHA-256 dari MachineGuid Windows (`reg query`), dengan cadangan ID acak di `settings` bila gagal.

Isi token: `{ v: 1, plan: 'pro', device, code (4 karakter terakhir), iat, exp }`.

## Konfigurasi dan kapan batas berlaku

`src/shared/license-config.ts` berisi `LICENSE_PUBLIC_KEY`, `LICENSE_SERVER_URL`, dan `BUY_URL`, diisi lewat
`npm run license:keys` dan langkah di panduan penjual. **Selama kunci atau alamat server kosong, aplikasi tidak
membatasi apa pun** (`unrestricted()` di `license.ts`), supaya build yang terlanjur dirilis tanpa konfigurasi tidak
mengunci pengguna. Kunci privat tidak pernah ada di repo (`license-server/private-key.pem` di `.gitignore`).

## Menguji

- `npm run license:test`: 12 pengujian server (aktivasi, batas komputer, nonaktifkan, refund, Mayar mati, tanda tangan
  dipalsukan) dengan KV dan Mayar tiruan.
- Uji ujung ke ujung di aplikasi: jalankan server di Node dengan worker yang sama, lalu jalankan aplikasi mode dev
  dengan `STUDIO_LICENSE_PUBKEY` (SPKI DER base64) dan `STUDIO_LICENSE_SERVER` (hanya dibaca saat aplikasi **tidak**
  dipaketkan). Alurnya sudah dicoba: gratis, kode salah, aktivasi lewat UI, ekspor 1080p tanpa watermark, tetap Pro setelah
  dibuka ulang, dicabut saat server menolak kode, aktifkan ulang, dan nonaktifkan.

## Batas yang diketahui

- Pembatasan ada di aplikasi, jadi bisa dilewati oleh yang membongkar aplikasi. Jaga repo tetap private.
- Alur "kode terkirim otomatis setelah bayar" dan bentuk jawaban verifikasi Mayar belum diuji ke Mayar sungguhan;
  lihat catatan uji sandbox di panduan penjual.
- Kode aktivasi tersimpan apa adanya di database lokal (bukan rahasia seperti kunci API), karena dibutuhkan untuk pembaruan dan penonaktifan.
