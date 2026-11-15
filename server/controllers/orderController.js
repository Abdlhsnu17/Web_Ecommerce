const { pool } = require("../config/db");
const fs = require("fs/promises");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { findOrCreateCart } = require("./cartController");
const { createQris, getStatus, verifyNotification, localStatus, integerAmount } = require("../services/midtransQris");
const { notifyOrderUpdate } = require("../services/orderMailer");
const { SECRET } = require("../middleware/auth");

const SHIPPING_COST = { regular: 0, express: 0 };
const PAYMENT_METHODS = ["QRIS", "Transfer Bank", "Tunai"];
const DEFAULT_PAYMENT_DETAILS = Object.freeze({
  bankName: process.env.BANK_NAME || "Bank Mandiri",
  bankAccountNumber: process.env.BANK_ACCOUNT_NUMBER || "9000050103739",
  bankAccountHolder: process.env.BANK_ACCOUNT_HOLDER || "HAFSAH QUROTUN AINI",
  // URL gambar QRIS merchant yang diterbitkan penyedia pembayaran.
  qrisImageUrl: process.env.QRIS_IMAGE_URL || ""
});
const QRIS_PAYMENT_MINUTES = Math.max(5, Number(process.env.QRIS_PAYMENT_MINUTES) || 30);
const TRANSFER_PAYMENT_HOURS = Math.max(1, Number(process.env.TRANSFER_PAYMENT_HOURS) || 24);

async function getPaymentDetails() {
  try {
    const [rows] = await pool.query(
      `SELECT bank_name AS bankName, bank_account_number AS bankAccountNumber,
              bank_account_holder AS bankAccountHolder
         FROM payment_settings WHERE id = 1`
    );
    return { ...DEFAULT_PAYMENT_DETAILS, ...(rows[0] || {}) };
  } catch (error) {
    // Tetap kompatibel ketika migrasi belum sempat dijalankan.
    if (error.code === "ER_NO_SUCH_TABLE") return DEFAULT_PAYMENT_DETAILS;
    throw error;
  }
}

