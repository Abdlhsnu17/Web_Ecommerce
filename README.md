# E-SHOPING DAY

E-SHOPING DAY adalah toko online untuk menjual beragam barang dalam satu katalog. Aplikasi menyediakan halaman toko, pencarian dan kategori, keranjang, checkout, pembayaran, pelacakan pesanan, akun pelanggan, serta dashboard admin untuk mengelola produk dan transaksi.

## Fitur

- Katalog berbagai barang dengan kategori, harga, stok, gambar, promo, dan ulasan.
- Pencarian, filter, favorit, dan keranjang untuk pelanggan maupun pengunjung.
- Checkout dengan alamat penerima, pilihan pengiriman, voucher, dan pembayaran.
- Akun pelanggan, checkout tamu, riwayat dan pelacakan pesanan.
- Dashboard admin untuk produk, kategori, stok, pesanan, pembayaran, pelanggan, konten, voucher, dan laporan penjualan.
- Pembayaran QRIS/Midtrans serta transfer bank manual sesuai konfigurasi deployment.

## Teknologi

Node.js 20+, Express, MySQL/MariaDB, dan frontend HTML/CSS/JavaScript statis.

## Menjalankan secara lokal

1. Salin `.env.example` menjadi `.env` dan isi koneksi database, `JWT_SECRET`, alamat aplikasi, serta konfigurasi email/pembayaran yang digunakan.
2. Install dependency: `npm install`.
3. Impor skema untuk database baru: `mysql -u root -h 127.0.0.1 -P 3306 < database/schema.sql`.
4. Jalankan aplikasi: `npm start` (atau `npm run dev` untuk development).
5. Buka `http://localhost:3000` dan buat admin pertama melalui `npm run admin:create`.

> Instalasi lama memakai migrasi di `database/migrations/`; jalankan `npm run db:migrate` sebelum restart setelah pembaruan. Skema baseline ditujukan untuk database baru bernama `e_shoping_day_db`. Jika memakai database lama, samakan nilai `DB_NAME` di `.env` dengan database tersebut.

Skema `schema.sql` ini ditujukan untuk database baru. Database lama dari aplikasi pemesanan layanan perlu dicadangkan dan disesuaikan dengan migrasi ecommerce tersendiri sebelum dijalankan; jangan mengimpor ulang schema di atas database yang sudah berisi data.

## Konfigurasi penting

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=e_shoping_day_db
JWT_SECRET=isi_dengan_string_acak_minimal_32_karakter
JWT_EXPIRES_IN=7d
BOOTSTRAP_ADMIN_EMAIL=admin@email.com
BOOTSTRAP_ADMIN_NAME=Administrator E-SHOPING DAY
BOOTSTRAP_ADMIN_PASSWORD=PasswordMinimal12Karakter
APP_URL=http://localhost:3000
```

Tambahkan SMTP, pengaturan rekening bank, QRIS, dan Midtrans bila fitur tersebut dipakai. Simpan rahasia hanya di environment, jangan commit `.env`.

## Struktur

```text
database/
  schema.sql     baseline database untuk instalasi baru
  migrations/    migrasi berurutan dan kompatibilitas instalasi lama
docs/            PRD dan dokumentasi produk
public/
  assets/        gambar dan stylesheet dasar
  css/           stylesheet storefront dan dashboard
  js/            JavaScript storefront dan dashboard
  uploads/       gambar yang diunggah saat runtime
server/
  config/        konfigurasi database dan environment
  controllers/   handler API dan aturan endpoint
  middleware/    autentikasi, sesi, CSRF, upload, dan audit
  routes/        pemetaan endpoint API
  scripts/       migrasi dan utilitas admin/katalog
  services/      integrasi pembayaran, email, dan bootstrap katalog
test/             pengujian otomatis
```

## Operasional

Untuk deployment, gunakan Node.js 20+, MySQL/MariaDB, HTTPS melalui reverse proxy, simpan konfigurasi rahasia di environment server, dan backup database beserta `public/uploads/` secara berkala. Endpoint pemeriksaan server tersedia di `/health` dan `/ready`. Konfigurasi Docker atau systemd belum disertakan dalam checkout ini.

Jangan membuka `public/index.html` langsung melalui file browser; halaman membutuhkan Express dan API pada `/api`.
# Web_Ecommerce
