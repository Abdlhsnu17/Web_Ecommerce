
CREATE DATABASE IF NOT EXISTS e_shoping_day_db
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE e_shoping_day_db;

CREATE TABLE IF NOT EXISTS categories (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,
  slug        VARCHAR(80)  NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  UNIQUE KEY uq_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id            INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  category_id   INT UNSIGNED   NOT NULL,
  name          VARCHAR(150)   NOT NULL,
  slug          VARCHAR(160)   NOT NULL,
  description   TEXT           NULL,
  price         DECIMAL(12, 2) NOT NULL,
  old_price     DECIMAL(12, 2) NULL,
  rating        DECIMAL(2, 1)  NOT NULL DEFAULT 0.0,
  review_count  INT UNSIGNED   NOT NULL DEFAULT 0,
  stock         INT UNSIGNED   NOT NULL DEFAULT 0,
  badge         VARCHAR(40)    NULL,
  image         VARCHAR(255)   NOT NULL,
  is_active     TINYINT(1)     NOT NULL DEFAULT 1,
  created_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_slug (slug),
  KEY idx_products_category (category_id),
  KEY idx_products_active_price (is_active, price),
  KEY idx_products_rating (rating),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_products_price CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120) NOT NULL,
  email          VARCHAR(160) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  phone          VARCHAR(30)  NULL,
  role           ENUM('user','admin') NOT NULL DEFAULT 'user',
  session_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED    NOT NULL,
  token_hash  CHAR(64)        NOT NULL,
  expires_at  DATETIME        NOT NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_tokens_hash (token_hash),
  KEY idx_password_reset_tokens_user (user_id),
  KEY idx_password_reset_tokens_expiry (expires_at),
  CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS carts (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NULL,
  session_token  CHAR(36)     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_carts_user (user_id),
  UNIQUE KEY uq_carts_session (session_token),
  CONSTRAINT fk_carts_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cart_items (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cart_id     INT UNSIGNED NOT NULL,
  product_id  INT UNSIGNED NOT NULL,
  quantity    INT UNSIGNED NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cart_items (cart_id, product_id),
  KEY idx_cart_items_product (product_id),
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id)
    REFERENCES carts (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cart_items_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_cart_items_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS favorites (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NULL,
  session_token  CHAR(36)     NULL,
  product_id     INT UNSIGNED NOT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_favorites_user (user_id, product_id),
  UNIQUE KEY uq_favorites_session (session_token, product_id),
  KEY idx_favorites_product (product_id),
  CONSTRAINT fk_favorites_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_favorites_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_likes (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NULL,
  session_token  CHAR(36)     NULL,
  product_id     INT UNSIGNED NOT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_likes_user (user_id, product_id),
  UNIQUE KEY uq_product_likes_session (session_token, product_id),
  KEY idx_product_likes_product (product_id),
  CONSTRAINT fk_product_likes_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_product_likes_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id                INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  order_code        VARCHAR(30)    NOT NULL,
  user_id           INT UNSIGNED   NULL,
  guest_access_token_hash CHAR(64) NOT NULL,
  status            ENUM('Menunggu pembayaran','Diproses','Dikirim','Selesai','Dibatalkan')
                      NOT NULL DEFAULT 'Menunggu pembayaran',
  subtotal          DECIMAL(12, 2) NOT NULL,
  discount_code     VARCHAR(40)    NULL,
  discount_amount   DECIMAL(12, 2) NOT NULL DEFAULT 0,
  shipping_cost     DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total             DECIMAL(12, 2) NOT NULL,
  shipping_method   ENUM('regular','express') NOT NULL DEFAULT 'regular',
  payment_method    ENUM('QRIS','Transfer Bank','Tunai') NOT NULL,
  payment_status   ENUM('Menunggu pembayaran','Menunggu verifikasi','Dibayar','Kedaluwarsa','Gagal','Dibatalkan','Dikembalikan') NOT NULL DEFAULT 'Menunggu pembayaran',
  payment_gateway VARCHAR(30) NULL,
  payment_reference VARCHAR(100) NULL,
  gateway_transaction_id VARCHAR(100) NULL,
  qris_url VARCHAR(500) NULL,
  payment_updated_at DATETIME NULL,
  payment_due_at DATETIME NULL,
  payment_proof_url VARCHAR(500) NULL,
  payment_proof_uploaded_at DATETIME NULL,
  recipient_name    VARCHAR(120)   NOT NULL,
  recipient_email   VARCHAR(160)   NULL,
  recipient_phone   VARCHAR(30)    NULL,
  shipping_address  TEXT           NOT NULL,
  shipping_city     VARCHAR(120)   NULL,
  shipping_zip      VARCHAR(20)    NULL,
  tracking_number   VARCHAR(100)   NULL,
  shipped_at        DATETIME       NULL,
  notes             VARCHAR(255)   NULL,
  created_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_code (order_code),
  UNIQUE KEY uq_orders_guest_access_token_hash (guest_access_token_hash),
  UNIQUE KEY uq_orders_gateway_transaction (gateway_transaction_id),
  UNIQUE KEY uq_orders_payment_reference (payment_reference),
  KEY idx_orders_user_date (user_id, created_at),
  KEY idx_orders_payment_expiry (payment_status, payment_due_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id INT UNSIGNED NOT NULL,
  action VARCHAR(160) NOT NULL,
  target_type VARCHAR(60) NOT NULL,
  target_id INT UNSIGNED NULL,
  metadata JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_audit_logs_created (created_at),
  KEY idx_admin_audit_logs_actor (actor_user_id, created_at),
  CONSTRAINT fk_admin_audit_logs_actor FOREIGN KEY (actor_user_id)
    REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_settings (
  id                      TINYINT UNSIGNED NOT NULL,
  bank_name               VARCHAR(80)  NOT NULL,
  bank_account_number     VARCHAR(50)  NOT NULL,
  bank_account_holder     VARCHAR(120) NOT NULL,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO payment_settings (id, bank_name, bank_account_number, bank_account_holder)
VALUES (1, 'Bank Mandiri', '9000050103739', 'HAFSAH QUROTUN AINI')
ON DUPLICATE KEY UPDATE
  bank_name = VALUES(bank_name),
  bank_account_number = VALUES(bank_account_number),
  bank_account_holder = VALUES(bank_account_holder);

CREATE TABLE IF NOT EXISTS order_items (
  id            INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  order_id      INT UNSIGNED   NOT NULL,
  product_id    INT UNSIGNED   NULL,
  product_name  VARCHAR(150)   NOT NULL,
  product_image VARCHAR(255)   NOT NULL,
  unit_price    DECIMAL(12, 2) NOT NULL,
  quantity      INT UNSIGNED   NOT NULL,
  line_total    DECIMAL(12, 2) AS (unit_price * quantity) STORED,
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id),
  KEY idx_order_items_product (product_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT chk_order_items_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id INT UNSIGNED NOT NULL,
  default_address TEXT NULL,
  default_city VARCHAR(120) NULL,
  default_zip VARCHAR(20) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_customer_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupons (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(40) NOT NULL,
  discount_type ENUM('percent','fixed') NOT NULL,
  discount_value DECIMAL(12,2) NOT NULL,
  minimum_order DECIMAL(12,2) NOT NULL DEFAULT 0,
  usage_limit INT UNSIGNED NULL,
  used_count INT UNSIGNED NOT NULL DEFAULT 0,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_coupons_code (code),
  KEY idx_coupons_active_dates (is_active, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_reviews (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(1000) NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_reviews_order (order_id),
  KEY idx_product_reviews_published (is_published, created_at),
  CONSTRAINT chk_product_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_product_reviews_order FOREIGN KEY (order_id) REFERENCES orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_product_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email       VARCHAR(160) NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_newsletter_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcements (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind           ENUM('Berita','Pengumuman') NOT NULL DEFAULT 'Berita',
  title          VARCHAR(180) NOT NULL,
  excerpt        VARCHAR(255) NULL,
  content        TEXT NOT NULL,
  image          VARCHAR(255) NULL,
  is_published   TINYINT(1) NOT NULL DEFAULT 0,
  published_at   DATETIME NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_announcements_publication (is_published, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_content (
  id INT UNSIGNED NOT NULL, services_title VARCHAR(255) NOT NULL, services_intro TEXT NULL,
  about_label VARCHAR(120) NOT NULL, about_title VARCHAR(255) NOT NULL, about_text TEXT NOT NULL,
  about_image VARCHAR(255) NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO site_content
  (id, services_title, services_intro, about_label, about_title, about_text, about_image)
VALUES
  (1,
   'Temukan produk untuk berbagai kebutuhan.',
   'Temukan produk dari berbagai kategori dengan informasi dan harga yang jelas.',
   'Tentang E-SHOPING DAY',
   'Temukan kebutuhan Anda dalam satu tempat.',
   'E-SHOPING DAY menghadirkan pilihan barang dari berbagai kategori dengan pengalaman belanja yang praktis, informasi produk yang jelas, dan proses pemesanan yang mudah.',
   NULL)
ON DUPLICATE KEY UPDATE
  services_title = VALUES(services_title), services_intro = VALUES(services_intro),
  about_label = VALUES(about_label), about_title = VALUES(about_title),
  about_text = VALUES(about_text), about_image = VALUES(about_image);

INSERT INTO categories (name, slug)
VALUES ('Semua Produk', 'semua-produk')
ON DUPLICATE KEY UPDATE slug = VALUES(slug);

SET @general_category_id := (SELECT id FROM categories WHERE slug = 'semua-produk' LIMIT 1);


INSERT INTO products
  (category_id, name, slug, description, price, stock, badge, image, is_active)
VALUES
  (@general_category_id, 'Sepatu Kasual', 'sepatu-kasual', 'Sepatu nyaman untuk aktivitas harian dengan desain serbaguna.', 289000, 24, 'Pilihan populer', 'assets/img/shoes.svg', 1),
  (@general_category_id, 'Kamera Digital', 'kamera-digital', 'Kamera digital ringkas untuk mengabadikan momen dan kebutuhan kreatif.', 1850000, 8, 'Elektronik', 'assets/img/camera.svg', 1),
  (@general_category_id, 'Lampu Meja LED', 'lampu-meja-led', 'Lampu meja minimalis dengan pencahayaan nyaman untuk ruang kerja.', 159000, 32, 'Rumah tangga', 'assets/img/lamp.svg', 1),
  (@general_category_id, 'Tas Harian', 'tas-harian', 'Tas praktis untuk membawa barang penting saat beraktivitas.', 219000, 18, 'Terlaris', 'assets/img/bag.svg', 1),
  (@general_category_id, 'Jam Tangan', 'jam-tangan', 'Jam tangan bergaya simpel untuk melengkapi penampilan sehari-hari.', 399000, 14, 'Aksesori', 'assets/img/watch.svg', 1),
  (@general_category_id, 'Headphone Nirkabel', 'headphone-nirkabel', 'Headphone nyaman untuk mendengarkan musik dan mengikuti rapat.', 549000, 20, 'Elektronik', 'assets/img/headphones.svg', 1),
  (@general_category_id, 'Kopi Pilihan', 'kopi-pilihan', 'Kopi pilihan untuk menemani waktu santai dan rutinitas harian.', 89000, 40, 'Favorit', 'assets/img/coffee.svg', 1),
  (@general_category_id, 'Keyboard Mekanikal', 'keyboard-mekanikal', 'Keyboard mekanikal untuk pengalaman mengetik yang responsif.', 675000, 12, 'Elektronik', 'assets/img/keyboard.svg', 1)
ON DUPLICATE KEY UPDATE
  category_id = VALUES(category_id), name = VALUES(name), description = VALUES(description),
  price = VALUES(price), stock = VALUES(stock),
  badge = VALUES(badge), image = VALUES(image), is_active = VALUES(is_active);


INSERT INTO coupons
  (code, discount_type, discount_value, minimum_order, usage_limit, used_count, starts_at, ends_at, is_active)
VALUES
  ('SHOP10', 'percent', 10, 50000, 1000, 0, NULL, NULL, 1)
ON DUPLICATE KEY UPDATE
  discount_type = VALUES(discount_type), discount_value = VALUES(discount_value),
  minimum_order = VALUES(minimum_order), usage_limit = VALUES(usage_limit),
  starts_at = VALUES(starts_at), ends_at = VALUES(ends_at), is_active = VALUES(is_active);

INSERT INTO announcements
  (kind, title, excerpt, content, image, is_published, published_at)
VALUES
  ('Pengumuman',
   'Selamat datang di E-SHOPING DAY',
   'Temukan barang pilihan dari berbagai kategori dan nikmati pengalaman belanja yang praktis.',
   'Selamat datang di E-SHOPING DAY. Jelajahi katalog kami untuk menemukan kebutuhan sehari-hari, elektronik, aksesori, dan berbagai barang pilihan lainnya. Gunakan kode SHOP10 untuk menikmati diskon pada pesanan yang memenuhi syarat.',
   NULL,
   1,
   NOW());

CREATE OR REPLACE VIEW v_catalog AS
SELECT
  p.id,
  p.name,
  p.slug,
  c.name AS category,
  p.price,
  p.old_price,
  p.rating,
  p.review_count,
  p.stock,
  p.badge,
  p.image
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE p.is_active = 1;