// Dilempar dari dalam transaksi supaya rollback selalu jalan sebelum dibalas ke klien.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function buildOrderCode() {
  return `ESHOP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function recoveryToken(orderId) {
  return jwt.sign({ orderId: Number(orderId), purpose: "guest-order" }, SECRET, { expiresIn: "365d" });
}

function recoveryOrderId(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    return payload.purpose === "guest-order" && Number.isInteger(Number(payload.orderId)) ? Number(payload.orderId) : null;
  } catch {
    return null;
  }
}

function orderAccess(req) {
  const token = String(req.get("X-Order-Token") || "");
  const orderId = recoveryOrderId(token);
  const clauses = [];
  const values = [];

  if (req.user) { clauses.push("user_id = ?"); values.push(req.user.id); }
  if (/^[a-f0-9]{64}$/.test(token)) { clauses.push("guest_access_token_hash = ?"); values.push(tokenHash(token)); }
  if (orderId) { clauses.push("id = ?"); values.push(orderId); }

  return clauses.length ? { clause: `(${clauses.join(" OR ")})`, values } : null;
}

function listOrderAccess(req) {
  const tokens = String(req.get("X-Order-Tokens") || "").split(",").filter(Boolean).slice(0, 20);
  const hashes = tokens.filter(token => /^[a-f0-9]{64}$/.test(token)).map(tokenHash);
  const orderIds = tokens.map(recoveryOrderId).filter(Boolean);
  const clauses = [];
  const values = [];

  // Pengguna yang sedang login tetap dapat memulihkan pesanan tamu melalui
  // kode pesanan + nomor WhatsApp. Token pemulihan sudah diverifikasi di atas.
  if (req.user) { clauses.push("user_id = ?"); values.push(req.user.id); }
  if (hashes.length) { clauses.push(`guest_access_token_hash IN (${hashes.map(() => "?").join(",")})`); values.push(...hashes); }
  if (orderIds.length) { clauses.push(`id IN (${orderIds.map(() => "?").join(",")})`); values.push(...orderIds); }

  return clauses.length ? { whereClause: `(${clauses.join(" OR ")})`, values } : null;
}

function normalizedPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0062")) digits = digits.slice(2);
  if (digits.startsWith("620")) digits = `62${digits.slice(3)}`;
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return digits;
}

function normalizedOrderCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, "");
}

async function lookupOrder(req, res, next) {
  try {
    const orderCode = normalizedOrderCode(req.body.orderCode);
    const phone = normalizedPhone(req.body.phone);
    if (!/^ESHOP-[A-Z0-9-]{6,40}$/.test(orderCode) || phone.length < 9) {
      return res.status(400).json({ message: "Kode pesanan atau nomor WhatsApp tidak valid." });
    }
    const [rows] = await pool.query(
      "SELECT id, order_code AS orderCode, recipient_phone AS recipientPhone FROM orders WHERE order_code = ? LIMIT 1",
      [orderCode]
    );
    const order = rows[0];
    const actual = normalizedPhone(order?.recipientPhone);
    const matches = order && actual.length === phone.length
      && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(phone));
    if (!matches) return res.status(404).json({ message: "Pesanan tidak ditemukan. Periksa kembali kode dan nomor WhatsApp." });
    res.json({ id: order.id, orderCode: order.orderCode, accessToken: recoveryToken(order.id) });
  } catch (error) {
    next(error);
  }
}

function paymentDetails(details, order = {}) {
  const gateway = order.paymentGateway || "";
  return {
    ...details,
    qrisImageUrl: order.qrisUrl || details.qrisImageUrl || "",
    qrisAutomatic: gateway === "midtrans"
  };
}

/** Kembalikan stok pesanan yang kedaluwarsa dan belum dibayar. */
async function expirePendingOrders() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [orders] = await connection.query(
      `SELECT id, discount_code AS discountCode FROM orders
        WHERE payment_status = 'Menunggu pembayaran'
          AND payment_due_at IS NOT NULL AND payment_due_at <= NOW()
        FOR UPDATE`
    );
    for (const order of orders) {
      const [result] = await connection.query(
        `UPDATE orders SET payment_status = 'Kedaluwarsa', status = 'Dibatalkan',
                payment_updated_at = NOW()
          WHERE id = ? AND payment_status = 'Menunggu pembayaran'`, [order.id]
      );
      if (!result.affectedRows) continue;
      const [items] = await connection.query(
        "SELECT product_id AS productId, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL", [order.id]
      );
      for (const item of items) {
        await connection.query("UPDATE products SET stock = stock + ? WHERE id = ?", [item.quantity, item.productId]);
      }
      if (order.discountCode) {
        await connection.query("UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE code = ?", [order.discountCode]);
      }
    }
    await connection.commit();
    return orders.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function applyGatewayStatus(connection, order, gatewayPayload) {
  if (integerAmount(Number(gatewayPayload.gross_amount)) !== integerAmount(Number(order.total))) {
    throw new HttpError(400, "Nominal notifikasi pembayaran tidak sesuai dengan pesanan.");
  }
  const nextStatus = localStatus(gatewayPayload);
  // Status lunas tidak boleh mundur bila notifikasi lama datang terlambat.
  if (order.paymentStatus === "Dibayar" && nextStatus !== "Dibayar") return "Dibayar";
  await connection.query(
    `UPDATE orders SET payment_status = ?, payment_updated_at = NOW(),
            status = CASE
              WHEN ? = 'Dibayar' AND status = 'Menunggu pembayaran' THEN 'Diproses'
              ELSE status END,
            payment_due_at = IF(? = 'Dibayar', NULL, payment_due_at),
            gateway_transaction_id = COALESCE(gateway_transaction_id, ?)
      WHERE id = ?`,
    [nextStatus, nextStatus, nextStatus, gatewayPayload.transaction_id || null, order.id]
  );
  return nextStatus;
}

async function createOrder(req, res, next) {
  const {
    shippingMethod = "regular",
    paymentMethod,
    recipientName,
    recipientEmail,
    recipientPhone,
    address,
    city,
    zip,
    notes,
    couponCode
  } = req.body;

  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ message: "Metode pembayaran tidak dikenali." });
  }
  if (!Object.hasOwn(SHIPPING_COST, shippingMethod)) {
    return res.status(400).json({ message: "Metode pengiriman tidak dikenali." });
  }
  const cleanEmail = String(recipientEmail || "").trim();
  const cleanPhone = String(recipientPhone || "").replace(/[^0-9+]/g, "");
  const cleanRecipientName = String(recipientName || "").trim();
  if (!cleanRecipientName || !cleanPhone || !String(address || "").trim()) {
    return res.status(400).json({ message: "Nama penerima, nomor telepon, dan alamat pengiriman wajib diisi." });
  }
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ message: "Format email tidak valid." });
  }

  await expirePendingOrders();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Isi keranjang dan harga diambil langsung dari database, bukan dari browser.
    const cartId = await findOrCreateCart(req, connection);
    const [lines] = await connection.query(
      `SELECT p.id, p.name, p.image, p.price, p.stock, ci.quantity AS qty
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
        WHERE ci.cart_id = ? AND p.is_active = 1
        FOR UPDATE`,
      [cartId]
    );

    if (!lines.length) throw new HttpError(400, "Keranjang masih kosong.");

    let subtotal = 0;
    for (const line of lines) {
      if (line.stock < line.qty) {
        throw new HttpError(409, `Stok ${line.name} tinggal ${line.stock}.`);
      }
      subtotal += line.price * line.qty;
    }

    const shippingCost = SHIPPING_COST[shippingMethod];
    let discountAmount = 0;
    let appliedCoupon = null;
    const normalizedCoupon = String(couponCode || "").trim().toUpperCase();
    if (normalizedCoupon) {
      const [coupons] = await connection.query(
        `SELECT id, code, discount_type AS discountType, discount_value AS discountValue,
                minimum_order AS minimumOrder, usage_limit AS usageLimit, used_count AS usedCount
           FROM coupons WHERE code = ? AND is_active = 1
             AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) FOR UPDATE`,
        [normalizedCoupon]
      );
      const coupon = coupons[0];
      if (!coupon || (coupon.usageLimit !== null && Number(coupon.usedCount) >= Number(coupon.usageLimit))) throw new HttpError(400, "Voucher tidak aktif atau kuotanya telah habis.");
      if (subtotal < Number(coupon.minimumOrder)) throw new HttpError(400, `Voucher berlaku untuk transaksi minimal ${coupon.minimumOrder}.`);
      discountAmount = coupon.discountType === "percent" ? subtotal * Number(coupon.discountValue) / 100 : Number(coupon.discountValue);
      discountAmount = Math.min(discountAmount, subtotal);
      appliedCoupon = coupon;
    }
    const orderCode = buildOrderCode();

    const initialOrderStatus = paymentMethod === "Tunai" ? "Diproses" : "Menunggu pembayaran";
    // Buat dan bandingkan tenggat memakai jam database yang sama. Mengirim objek
    // Date dari Node dapat bergeser ketika timezone proses aplikasi berbeda dari
    // timezone MySQL (misalnya Node UTC, MySQL Asia/Jakarta), sehingga pesanan
    // QRIS yang baru dibuat langsung dianggap kedaluwarsa.
    const paymentDeadlineMinutes = paymentMethod === "QRIS"
      ? QRIS_PAYMENT_MINUTES
      : paymentMethod === "Transfer Bank" ? TRANSFER_PAYMENT_HOURS * 60 : null;
    // Akses pembayaran tidak boleh bergantung pada sesi login. Token pesanan
    // selalu dibuat, termasuk bila browser masih membawa cookie akun lama,
    // agar QRIS tetap dapat dipantau setelah pengguna keluar atau fitur akun
    // tidak lagi ditampilkan.
    const guestAccessToken = crypto.randomBytes(32).toString("hex");
    const [orderResult] = await connection.query(
      `INSERT INTO orders
        (order_code, user_id, guest_access_token_hash, status, subtotal, discount_code, discount_amount, shipping_cost, total, shipping_method, payment_method, payment_due_at,
         recipient_name, recipient_email, recipient_phone, shipping_address, shipping_city, shipping_zip, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               IF(? IS NULL, NULL, DATE_ADD(NOW(), INTERVAL ? MINUTE)),
               ?, ?, ?, ?, ?, ?, ?)` ,
      [
        orderCode, req.user?.id || null, tokenHash(guestAccessToken), initialOrderStatus, subtotal, appliedCoupon?.code || null, discountAmount, shippingCost, subtotal - discountAmount + shippingCost,
        shippingMethod, paymentMethod, paymentDeadlineMinutes, paymentDeadlineMinutes,
        cleanRecipientName, cleanEmail || null, cleanPhone,
        address, city || null, zip || null, notes || null
      ]
    );
    if (appliedCoupon) await connection.query("UPDATE coupons SET used_count = used_count + 1 WHERE id = ?", [appliedCoupon.id]);

    await connection.query(
      `INSERT INTO order_items (order_id, product_id, product_name, product_image, unit_price, quantity)
       VALUES ?`,
      [lines.map(line => [orderResult.insertId, line.id, line.name, line.image, line.price, line.qty])]
    );

    for (const line of lines) {
      await connection.query("UPDATE products SET stock = stock - ? WHERE id = ?", [line.qty, line.id]);
    }

    let qris = null;
    if (paymentMethod === "QRIS") {
      const staticQrisUrl = process.env.QRIS_IMAGE_URL?.trim();
      if (process.env.MIDTRANS_SERVER_KEY?.trim()) {
        qris = await createQris({
          orderCode,
      total: subtotal - discountAmount + shippingCost,
          discountAmount,
          items: [
            ...lines.map(line => ({ id: line.id, name: line.name, price: Number(line.price), qty: line.qty })),
            ...(shippingCost ? [{ id: "shipping", name: "Ongkos kirim", price: shippingCost, qty: 1 }] : [])
          ],
          customer: { name: cleanRecipientName, email: cleanEmail, phone: cleanPhone }
        });
        await connection.query(
          `UPDATE orders SET payment_gateway = 'midtrans', payment_reference = ?, gateway_transaction_id = ?, qris_url = ? WHERE id = ?`,
          [orderCode, qris.transactionId, qris.qrUrl, orderResult.insertId]
        );
      } else if (staticQrisUrl) {
        qris = { qrUrl: staticQrisUrl, automatic: false };
        await connection.query(
          `UPDATE orders SET payment_gateway = 'static-qris', qris_url = ? WHERE id = ?`,
          [staticQrisUrl, orderResult.insertId]
        );
      } else {
        throw new HttpError(503, "Gambar QRIS belum dipasang. Simpan gambar QRIS dan isi QRIS_IMAGE_URL, atau konfigurasi Midtrans.");
      }
    }

    // Keranjang dikosongkan di transaksi yang sama dengan pembuatan pesanan.
    await connection.query("DELETE FROM cart_items WHERE cart_id = ?", [cartId]);

    const [[deadline]] = await connection.query(
      "SELECT payment_due_at AS paymentDueAt FROM orders WHERE id = ?",
      [orderResult.insertId]
    );
    const paymentDueAt = deadline?.paymentDueAt || null;

    await connection.commit();
    if (cleanEmail) notifyOrderUpdate({
      to: cleanEmail,
      recipientName: cleanRecipientName,
      orderCode,
      subject: `Pesanan ${orderCode} diterima`,
      message: "Pesanan Anda sudah kami terima. Silakan selesaikan pembayaran sesuai metode yang dipilih.",
      details: [`Metode pembayaran: ${paymentMethod}`, `Metode pengiriman: ${shippingMethod}`]
    });
    const details = await getPaymentDetails();
    res.status(201).json({
      id: orderResult.insertId,
      accessToken: guestAccessToken,
      orderCode,
      subtotal,
      shippingCost,
        total: subtotal - discountAmount + shippingCost,
      status: initialOrderStatus,
      paymentStatus: paymentMethod === "Tunai" ? "Dibayar" : "Menunggu pembayaran",
      paymentDueAt,
      paymentMethod,
      paymentDetails: paymentDetails(details, {
        qrisUrl: qris?.qrUrl,
        paymentGateway: qris?.automatic === false ? "static-qris" : paymentMethod === "QRIS" ? "midtrans" : ""
      })
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    next(error);
  } finally {
    connection.release();
  }
}

/** Ganti QRIS <-> transfer hanya selama pembayaran belum dilakukan. */
async function changePaymentMethod(req, res, next) {
  try {
    await expirePendingOrders();
  } catch (error) {
    return next(error);
  }
  const access = orderAccess(req);
  if (!access) return res.status(401).json({ message: "Akses pesanan tidak valid." });
  const paymentMethod = String(req.body.paymentMethod || "");
  if (!["QRIS", "Transfer Bank"].includes(paymentMethod)) {
    return res.status(400).json({ message: "Metode hanya dapat diganti antara QRIS dan Transfer Bank." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, order_code AS orderCode, total, discount_amount AS discountAmount,
              payment_method AS paymentMethod, payment_status AS paymentStatus,
              recipient_name AS recipientName, recipient_email AS recipientEmail,
              recipient_phone AS recipientPhone
         FROM orders WHERE id = ? AND ${access.clause} FOR UPDATE`,
      [req.params.id, ...access.values]
    );
    const order = rows[0];
    if (!order) throw new HttpError(404, "Pesanan tidak ditemukan.");
    if (order.paymentStatus !== "Menunggu pembayaran") {
      throw new HttpError(409, "Metode tidak dapat diganti karena pembayaran sudah diproses atau pesanan tidak aktif.");
    }
    if (order.paymentMethod === paymentMethod) {
      throw new HttpError(409, `Metode pembayaran sudah menggunakan ${paymentMethod}.`);
    }
    if (!["QRIS", "Transfer Bank"].includes(order.paymentMethod)) {
      throw new HttpError(409, "Metode pembayaran pesanan ini tidak dapat diganti.");
    }

    let qris = null;
    let paymentReference = null;
    let deadlineMinutes = TRANSFER_PAYMENT_HOURS * 60;
    if (paymentMethod === "QRIS") {
      deadlineMinutes = QRIS_PAYMENT_MINUTES;
      const staticQrisUrl = process.env.QRIS_IMAGE_URL?.trim();
      if (process.env.MIDTRANS_SERVER_KEY?.trim()) {
        paymentReference = `${order.orderCode}-P${Date.now().toString(36).toUpperCase()}`;
        qris = await createQris({
          orderCode: paymentReference,
          total: Number(order.total),
          items: [{ id: `order-${order.id}`, name: `Pesanan ${order.orderCode}`, price: Number(order.total), qty: 1 }],
          customer: { name: order.recipientName, email: order.recipientEmail, phone: order.recipientPhone }
        });
      } else if (staticQrisUrl) {
        qris = { qrUrl: staticQrisUrl, automatic: false };
      } else {
        throw new HttpError(503, "Gambar QRIS belum dipasang. Hubungi pengelola atau tetap gunakan transfer bank.");
      }
    }

    await connection.query(
      `UPDATE orders SET payment_method = ?,
              payment_due_at = DATE_ADD(NOW(), INTERVAL ? MINUTE), payment_updated_at = NOW(),
              payment_gateway = ?, payment_reference = ?, gateway_transaction_id = ?, qris_url = ?,
              payment_proof_url = NULL, payment_proof_uploaded_at = NULL
        WHERE id = ?`,
      [paymentMethod, deadlineMinutes,
        paymentMethod === "QRIS" ? (qris.automatic === false ? "static-qris" : "midtrans") : null,
        paymentReference, qris?.transactionId || null, qris?.qrUrl || null, order.id]
    );
    const [[deadline]] = await connection.query(
      "SELECT payment_due_at AS paymentDueAt FROM orders WHERE id = ?",
      [order.id]
    );
    const dueAt = deadline.paymentDueAt;
    await connection.commit();
    const details = await getPaymentDetails();
    if (order.recipientEmail) notifyOrderUpdate({
      to: order.recipientEmail,
      recipientName: order.recipientName,
      orderCode: order.orderCode,
      subject: `Metode pembayaran ${order.orderCode} diubah`,
      message: `Metode pembayaran Anda telah diubah menjadi ${paymentMethod}.`,
      details: ["Gunakan hanya instruksi pembayaran terbaru pada halaman pesanan."]
    });
    res.json({
      id: order.id,
      paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentDueAt: dueAt,
      paymentDetails: paymentDetails(details, {
        qrisUrl: qris?.qrUrl,
        paymentGateway: paymentMethod === "QRIS" ? (qris.automatic === false ? "static-qris" : "midtrans") : ""
      }),
      message: `Metode pembayaran berhasil diganti ke ${paymentMethod}.`
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof HttpError) return res.status(error.status).json({ message: error.message });
    next(error);
  } finally {
    connection.release();
  }
}

