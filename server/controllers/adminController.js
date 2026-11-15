/**
 * Panel admin.
 *
 * Seluruh fungsi di berkas ini hanya boleh dipasang di belakang requireAdmin.
 * Data tetap satu sumber dengan sisi pelanggan — tabel yang sama di MySQL —
 * hanya cakupannya yang lebih luas (semua pesanan, semua akun, produk nonaktif).
 */
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { notifyOrderUpdate } = require("../services/orderMailer");

const ORDER_STATUSES = ["Menunggu pembayaran", "Diproses", "Dikirim", "Selesai", "Dibatalkan"];
const PAYMENT_STATUSES = ["Menunggu pembayaran", "Menunggu verifikasi", "Dibayar", "Kedaluwarsa", "Gagal", "Dibatalkan", "Dikembalikan"];

function isFinalOrder(order) { return ["Selesai", "Dibatalkan"].includes(order?.status); }

async function rejectFinalOrderChange(orderId, res) {
  const [orders] = await pool.query(
    `SELECT status, payment_status AS paymentStatus
       FROM orders WHERE id = ?`,
    [orderId]
  );
  if (!orders.length) {
    res.status(404).json({ message: "Pesanan tidak ditemukan." });
    return true;
  }
  if (isFinalOrder(orders[0])) {
    res.status(409).json({ message: "Pesanan sudah final dan statusnya tidak dapat diubah." });
    return true;
  }
  return false;
}

/** "Nimbus Pro" → "nimbus-pro"; dipakai bila admin tidak mengisi slug sendiri. */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
}

async function listCategoriesAdmin(_req, res, next) {
  try {
    const [rows] = await pool.query(`SELECT c.id, c.name, c.slug, c.created_at AS createdAt, COUNT(p.id) AS productCount FROM categories c LEFT JOIN products p ON p.category_id = c.id GROUP BY c.id, c.name, c.slug, c.created_at ORDER BY c.name`);
    res.json(rows);
  } catch (error) { next(error); }
}

async function createCategory(req, res, next) {
  try {
    const name = String(req.body.name || "").trim();
    const slug = slugify(req.body.slug || name);
    if (!name || !slug) return res.status(400).json({ message: "Nama kategori wajib diisi." });
    const [result] = await pool.query("INSERT INTO categories (name, slug) VALUES (?, ?)", [name, slug]);
    res.status(201).json({ id: result.insertId, message: `Kategori ${name} ditambahkan.` });
  } catch (error) { if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "Nama atau slug kategori sudah digunakan." }); next(error); }
}

async function updateCategory(req, res, next) {
  try {
    const name = String(req.body.name || "").trim();
    const slug = slugify(req.body.slug || name);
    if (!name || !slug) return res.status(400).json({ message: "Nama kategori wajib diisi." });
    const [result] = await pool.query("UPDATE categories SET name = ?, slug = ? WHERE id = ?", [name, slug, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Kategori tidak ditemukan." });
    res.json({ id: Number(req.params.id), message: `Kategori ${name} diperbarui.` });
  } catch (error) { if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "Nama atau slug kategori sudah digunakan." }); next(error); }
}

