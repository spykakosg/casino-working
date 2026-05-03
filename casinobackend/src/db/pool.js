const { Pool } = require("pg");

const connectionString = (process.env.DATABASE_URL || "").trim();

const pool = new Pool({
  ...(connectionString
    ? { connectionString }
    : {
        host: process.env.PGHOST || "127.0.0.1",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "",
        database: process.env.PGDATABASE || "casino_db",
      }),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  if (err?.code === "28000") {
    console.error("Database auth failed (code 28000). Set DATABASE_URL or PGUSER/PGPASSWORD/PGDATABASE in .env.");
  } else {
    console.error("Unexpected DB error:", err);
  }
  process.exit(-1);
});

module.exports = pool;