async function discardUploadedFile(file) {
  if (file?.path) await fs.unlink(file.path).catch(() => {});
}

/** Bukti transfer/QRIS statis hanya mengajukan verifikasi; pelanggan tidak dapat melunasi order sendiri. */
async function uploadPaymentProof(req, res, next) {
  try {
    await expirePendingOrders();
    const access = orderAccess(req);
    if (!access) { await discardUploadedFile(req.file); return res.status(401).json({ message: "Akses pesanan tidak valid." }); }
    const [orders] = await pool.query(
      `SELECT id, order_code AS orderCode, total, payment_method AS paymentMethod,
              payment_status AS paymentStatus, payment_gateway AS paymentGateway
         FROM orders WHERE id = ? AND ${access.clause}`,
      [req.params.id, ...access.values]
    );
    const order = orders[0];
    if (!order) { await discardUploadedFile(req.file); return res.status(404).json({ message: "Pesanan tidak ditemukan." }); }
    const acceptsProof = order.paymentMethod === "Transfer Bank"
      || (order.paymentMethod === "QRIS" && order.paymentGateway === "static-qris");
    if (!acceptsProof) { await discardUploadedFile(req.file); return res.status(400).json({ message: "Pembayaran ini dikonfirmasi otomatis dan tidak memerlukan bukti." }); }
    if (!req.file) return res.status(400).json({ message: "Pilih foto bukti pembayaran." });
    if (order.paymentStatus === "Dibayar") { await discardUploadedFile(req.file); return res.status(409).json({ message: "Pembayaran sudah dikonfirmasi." }); }
    if (order.paymentStatus !== "Menunggu pembayaran") {
      await discardUploadedFile(req.file);
      return res.status(409).json({ message: `Bukti tidak dapat dikirim karena status pembayaran ${order.paymentStatus}.` });
    }
    await pool.query(
      `UPDATE orders SET payment_status = 'Menunggu verifikasi', payment_proof_url = ?,
              payment_proof_uploaded_at = NOW(), payment_updated_at = NOW(), payment_due_at = NULL
        WHERE id = ?`, [`/uploads/${req.file.filename}`, order.id]
    );
    res.json({ id: order.id, paymentStatus: "Menunggu verifikasi", message: "Bukti pembayaran terkirim dan sedang diverifikasi admin." });
  } catch (error) {
    await discardUploadedFile(req.file);
    next(error);
  }
}

