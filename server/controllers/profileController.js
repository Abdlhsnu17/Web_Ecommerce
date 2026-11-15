const { pool } = require("../config/db");

function profile(row = {}) {
  return {
    defaultAddress: row.default_address || "",
    defaultCity: row.default_city || "",
    defaultZip: row.default_zip || ""
  };
}

async function getProfile(req, res, next) {
  try {
    const [rows] = await pool.query("SELECT * FROM customer_profiles WHERE user_id = ?", [req.user.id]);
    res.json(profile(rows[0]));
  } catch (error) { next(error); }
}

async function updateProfile(req, res, next) {
  try {
    const data = profile({
      default_address: String(req.body.defaultAddress || "").trim(),
      default_city: String(req.body.defaultCity || "").trim(),
      default_zip: String(req.body.defaultZip || "").trim()
    });
    await pool.query(
      `INSERT INTO customer_profiles (user_id, default_address, default_city, default_zip)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE default_address = VALUES(default_address), default_city = VALUES(default_city), default_zip = VALUES(default_zip)`,
      [req.user.id, data.defaultAddress || null, data.defaultCity || null, data.defaultZip || null]
    );
    res.json({ ...data, message: "Alamat pengiriman berhasil disimpan." });
  } catch (error) { next(error); }
}

module.exports = { getProfile, updateProfile };