async function deleteCategory(req, res, next) {
  try {
    const [rows] = await pool.query("SELECT name FROM categories WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: "Kategori tidak ditemukan." });
    const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM products WHERE category_id = ?", [req.params.id]);
    if (Number(count)) return res.status(409).json({ message: "Kategori yang masih dipakai produk tidak dapat dihapus." });
    await pool.query("DELETE FROM categories WHERE id = ?", [req.params.id]);
    res.json({ id: Number(req.params.id), message: `Kategori ${rows[0].name} dihapus.` });
  } catch (error) { next(error); }
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ------------------------------------------------------------------ ringkasan

async function getStats(_req, res, next) {
  try {
    const [[totals]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users)                                    AS totalUsers,
         (SELECT COUNT(*) FROM users WHERE role = 'admin')               AS totalAdmins,
         (SELECT COUNT(*) FROM products)                                 AS totalProducts,
         (SELECT COUNT(*) FROM products WHERE is_active = 0)             AS inactiveProducts,
         (SELECT COUNT(*) FROM products WHERE stock <= 10)               AS lowStock,
         (SELECT COUNT(*) FROM orders)                                   AS totalOrders,
         (SELECT COUNT(*) FROM orders WHERE status = 'Menunggu pembayaran') AS pendingOrders,
         (SELECT COUNT(*) FROM orders WHERE payment_status IN ('Menunggu pembayaran','Menunggu verifikasi')) AS pendingPayments,
         (SELECT COALESCE(SUM(total), 0) FROM orders
           WHERE status <> 'Dibatalkan' AND payment_status = 'Dibayar')  AS revenue,
         (SELECT COUNT(*) FROM newsletter_subscribers)                   AS subscribers`
    );

    const [byStatus] = await pool.query(
      `SELECT status, COUNT(*) AS jumlah, COALESCE(SUM(total), 0) AS nilai
         FROM orders GROUP BY status`
    );

    const [topProducts] = await pool.query(
      `SELECT oi.product_name AS name,
              SUM(oi.quantity)   AS terjual,
              SUM(oi.line_total) AS pendapatan
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
                      AND o.status <> 'Dibatalkan'
                      AND o.payment_status = 'Dibayar'
        GROUP BY oi.product_name
        ORDER BY terjual DESC
        LIMIT 5`
    );

    res.json({ ...totals, byStatus, topProducts });
  } catch (error) {
    next(error);
  }
}

// ------------------------------------------------------------------ pesanan

async function listAllOrders(req, res, next) {
  try {
    const where = [];
    const params = [];

    if (req.query.status && ORDER_STATUSES.includes(req.query.status)) {
      where.push("o.status = ?");
      params.push(req.query.status);
    }
    if (req.query.q?.trim()) {
      where.push("(o.order_code LIKE ? OR o.recipient_email LIKE ? OR o.recipient_name LIKE ?)");
      const keyword = `%${req.query.q.trim()}%`;
      params.push(keyword, keyword, keyword);
    }

    const [orders] = await pool.query(
      `SELECT o.id, o.order_code AS orderCode, o.status, o.subtotal,
              o.shipping_cost AS shippingCost, o.total,
              o.shipping_method AS shippingMethod, o.payment_method AS paymentMethod,
              o.payment_status AS paymentStatus,
              o.payment_due_at AS paymentDueAt, o.payment_proof_url AS paymentProofUrl,
              o.recipient_name AS recipientName, o.recipient_email AS recipientEmail,
              o.recipient_phone AS recipientPhone, o.shipping_address AS address,
              o.shipping_city AS city, o.tracking_number AS trackingNumber,
              o.shipped_at AS shippedAt, o.created_at AS createdAt,
              u.id AS userId, COALESCE(u.name, o.recipient_name) AS customerName,
              COALESCE(u.email, o.recipient_email) AS customerEmail
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY o.created_at DESC
        LIMIT 200`,
      params
    );

    if (!orders.length) return res.json([]);

    const [items] = await pool.query(
      `SELECT order_id AS orderId, product_name AS name, product_image AS image,
              unit_price AS price, quantity AS qty, line_total AS lineTotal
         FROM order_items WHERE order_id IN (${orders.map(() => "?").join(",")})`,
      orders.map(order => order.id)
    );

    const grouped = new Map(orders.map(order => [order.id, { ...order, items: [] }]));
    items.forEach(item => grouped.get(item.orderId)?.items.push(item));
    res.json([...grouped.values()]);
  } catch (error) {
    next(error);
  }
}

async function updateOrderStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Status pesanan tidak dikenali." });
    }
    if (await rejectFinalOrderChange(req.params.id, res)) return;

    const [result] = await pool.query("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Pesanan tidak ditemukan." });
    const [orders] = await pool.query("SELECT order_code AS orderCode, recipient_name AS recipientName, recipient_email AS recipientEmail FROM orders WHERE id = ?", [req.params.id]);
    notifyOrderUpdate({ to: orders[0].recipientEmail, recipientName: orders[0].recipientName, orderCode: orders[0].orderCode, subject: `Status pesanan ${orders[0].orderCode}`, message: `Status pesanan Anda diperbarui menjadi: ${status}.` });

    res.json({ id: Number(req.params.id), status, message: `Status pesanan diubah menjadi ${status}.` });
  } catch (error) {
    next(error);
  }
}

async function cancelOrder(req, res, next) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [orders] = await connection.query(
      `SELECT id, status, payment_status AS paymentStatus, discount_code AS discountCode
         FROM orders WHERE id = ? FOR UPDATE`,
      [req.params.id]
    );
    const order = orders[0];
    if (!order) {
      await connection.rollback();
      return res.status(404).json({ message: "Pesanan tidak ditemukan." });
    }
    if (order.status === "Dibatalkan") {
      await connection.rollback();
      return res.status(409).json({ message: "Pesanan sudah dibatalkan." });
    }
    if (isFinalOrder(order)) {
      await connection.rollback();
      return res.status(409).json({ message: "Pesanan yang sudah selesai bersifat final dan tidak dapat dibatalkan." });
    }
    const [items] = await connection.query("SELECT product_id AS productId, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL", [order.id]);
    for (const item of items) await connection.query("UPDATE products SET stock = stock + ? WHERE id = ?", [item.quantity, item.productId]);
    if (order.discountCode) await connection.query("UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE code = ?", [order.discountCode]);
    await connection.query("UPDATE orders SET status = 'Dibatalkan', payment_status = IF(payment_status = 'Dibayar', payment_status, 'Dibatalkan') WHERE id = ?", [order.id]);
    await connection.commit();
    res.json({ id: Number(req.params.id), message: "Pesanan dibatalkan dan stok dikembalikan." });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

async function deleteOrder(req, res, next) {
  try {
    const [orders] = await pool.query(
      `SELECT id, status, payment_status AS paymentStatus
         FROM orders WHERE id = ?`,
      [req.params.id]
    );
    if (!orders.length) return res.status(404).json({ message: "Pesanan tidak ditemukan." });
    if (!isFinalOrder(orders[0])) {
      return res.status(409).json({ message: "Hanya pesanan yang sudah selesai atau dibatalkan yang dapat dihapus." });
    }
    await pool.query("DELETE FROM orders WHERE id = ?", [req.params.id]);
    res.json({ id: Number(req.params.id), message: "Pesanan berhasil dihapus permanen." });
  } catch (error) {
    next(error);
  }
}

async function updatePaymentStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!PAYMENT_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Status pembayaran tidak dikenali." });
    }
    if (await rejectFinalOrderChange(req.params.id, res)) return;
    const [result] = await pool.query(
      `UPDATE orders SET payment_status = ?, payment_updated_at = NOW(),
              payment_due_at = IF(? IN ('Dibayar','Dikembalikan','Dibatalkan'), NULL, payment_due_at),
              status = CASE WHEN ? = 'Dibayar' AND status = 'Menunggu pembayaran' THEN 'Diproses' ELSE status END
        WHERE id = ?`, [status, status, status, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Pesanan tidak ditemukan." });
    const [orders] = await pool.query("SELECT order_code AS orderCode, recipient_name AS recipientName, recipient_email AS recipientEmail FROM orders WHERE id = ?", [req.params.id]);
    notifyOrderUpdate({ to: orders[0].recipientEmail, recipientName: orders[0].recipientName, orderCode: orders[0].orderCode, subject: `Pembayaran ${orders[0].orderCode}`, message: `Status pembayaran Anda diperbarui menjadi: ${status}.` });
    res.json({ id: Number(req.params.id), paymentStatus: status });
  } catch (error) {
    next(error);
  }
}

async function updateShipment(req, res, next) {
  try {
    const trackingNumber = String(req.body.trackingNumber || "").trim();
    if (!trackingNumber) return res.status(400).json({ message: "Nomor resi wajib diisi." });
    const [result] = await pool.query(
      `UPDATE orders SET tracking_number = ?, shipped_at = COALESCE(shipped_at, NOW()), status = 'Dikirim'
        WHERE id = ? AND status NOT IN ('Selesai', 'Dibatalkan')`,
      [trackingNumber, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Pesanan tidak ditemukan atau sudah final." });
    const [orders] = await pool.query("SELECT order_code AS orderCode, recipient_name AS recipientName, recipient_email AS recipientEmail FROM orders WHERE id = ?", [req.params.id]);
    notifyOrderUpdate({ to: orders[0].recipientEmail, recipientName: orders[0].recipientName, orderCode: orders[0].orderCode, subject: `Pesanan ${orders[0].orderCode} dikirim`, message: `Pesanan Anda telah dikirim. Nomor resi: ${trackingNumber}.` });
    res.json({ id: Number(req.params.id), trackingNumber, message: "Nomor resi dan status pengiriman diperbarui." });
  } catch (error) { next(error); }
}

// ------------------------------------------------------------------ produk

async function listAllProducts(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.slug, p.description, p.category_id AS categoryId,
              c.name AS category, p.price, p.old_price AS oldPrice, p.rating,
              p.review_count AS reviews, p.stock, p.badge, p.image,
              p.is_active AS isActive, p.created_at AS createdAt
         FROM products p
         JOIN categories c ON c.id = p.category_id
        ORDER BY p.id DESC`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
}

async function createProduct(req, res, next) {
  try {
    const name = (req.body.name || "").trim();
    const categoryId = toNumber(req.body.categoryId);
    const price = toNumber(req.body.price);
    const stock = toNumber(req.body.stock);
    if (!name || !categoryId || price === null || price < 0 || stock === null || !Number.isInteger(stock) || stock < 0) {
      return res.status(400).json({ message: "Nama, kategori, harga, dan stok produk harus valid." });
    }

    const [category] = await pool.query("SELECT id FROM categories WHERE id = ?", [categoryId]);
    if (!category.length) return res.status(400).json({ message: "Kategori tidak ditemukan." });

    const slug = slugify(req.body.slug || name);
    const [existing] = await pool.query("SELECT id FROM products WHERE slug = ?", [slug]);
    if (existing.length) return res.status(409).json({ message: "Slug produk sudah dipakai." });

    const [result] = await pool.query(
      `INSERT INTO products
         (category_id, name, slug, description, price, old_price, stock, badge, image, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        categoryId, name, slug, req.body.description || null, price,
        toNumber(req.body.oldPrice), Math.max(0, stock),
        (req.body.badge || "").trim() || null,
        (req.body.image || "").trim() || "assets/img/bag.svg",
        req.body.isActive === false ? 0 : 1
      ]
    );

    res.status(201).json({ id: result.insertId, message: `Produk ${name} ditambahkan.` });
  } catch (error) {
    next(error);
  }
}

async function updateProduct(req, res, next) {
  try {
    const fields = [];
    const params = [];
    const set = (column, value) => { fields.push(`${column} = ?`); params.push(value); };

    if (req.body.name !== undefined) set("name", String(req.body.name).trim());
    if (req.body.description !== undefined) set("description", req.body.description || null);
    if (req.body.categoryId !== undefined) set("category_id", toNumber(req.body.categoryId));
    if (req.body.price !== undefined) set("price", toNumber(req.body.price));
    if (req.body.oldPrice !== undefined) set("old_price", toNumber(req.body.oldPrice));
    if (req.body.stock !== undefined) {
      const stock = toNumber(req.body.stock);
      if (stock === null || !Number.isInteger(stock) || stock < 0) return res.status(400).json({ message: "Stok harus berupa bilangan bulat nol atau lebih." });
      set("stock", stock);
    }
    if (req.body.badge !== undefined) set("badge", (req.body.badge || "").trim() || null);
    if (req.body.image !== undefined) set("image", String(req.body.image).trim());
    if (req.body.isActive !== undefined) set("is_active", req.body.isActive ? 1 : 0);

    if (!fields.length) return res.status(400).json({ message: "Tidak ada data yang diubah." });

    const [result] = await pool.query(
      `UPDATE products SET ${fields.join(", ")} WHERE id = ?`,
      [...params, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Produk tidak ditemukan." });

    res.json({ id: Number(req.params.id), message: "Produk diperbarui." });
  } catch (error) {
    next(error);
  }
}

/**
 * Hapus produk dari katalog. Riwayat pesanan tetap aman: order_items
 * menyimpan snapshot nama/harga dan foreign key product_id memakai SET NULL.
 */
async function deleteProduct(req, res, next) {
  try {
    const [result] = await pool.query("DELETE FROM products WHERE id = ?", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Produk tidak ditemukan." });
    res.json({ id: Number(req.params.id), message: "Produk berhasil dihapus." });
  } catch (error) {
    next(error);
  }
}

// ------------------------------------------------------------------ pengguna

async function listUsers(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at AS createdAt,
              (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS totalOrders
         FROM users u
        ORDER BY u.created_at DESC`
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
}

async function createUser(req, res, next) {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const role = req.body.role === "admin" ? "admin" : "user";

    if (!name || !email || password.length < 12) {
      return res.status(400).json({ message: "Nama, email, dan password minimal 12 karakter wajib diisi." });
    }

    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length) return res.status(409).json({ message: "Email sudah terdaftar." });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password_hash, phone, role) VALUES (?, ?, ?, ?, ?)",
      [name, email, hash, (req.body.phone || "").trim() || null, role]
    );

    res.status(201).json({ id: result.insertId, role, message: `Akun ${email} dibuat sebagai ${role}.` });
  } catch (error) {
    next(error);
  }
}

async function updateUser(req, res, next) {
  try {
    const targetId = Number(req.params.id);
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const phone = (req.body.phone || "").trim() || null;

    if (!Number.isInteger(targetId) || targetId < 1 || !name || !email) {
      return res.status(400).json({ message: "Nama dan email wajib diisi." });
    }

    const [existing] = await pool.query("SELECT id FROM users WHERE email = ? AND id <> ?", [email, targetId]);
    if (existing.length) return res.status(409).json({ message: "Email sudah digunakan akun lain." });

    const [result] = await pool.query(
      "UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?",
      [name, email, phone, targetId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Akun tidak ditemukan." });

    res.json({ id: targetId, message: "Data akun berhasil diperbarui." });
  } catch (error) {
    next(error);
  }
}

async function updateUserRole(req, res, next) {
  try {
    const role = req.body.role;
    if (!["user", "admin"].includes(role)) {
      return res.status(400).json({ message: "Peran hanya boleh 'user' atau 'admin'." });
    }

    const targetId = Number(req.params.id);

    // Mencegah admin mengunci dirinya sendiri di luar panel.
    if (targetId === req.user.id && role !== "admin") {
      return res.status(400).json({ message: "Kamu tidak bisa menurunkan peranmu sendiri." });
    }

    // Selalu sisakan minimal satu admin di sistem.
    if (role !== "admin") {
      const [[{ jumlah }]] = await pool.query("SELECT COUNT(*) AS jumlah FROM users WHERE role = 'admin'");
      const [target] = await pool.query("SELECT role FROM users WHERE id = ?", [targetId]);
      if (target[0]?.role === "admin" && jumlah <= 1) {
        return res.status(400).json({ message: "Minimal harus ada satu admin." });
      }
    }

    const [result] = await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, targetId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Akun tidak ditemukan." });

    res.json({ id: targetId, role, message: `Peran akun diubah menjadi ${role}.` });
  } catch (error) {
    next(error);
  }
}

async function updateUserPassword(req, res, next) {
  try {
    const targetId = Number(req.params.id);
    const password = req.body.password || "";

    if (!Number.isInteger(targetId) || targetId < 1) {
      return res.status(400).json({ message: "ID akun tidak valid." });
    }
    if (password.length < 12) {
      return res.status(400).json({ message: "Password baru minimal 12 karakter." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?", [passwordHash, targetId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Akun tidak ditemukan." });

    res.json({ id: targetId, message: "Password akun berhasil diperbarui." });
  } catch (error) {
    next(error);
  }
}

async function deleteUser(req, res, next) {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId < 1) {
      return res.status(400).json({ message: "ID akun tidak valid." });
    }
    if (targetId === req.user.id) {
      return res.status(400).json({ message: "Kamu tidak bisa menghapus akunmu sendiri." });
    }

    const [targets] = await pool.query(
      `SELECT u.role, COUNT(o.id) AS totalOrders
         FROM users u LEFT JOIN orders o ON o.user_id = u.id
        WHERE u.id = ? GROUP BY u.id, u.role`,
      [targetId]
    );
    if (!targets.length) return res.status(404).json({ message: "Akun tidak ditemukan." });
    if (targets[0].role === "admin") {
      const [[{ jumlah }]] = await pool.query("SELECT COUNT(*) AS jumlah FROM users WHERE role = 'admin'");
      if (jumlah <= 1) return res.status(400).json({ message: "Minimal harus ada satu admin." });
    }

    const [result] = await pool.query("DELETE FROM users WHERE id = ?", [targetId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Akun tidak ditemukan." });
    res.json({ id: targetId, message: "Akun dan data terkait berhasil dihapus." });
  } catch (error) {
    next(error);
  }
}

async function listReviews(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.order_id AS orderId, r.rating, r.comment, r.is_published AS isPublished, r.created_at AS createdAt,
              u.name AS customerName, o.order_code AS orderCode
         FROM product_reviews r JOIN users u ON u.id = r.user_id JOIN orders o ON o.id = r.order_id
        ORDER BY r.created_at DESC`
    );
    res.json(rows);
  } catch (error) { next(error); }
}

async function moderateReview(req, res, next) {
  try {
    const isPublished = Boolean(req.body.isPublished);
    const [result] = await pool.query("UPDATE product_reviews SET is_published = ? WHERE id = ?", [isPublished, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Ulasan tidak ditemukan." });
    res.json({ id: Number(req.params.id), isPublished, message: isPublished ? "Ulasan diterbitkan." : "Ulasan disembunyikan." });
  } catch (error) { next(error); }
}

// ------------------------------------------------------------------ voucher dan promo

function couponPayload(body) {
  const code = String(body.code || "").trim().toUpperCase();
  const discountType = body.discountType;
  const discountValue = Number(body.discountValue);
  const minimumOrder = Number(body.minimumOrder || 0);
  const usageLimit = body.usageLimit === "" || body.usageLimit === null || body.usageLimit === undefined ? null : Number(body.usageLimit);
  const startsAt = body.startsAt ? String(body.startsAt).replace("T", " ") : null;
  const endsAt = body.endsAt ? String(body.endsAt).replace("T", " ") : null;
  const errors = [];
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) errors.push("Kode voucher harus 3–40 karakter berupa huruf, angka, garis bawah, atau tanda minus.");
  if (!["percent", "fixed"].includes(discountType)) errors.push("Jenis diskon tidak valid.");
  if (!Number.isFinite(discountValue) || discountValue <= 0) errors.push("Nilai diskon harus lebih dari nol.");
  if (discountType === "percent" && discountValue > 100) errors.push("Diskon persen tidak boleh lebih dari 100%.");
  if (!Number.isFinite(minimumOrder) || minimumOrder < 0) errors.push("Minimum transaksi tidak valid.");
  if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) errors.push("Batas penggunaan harus berupa bilangan bulat positif.");
  if (startsAt && Number.isNaN(Date.parse(startsAt))) errors.push("Tanggal mulai tidak valid.");
  if (endsAt && Number.isNaN(Date.parse(endsAt))) errors.push("Tanggal selesai tidak valid.");
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) errors.push("Tanggal selesai harus setelah tanggal mulai.");
  return { code, discountType, discountValue, minimumOrder, usageLimit, startsAt, endsAt, isActive: body.isActive !== false, errors };
}

async function listCoupons(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, code, discount_type AS discountType, discount_value AS discountValue,
              minimum_order AS minimumOrder, usage_limit AS usageLimit, used_count AS usedCount,
              starts_at AS startsAt, ends_at AS endsAt, is_active AS isActive
         FROM coupons ORDER BY is_active DESC, id DESC`
    );
    res.json(rows);
  } catch (error) { next(error); }
}

async function createCoupon(req, res, next) {
  try {
    const coupon = couponPayload(req.body);
    if (coupon.errors.length) return res.status(400).json({ message: coupon.errors[0] });
    const [existing] = await pool.query("SELECT id FROM coupons WHERE code = ?", [coupon.code]);
    if (existing.length) return res.status(409).json({ message: "Kode voucher sudah digunakan." });
    const [result] = await pool.query(
      `INSERT INTO coupons (code, discount_type, discount_value, minimum_order, usage_limit, starts_at, ends_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [coupon.code, coupon.discountType, coupon.discountValue, coupon.minimumOrder, coupon.usageLimit, coupon.startsAt, coupon.endsAt, coupon.isActive ? 1 : 0]
    );
    res.status(201).json({ id: result.insertId, message: `Voucher ${coupon.code} berhasil dibuat.` });
  } catch (error) { next(error); }
}

async function updateCoupon(req, res, next) {
  try {
    const coupon = couponPayload(req.body);
    if (coupon.errors.length) return res.status(400).json({ message: coupon.errors[0] });
    const [currentRows] = await pool.query("SELECT code, used_count AS usedCount FROM coupons WHERE id = ?", [req.params.id]);
    if (!currentRows.length) return res.status(404).json({ message: "Voucher tidak ditemukan." });
    if (Number(currentRows[0].usedCount) > 0 && currentRows[0].code !== coupon.code) {
      return res.status(409).json({ message: "Kode voucher yang pernah dipakai tidak dapat diubah karena terhubung dengan riwayat transaksi." });
    }
    const [existing] = await pool.query("SELECT id FROM coupons WHERE code = ? AND id <> ?", [coupon.code, req.params.id]);
    if (existing.length) return res.status(409).json({ message: "Kode voucher sudah digunakan." });
    const [result] = await pool.query(
      `UPDATE coupons SET code = ?, discount_type = ?, discount_value = ?, minimum_order = ?,
              usage_limit = ?, starts_at = ?, ends_at = ?, is_active = ? WHERE id = ?`,
      [coupon.code, coupon.discountType, coupon.discountValue, coupon.minimumOrder, coupon.usageLimit, coupon.startsAt, coupon.endsAt, coupon.isActive ? 1 : 0, req.params.id]
    );
    res.json({ id: Number(req.params.id), message: `Voucher ${coupon.code} berhasil diperbarui.` });
  } catch (error) { next(error); }
}

async function deleteCoupon(req, res, next) {
  try {
    const [rows] = await pool.query("SELECT code, used_count AS usedCount FROM coupons WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: "Voucher tidak ditemukan." });
    if (Number(rows[0].usedCount) > 0) return res.status(409).json({ message: "Voucher yang pernah dipakai tidak dapat dihapus. Nonaktifkan voucher untuk menjaga riwayat transaksi." });
    await pool.query("DELETE FROM coupons WHERE id = ?", [req.params.id]);
    res.json({ id: Number(req.params.id), message: `Voucher ${rows[0].code} berhasil dihapus.` });
  } catch (error) { next(error); }
}

// ------------------------------------------------------------------ newsletter

async function listNewsletterSubscribers(req, res, next) {
  try {
    const q = String(req.query.q || "").trim();
    const page = Math.max(1, Math.min(10_000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const where = q ? "WHERE email LIKE ?" : "";
    const params = q ? [`%${q}%`] : [];
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM newsletter_subscribers ${where}`, params);
    const [items] = await pool.query(
      `SELECT id, email, created_at AS createdAt FROM newsletter_subscribers ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ items, page, limit, total: Number(total) });
  } catch (error) { next(error); }
}

async function removeNewsletterSubscriber(req, res, next) {
  try {
    const [result] = await pool.query("DELETE FROM newsletter_subscribers WHERE id = ?", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Subscriber tidak ditemukan." });
    res.json({ id: Number(req.params.id), message: "Subscriber dihapus dari newsletter." });
  } catch (error) { next(error); }
}

// ------------------------------------------------------------------ laporan penjualan

function reportPeriod(query) {
  const from = String(query.from || "").trim();
  const to = String(query.to || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  return { from, to };
}

async function salesReport(req, res, next) {
  try {
    const period = reportPeriod(req.query);
    if (!period) return res.status(400).json({ message: "Pilih rentang tanggal laporan yang valid." });
    const params = [period.from, period.to];
    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS totalOrders,
              COALESCE(SUM(CASE WHEN payment_status = 'Dibayar' AND status <> 'Dibatalkan' THEN total ELSE 0 END), 0) AS revenue,
              COUNT(CASE WHEN payment_status = 'Dibayar' AND status <> 'Dibatalkan' THEN 1 END) AS paidOrders,
              COUNT(CASE WHEN status = 'Dibatalkan' THEN 1 END) AS cancelledOrders
         FROM orders WHERE DATE(created_at) BETWEEN ? AND ?`, params
    );
    const [byDay] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date,
              COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN payment_status = 'Dibayar' AND status <> 'Dibatalkan' THEN total ELSE 0 END), 0) AS revenue
         FROM orders WHERE DATE(created_at) BETWEEN ? AND ?
         GROUP BY DATE(created_at) ORDER BY date`, params
    );
    const [byPaymentMethod] = await pool.query(
      `SELECT payment_method AS paymentMethod, COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN payment_status = 'Dibayar' AND status <> 'Dibatalkan' THEN total ELSE 0 END), 0) AS revenue
         FROM orders WHERE DATE(created_at) BETWEEN ? AND ?
         GROUP BY payment_method ORDER BY orders DESC`, params
    );
    const [topProducts] = await pool.query(
      `SELECT oi.product_name AS name, SUM(oi.quantity) AS sold,
              COALESCE(SUM(oi.line_total), 0) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE DATE(o.created_at) BETWEEN ? AND ?
          AND o.payment_status = 'Dibayar' AND o.status <> 'Dibatalkan'
        GROUP BY oi.product_name ORDER BY sold DESC, revenue DESC LIMIT 10`, params
    );
    const paidOrders = Number(summary.paidOrders) || 0;
    res.json({
      period,
      summary: { ...summary, averageOrder: paidOrders ? Number(summary.revenue) / paidOrders : 0 },
      byDay,
      byPaymentMethod,
      topProducts
    });
  } catch (error) { next(error); }
}

async function listAuditLogs(req, res, next) {
  try {
    const page = Math.max(1, Math.min(10_000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const [[{ total }]] = await pool.query("SELECT COUNT(*) AS total FROM admin_audit_logs");
    const [items] = await pool.query(
      `SELECT l.id, l.action, l.target_type AS targetType, l.target_id AS targetId,
              l.metadata, l.ip_address AS ipAddress, l.created_at AS createdAt,
              u.name AS actorName, u.email AS actorEmail
         FROM admin_audit_logs l JOIN users u ON u.id = l.actor_user_id
        ORDER BY l.created_at DESC LIMIT ? OFFSET ?`, [limit, offset]
    );
    res.json({ items, page, limit, total: Number(total) });
  } catch (error) { next(error); }
}

module.exports = {
  getStats,
  listAllOrders,
  updateOrderStatus,
  cancelOrder,
  deleteOrder,
  updatePaymentStatus,
  updateShipment,
  listCategoriesAdmin,
  createCategory,
  updateCategory,
  deleteCategory,
  listAllProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  listUsers,
  createUser,
  updateUser,
  updateUserRole,
  updateUserPassword,
  deleteUser,
  listReviews,
  moderateReview,
  listCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  couponPayload,
  listNewsletterSubscribers,
  removeNewsletterSubscriber,
  salesReport,
  reportPeriod,
  listAuditLogs,
  ORDER_STATUSES
};
