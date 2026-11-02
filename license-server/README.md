# Server lisensi Story Creator

Server kecil (Cloudflare Worker, gratis untuk skala ini) yang memeriksa kode aktivasi ke Mayar dan menjawab dengan
lisensi bertanda tangan untuk satu komputer. Aplikasi tidak pernah memegang API key Mayar.

```
Pembeli bayar di Mayar ──► Mayar membuat kode aktivasi ──► pembeli menempel kode di aplikasi
                                                                    │
aplikasi ◄── token bertanda tangan (35 hari) ◄── server ini ◄───────┘  (server menanyakan kodenya ke Mayar)
```

Setelah aktivasi, aplikasi memeriksa tanda tangan token **tanpa internet**. Token diperbarui diam-diam tiap 30 hari.
Kalau kode dinonaktifkan di Mayar (misalnya refund), lisensi berhenti paling lambat 30 hari kemudian.

## Yang perlu kamu siapkan (saya tidak bisa membuatkan akun)

| Apa | Untuk apa |
|---|---|
| Akun [Mayar.id](https://mayar.id) | Menjual Pro dan menerbitkan kode aktivasi |
| Akun [Cloudflare](https://dash.cloudflare.com) (gratis) | Menjalankan server ini |

## Langkah pemasangan

Semua perintah dijalankan di folder proyek, kecuali yang ditulis `cd license-server`.

### 1. Produk di Mayar

1. Di dashboard Mayar: **Product → Software License → Create**.
2. Isi nama (misalnya "Story Creator Pro"), harga rupiah, dan deskripsi. Usul awal: **Rp149.000 sekali bayar**.
3. **Activation Code Limit:** pilih *Unlimited*. Batas jumlah komputer (2) dipegang server ini, jadi Mayar tidak perlu ikut menghitung.
4. Masa berlaku: *Unlimited* (lisensi seumur hidup untuk versi 1.x dan seterusnya, atau atur sendiri).
5. Catat **Product ID** produknya, dan buat **API key** di menu pengaturan/integrasi akun Mayar.
6. Salin tautan halaman produknya: itu nilai `BUY_URL`.

> **Uji dulu di sandbox Mayar** (`https://api.mayar.club`) sebelum memakai akun sungguhan. Yang **belum terkonfirmasi**
> dari dokumentasi publik Mayar: apakah kode lisensi terkirim otomatis begitu pembayaran sukses (dokumentasi hanya
> menyebut halaman terima kasih dan email berisi tautan akses), dan bentuk persis jawaban verifikasinya. Server ini
> membaca `isLicenseActive` sesuai dokumentasi. Lakukan satu pembelian uji dan pastikan kodenya sampai ke pembeli
> dan bisa diaktifkan.

### 2. Cloudflare

```bash
cd license-server
npx wrangler login
npx wrangler kv namespace create DEVICES
```

Tempel `id` yang muncul ke `wrangler.toml` (menggantikan `GANTI_DENGAN_ID_KV`). Batas komputer per kode ada di
`MAX_DEVICES` (bawaan 2).

### 3. Kunci tanda tangan

Dari folder proyek utama:

```bash
npm run license:keys
```

Ini membuat kunci publik (masuk ke `src/shared/license-config.ts`, ikut di aplikasi) dan kunci privat
(`license-server/private-key.pem`, **jangan pernah di-commit atau dibagikan**; sudah ada di `.gitignore`).
Menjalankannya lagi menolak menimpa, karena kunci baru membuat semua lisensi yang sudah terjual tidak berlaku.

### 4. Rahasia di server

```bash
cd license-server
npx wrangler secret put LICENSE_PRIVATE_KEY < private-key.pem
npx wrangler secret put MAYAR_API_KEY        # tempel API key Mayar
npx wrangler secret put MAYAR_PRODUCT_ID     # tempel Product ID
```

Untuk uji sandbox, hapus tanda `#` pada baris `MAYAR_BASE` di `wrangler.toml` sementara.

### 5. Pasang dan sambungkan

```bash
npx wrangler deploy
```

Salin alamat yang muncul (`https://story-creator-license.<akunmu>.workers.dev`) dan isi `src/shared/license-config.ts`:

```ts
export const LICENSE_SERVER_URL = 'https://story-creator-license.<akunmu>.workers.dev'
export const BUY_URL = '<tautan halaman produk Mayar>'
```

Cek server hidup: buka alamatnya di browser, harus muncul `{"ok":true,...}`.

### 6. Bangun dan uji

```bash
npm run license:test     # 12 pengujian logika server, tanpa Mayar
npm run dist             # installer
```

Pasang installer, beli di sandbox, tempel kode di **Pengaturan › Lisensi**, lalu cek: ekspor 1080p tanpa watermark,
proyek keempat bisa dibuat, dan setelah **Nonaktifkan di komputer ini** aplikasi kembali ke versi gratis.

> **Jangan rilis sebelum langkah 3 sampai 5 selesai.** Selama kunci dan alamat server kosong, aplikasi sengaja tidak
> memberi batas apa pun (supaya build yang terlanjur dirilis tidak mengunci pengguna). Batas gratis baru berlaku
> setelah keduanya diisi.

## Yang disimpan server

Per kode: hash SHA-256 dari kode (bukan kodenya), dan daftar komputer yang memakainya: ID komputer (hash dari
MachineGuid Windows, bukan data pribadi), nama komputer, dan waktu aktivasi. Tidak ada email atau data pembayaran;
itu tetap di Mayar.

## Operasional

- **Refund:** nonaktifkan kodenya di dashboard Mayar. Lisensi di komputer pembeli berhenti saat pemeriksaan ulang berikutnya (paling lama 30 hari).
- **Pembeli ganti komputer:** *Pengaturan › Lisensi › Nonaktifkan di komputer ini* di komputer lama. Kalau komputer lamanya rusak, hapus entri `lic:<hash>` di KV Cloudflare, atau naikkan `MAX_DEVICES`.
- **Kunci privat bocor:** buat kunci baru (`npm run license:keys -- --force`), pasang ulang rahasianya, rilis versi baru, dan minta pembeli mengaktifkan ulang.
- **Penyalahgunaan:** pasang aturan rate limit di Cloudflare (Security › WAF › Rate limiting) untuk alamat server ini.
- **Biaya:** paket gratis Cloudflare Workers (100 ribu permintaan per hari) dan KV cukup untuk ribuan pembeli.

## Batas yang jujur

Pembatasan Pro berjalan di aplikasi yang dipasang di komputer pembeli, jadi orang yang mahir membongkar dan mengubah
aplikasi tetap bisa melewatinya. Karena itu repo kode sebaiknya **private**. Tujuan sistem ini membuat membeli lebih
mudah daripada membajak, bukan membuat pembajakan mustahil.
