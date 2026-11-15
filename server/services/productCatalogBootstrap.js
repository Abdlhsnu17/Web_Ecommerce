const { pool } = require("../config/db");

const PRODUCTS = [
  ["Sepatu Kasual", "sepatu-kasual", "Sepatu nyaman untuk aktivitas harian dengan desain serbaguna.", 289000, 24, "Pilihan populer", "assets/img/shoes.svg"],
  ["Kamera Digital", "kamera-digital", "Kamera digital ringkas untuk mengabadikan momen dan kebutuhan kreatif.", 1850000, 8, "Elektronik", "assets/img/camera.svg"],
  ["Lampu Meja LED", "lampu-meja-led", "Lampu meja minimalis dengan pencahayaan nyaman untuk ruang kerja.", 159000, 32, "Rumah tangga", "assets/img/lamp.svg"],
  ["Tas Harian", "tas-harian", "Tas praktis untuk membawa barang penting saat beraktivitas.", 219000, 18, "Terlaris", "assets/img/bag.svg"],
  ["Jam Tangan", "jam-tangan", "Jam tangan bergaya simpel untuk aktivitas sehari-hari.", 399000, 14, "Aksesori", "assets/img/watch.svg"],
  ["Headphone Nirkabel", "headphone-nirkabel", "Headphone nyaman untuk mendengarkan musik dan mengikuti rapat.", 549000, 20, "Elektronik", "assets/img/headphones.svg"],
  ["Kopi Pilihan", "kopi-pilihan", "Kopi pilihan untuk menemani waktu santai dan rutinitas harian.", 89000, 40, "Favorit", "assets/img/coffee.svg"],
  ["Keyboard Mekanikal", "keyboard-mekanikal", "Keyboard mekanikal untuk pengalaman mengetik yang responsif.", 675000, 12, "Elektronik", "assets/img/keyboard.svg"]
];

async function ensureProductLikesTable() {
  // Database yang dibuat sebelum fitur favorit produk ditambahkan belum
  // memiliki tabel ini. Siapkan saat aplikasi mulai agar katalog tetap terbuka.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_likes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NULL,
      session_token CHAR(36) NULL,
      product_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_product_likes_user (user_id, product_id),
      UNIQUE KEY uq_product_likes_session (session_token, product_id),
      KEY idx_product_likes_product (product_id),
      CONSTRAINT fk_product_likes_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT fk_product_likes_product FOREIGN KEY (product_id)
        REFERENCES products (id) ON UPDATE CASCADE ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** Memastikan katalog awal tersedia tanpa menimpa perubahan dari admin. */
async function ensureProductCatalog() {
  await ensureProductLikesTable();

  await pool.query(
    "INSERT INTO categories (name, slug) VALUES ('Semua Produk', 'semua-produk') ON DUPLICATE KEY UPDATE slug = slug"
  );
  const [categories] = await pool.query("SELECT id FROM categories WHERE slug = 'semua-produk' LIMIT 1");
  const categoryId = categories[0].id;

  for (const [name, slug, description, price, stock, badge, image] of PRODUCTS) {
    await pool.query(
      `INSERT INTO products
        (category_id, name, slug, description, price, stock, badge, image, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE slug = slug`,
      [categoryId, name, slug, description, price, stock, badge, image]
    );
  }
}

module.exports = { ensureProductCatalog };
