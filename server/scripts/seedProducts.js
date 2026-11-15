require("dotenv").config();

const { ensureProductCatalog } = require("../services/productCatalogBootstrap");
const { pool } = require("../config/db");

ensureProductCatalog()
  .then(() => console.log("Katalog produk siap."))
  .catch(error => {
    console.error("Gagal menyiapkan katalog:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