async function listOrders(req, res, next) {
  try {
    await expirePendingOrders();
    const access = listOrderAccess(req);
    if (!access) return res.json([]);
    const { whereClause, values } = access;
    const [orders] = await pool.query(
            `SELECT id, order_code AS orderCode, status, subtotal, shipping_cost AS shippingCost,
      total, shipping_method AS shippingMethod, payment_method AS paymentMethod,
              payment_status AS paymentStatus, payment_gateway AS paymentGateway,
              qris_url AS qrisUrl, payment_due_at AS paymentDueAt,
              payment_proof_url AS paymentProofUrl,
              recipient_name AS recipientName, recipient_email AS recipientEmail,
              recipient_phone AS recipientPhone, shipping_address AS shippingAddress,
              shipping_city AS shippingCity, shipping_zip AS shippingZip,
              EXISTS(SELECT 1 FROM product_reviews sr WHERE sr.order_id = orders.id) AS hasReview,
              tracking_number AS trackingNumber, shipped_at AS shippedAt,
              created_at AS createdAt
         FROM orders WHERE ${whereClause} ORDER BY created_at DESC`,
      values
    );
    if (!orders.length) return res.json([]);

    const [items] = await pool.query(
      `SELECT order_id AS orderId, product_id AS productId, product_name AS name,
              product_image AS image, unit_price AS price, quantity AS qty, line_total AS lineTotal
         FROM order_items WHERE order_id IN (${orders.map(() => "?").join(",")})`,
      orders.map(order => order.id)
    );

    const grouped = new Map(orders.map(order => [order.id, { ...order, items: [] }]));
    items.forEach(item => grouped.get(item.orderId)?.items.push(item));
    const details = await getPaymentDetails();
    res.json([...grouped.values()].map(order => ({ ...order, paymentDetails: paymentDetails(details, order) })));
  } catch (error) {
    next(error);
  }
}

