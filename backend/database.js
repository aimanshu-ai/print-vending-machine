// ==========================================
// PRINT VENDING - POSTGRESQL DATABASE
// ==========================================

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    throw new Error("DATABASE_URL environment variable is required.");
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});

pool.on("error", (error) => {
    console.error("PostgreSQL pool error:", error);
});

async function initDatabase() {

    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            order_id TEXT UNIQUE NOT NULL,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            page_count INTEGER NOT NULL,
            print_mode TEXT NOT NULL,
            price_per_page NUMERIC(10,2) NOT NULL,
            total_amount NUMERIC(10,2) NOT NULL,
            payment_status TEXT DEFAULT 'PENDING',
            print_status TEXT DEFAULT 'WAITING',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            razorpay_order_id TEXT,
            razorpay_payment_id TEXT,
            razorpay_signature TEXT
        )
    `);

    console.log("PostgreSQL database connected successfully.");
    console.log("Orders table is ready.");
}

async function query(text, params = []) {
    return pool.query(text, params);
}

module.exports = {
    pool,
    query,
    initDatabase
};
