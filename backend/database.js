const Database = require("better-sqlite3");
const path = require("path");

// Database file
const dbPath = path.join(__dirname, "printvending.db");

const db = new Database(dbPath);


// Enable foreign keys
db.pragma("foreign_keys = ON");


// ==============================
// CREATE ORDERS TABLE
// ==============================

db.prepare(`
    CREATE TABLE IF NOT EXISTS orders (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        order_id TEXT UNIQUE NOT NULL,

        file_name TEXT NOT NULL,

        file_path TEXT NOT NULL,

        page_count INTEGER NOT NULL,

        print_mode TEXT NOT NULL,

        price_per_page REAL NOT NULL,

        total_amount REAL NOT NULL,

        payment_status TEXT DEFAULT 'PENDING',

        print_status TEXT DEFAULT 'WAITING',

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        completed_at DATETIME,
	razorpay_order_id TEXT

    )
`).run();
		// ==============================
// ADD PAYMENT COLUMNS IF MISSING
// ==============================

try {

    db.prepare(`
        ALTER TABLE orders
        ADD COLUMN razorpay_payment_id TEXT
    `).run();

} catch (error) {

    if (
        !error.message.includes(
            "duplicate column name"
        )
    ) {

        console.error(
            "razorpay_payment_id migration error:",
            error.message
        );

    }

}


try {

    db.prepare(`
        ALTER TABLE orders
        ADD COLUMN razorpay_signature TEXT
    `).run();

} catch (error) {

    if (
        !error.message.includes(
            "duplicate column name"
        )
    ) {

        console.error(
            "razorpay_signature migration error:",
            error.message
        );

    }

}
// ==========================================
// DATABASE MIGRATIONS
// ==========================================

try {
    db.prepare(`
        ALTER TABLE orders
        ADD COLUMN razorpay_order_id TEXT
    `).run();

    console.log("Added razorpay_order_id column");

} catch (error) {

    if (!error.message.includes("duplicate column name")) {
        console.error(
            "razorpay_order_id migration error:",
            error.message
        );
    }
}


try {
    db.prepare(`
        ALTER TABLE orders
        ADD COLUMN razorpay_payment_id TEXT
    `).run();

    console.log("Added razorpay_payment_id column");

} catch (error) {

    if (!error.message.includes("duplicate column name")) {
        console.error(
            "razorpay_payment_id migration error:",
            error.message
        );
    }
}


try {
    db.prepare(`
        ALTER TABLE orders
        ADD COLUMN razorpay_signature TEXT
    `).run();

    console.log("Added razorpay_signature column");

} catch (error) {

    if (!error.message.includes("duplicate column name")) {
        console.error(
            "razorpay_signature migration error:",
            error.message
        );
    }
}
console.log("Database connected successfully.");


// Export database
module.exports = db;