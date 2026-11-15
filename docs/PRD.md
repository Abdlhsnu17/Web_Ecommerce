# PRD — E-SHOPING DAY

## 1. Ringkasan produk

E-SHOPING DAY adalah toko online umum untuk menemukan dan membeli beragam barang dari satu tempat. Aplikasi menghubungkan katalog produk, keranjang, checkout, pembayaran, pelacakan pesanan, dan dashboard operasional dalam pengalaman web yang mudah digunakan.

## 2. Masalah dan peluang

Pembeli membutuhkan informasi produk, harga, ketersediaan, ongkos kirim, dan status transaksi yang jelas. Pengelola toko membutuhkan satu tempat untuk memperbarui katalog dan stok, memproses pembayaran dan pesanan, serta melihat performa penjualan. Sistem ini menyediakan alur katalog, pembayaran, pengiriman, dan pengelolaan toko dalam struktur aplikasi yang sudah ada.

## 3. Visi dan tujuan

Menjadi toko online serbaguna yang praktis, tepercaya, dan mudah dikelola.

- Menampilkan produk dari berbagai kategori dalam katalog terpadu.
- Membuat belanja dari pencarian hingga checkout lebih ringkas.
- Menjaga informasi stok, harga, pengiriman, dan status transaksi tetap jelas.
- Membantu admin mengelola produk dan pesanan dari dashboard.

## 4. Pengguna

- **Pengunjung:** mencari dan melihat barang, menambah keranjang, lalu checkout sebagai tamu.
- **Pelanggan terdaftar:** mengelola akun, favorit, alamat, dan riwayat pesanan.
- **Admin toko:** mengelola kategori dan barang, stok, pesanan, pembayaran, promo, konten, pelanggan, serta laporan.

## 5. Ruang lingkup

### Termasuk

- Katalog produk umum dengan nama, deskripsi, foto, kategori, harga, harga promo, stok, dan status aktif.
- Pencarian, filter kategori, pengurutan, favorit, ulasan, dan voucher.
- Keranjang pengunjung dan pelanggan.
- Checkout dengan informasi penerima, alamat pengiriman, pilihan pengiriman, metode pembayaran, serta ringkasan biaya.
- Checkout tamu dan akun pelanggan.
- Pelacakan pesanan, status pembayaran, unggah bukti transfer, invoice, dan notifikasi email bila SMTP tersedia.
- Dashboard untuk mengelola katalog, transaksi, promosi, konten, serta laporan.

### Tidak termasuk dalam cakupan saat ini

- Aplikasi iOS/Android native.
- Marketplace multi-penjual atau multi-toko.
- Integrasi kurir real-time dan perhitungan tarif otomatis.
- Sinkronisasi stok dengan sistem POS/ERP eksternal.

## 6. Kebutuhan fungsional

### FR-01 — Katalog barang

Sistem menampilkan barang aktif dengan nama, deskripsi, kategori, foto, harga, harga promo bila tersedia, stok, dan label promosi. Produk dapat dicari, difilter, dan diurutkan.

### FR-02 — Keranjang dan favorit

Pengguna dapat menambah atau menghapus barang, mengubah jumlah, melihat subtotal, dan menyimpan favorit. Data pengunjung dan pelanggan dikelola sesuai mekanisme sesi yang ada.

### FR-03 — Akun pelanggan

Pengguna dapat mendaftar, masuk, keluar, melihat profil dan riwayat, mengubah password, serta melakukan pemulihan password.

### FR-04 — Checkout dan pesanan

Checkout membaca isi keranjang dari server, memvalidasi jumlah terhadap stok, menerima identitas penerima dan alamat pengiriman, menerapkan voucher yang valid, menghitung subtotal/diskon/ongkir/total, lalu menyimpan pesanan dan salinan rincian barang.

### FR-05 — Pengiriman

Pesanan menyimpan metode pengiriman dan alamat lengkap. Admin dapat mencatat nomor resi dan mengubah status menjadi dikirim; pelanggan dapat melihat nomor resi di riwayat pesanan.

### FR-06 — Pembayaran

Sistem mendukung metode pembayaran yang dikonfigurasi seperti QRIS dan transfer bank. Status pembayaran dapat menunggu, diverifikasi, dibayar, gagal, kedaluwarsa, dibatalkan, atau dikembalikan sesuai alur backend.

### FR-07 — Dashboard admin

Admin dapat mengelola produk dan kategori, stok, harga, gambar, pesanan, pembayaran, promo/voucher, pengumuman, konten situs, pengguna, ulasan, dan laporan penjualan.

### FR-08 — Keamanan

Password disimpan sebagai hash, sesi memakai cookie HTTP-only, endpoint admin dibatasi berdasarkan role, input divalidasi di server, dan secret dibaca dari environment.

## 7. Kebutuhan non-fungsional

- **Kinerja:** halaman katalog dan pencarian tetap responsif untuk katalog toko skala kecil hingga menengah.
- **Konsistensi:** pembuatan order, rincian barang, pembayaran, voucher, dan pengurangan stok menggunakan transaksi database sesuai implementasi backend.
- **Keamanan:** data sesi dan pesanan dilindungi oleh mekanisme autentikasi dan token akses yang sudah tersedia.
- **Kemudahan pemeliharaan:** struktur API, server, frontend, dan migrasi yang ada tetap dipertahankan.

## 8. Alur utama

### Belanja

1. Pengunjung membuka toko dan menelusuri kategori atau mencari barang.
2. Pengunjung melihat detail dan menambahkan barang ke keranjang.
3. Pengunjung melanjutkan sebagai tamu atau masuk ke akun.
4. Pembeli mengisi penerima, alamat, pengiriman, voucher, dan metode pembayaran.
5. Sistem memvalidasi stok dan membuat pesanan beserta rincian barang.
6. Pembeli menyelesaikan pembayaran dan memantau status pesanan.
7. Admin memproses pesanan dan memperbarui statusnya.

### Operasional admin

1. Admin masuk ke dashboard.
2. Admin mengelola katalog, kategori, harga, dan stok.
3. Admin memeriksa pesanan dan pembayaran masuk.
4. Admin memproses pesanan dan melihat laporan penjualan.

## 9. Ukuran keberhasilan

- Pembeli dapat menyelesaikan alur katalog-ke-pesanan tanpa bantuan admin.
- Pesanan menyimpan rincian barang dan total transaksi yang konsisten.
- Admin dapat memperbarui produk dan memproses pesanan melalui dashboard.
- Informasi stok dan status pesanan mudah ditemukan oleh pembeli.

## 10. Batasan implementasi

- Tarif pengiriman reguler dan ekspres saat ini masih mengikuti konfigurasi tetap aplikasi; belum dihitung dari layanan kurir eksternal.
- Status pembayaran QRIS otomatis memerlukan konfigurasi gateway. Transfer bank memerlukan verifikasi admin.
- Database pada `database/schema.sql` adalah baseline untuk instalasi baru. Database lama memerlukan backup dan migrasi yang sesuai sebelum menggunakan struktur ecommerce.