async function refreshPayment(req, res, next) {
  try {
    await expirePendingOrders();
    const access = orderAccess(req);
    if (!access) return res.status(401).json({ message: "Akses pesanan tidak valid." });
    const [rows] = await pool.query(
      `SELECT id, order_code AS orderCode, total, payment_method AS paymentMethod,
              payment_status AS paymentStatus, payment_gateway AS paymentGateway,
              payment_reference AS paymentReference
         FROM orders WHERE id = ? AND ${access.clause}`,
      [req.params.id, ...access.values]
    );
    const order = rows[0];
    if (!order) return res.status(404).json({ message: "Pesanan tidak ditemukan." });
    if (order.paymentMethod !== "QRIS" || order.paymentGateway !== "midtrans" || order.paymentStatus !== "Menunggu pembayaran") {
      return res.json({ id: order.id, paymentStatus: order.paymentStatus });
    }
    const gatewayPayload = await getStatus(order.paymentReference || order.orderCode);
    const paymentStatus = await applyGatewayStatus(pool, order, gatewayPayload);
    res.json({ id: order.id, paymentStatus });
  } catch (error) {
    next(error);
  }
}

async function midtransNotification(req, res, next) {
  try {
    if (!verifyNotification(req.body)) return res.status(401).json({ message: "Tanda tangan notifikasi tidak valid." });
    const [rows] = await pool.query(
      `SELECT id, total, payment_status AS paymentStatus FROM orders
        WHERE COALESCE(payment_reference, order_code) = ? AND payment_method = 'QRIS'`,
      [req.body.order_id]
    );
    const order = rows[0];
    if (!order) return res.status(404).json({ message: "Pesanan tidak ditemukan." });
    const paymentStatus = await applyGatewayStatus(pool, order, req.body);
    res.json({ received: true, paymentStatus });
  } catch (error) {
    next(error);
  }
}

module.exports = { createOrder, lookupOrder, listOrders, changePaymentMethod, uploadPaymentProof, refreshPayment, midtransNotification, expirePendingOrders, orderAccess, listOrderAccess, SHIPPING_COST };
