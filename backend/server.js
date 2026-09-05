// ==========================================
// PRINT VENDING BACKEND - POSTGRESQL
// ==========================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const db = require("./database");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ==========================================
// RAZORPAY
// ==========================================

const Razorpay = require("razorpay");

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ==========================================
// EXPRESS
// ==========================================

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==========================================
// UPLOAD FOLDER
// ==========================================

const uploadFolder = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder, { recursive: true });
}

// ==========================================
// MULTER
// ==========================================

const storage = multer.diskStorage({

    destination: function (req, file, cb) {
        cb(null, uploadFolder);
    },

    filename: function (req, file, cb) {

        const uniqueName =
            Date.now() +
            "-" +
            Math.round(Math.random() * 100000) +
            path.extname(file.originalname);

        cb(null, uniqueName);
    }
});

const upload = multer({

    storage: storage,

    limits: {
        fileSize: 20 * 1024 * 1024
    },

    fileFilter: function (req, file, cb) {

        if (file.mimetype === "application/pdf") {
            cb(null, true);
        } else {
            cb(new Error("Only PDF files are allowed"));
        }
    }
});

// ==========================================
// PRINT QUEUE
// ==========================================

const printQueue = [];

let isPrinting = false;

// ==========================================
// HOME
// ==========================================

app.get("/", (req, res) => {

    res.json({
        message: "Print Vending Backend is running!",
        status: "online"
    });

});

// ==========================================
// TEST API
// ==========================================

app.get("/api/test", (req, res) => {

    res.json({
        success: true,
        message: "Backend connection successful"
    });

});

// ==========================================
// PDF UPLOAD
// ==========================================

app.post(
    "/api/upload-pdf",
    upload.single("pdf"),
    (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    message: "PDF file is required"
                });

            }

            console.log("PDF Uploaded:");

            console.log({
                originalName: req.file.originalname,
                savedName: req.file.filename,
                size: req.file.size
            });

            res.json({

                success: true,

                message: "PDF uploaded successfully",

                file: {

                    originalName: req.file.originalname,

                    savedName: req.file.filename,

                    size: req.file.size,

                    path: req.file.path
                }
            });

        } catch (error) {

            console.error(
                "PDF upload error:",
                error
            );

            res.status(500).json({

                success: false,

                message: "PDF upload failed"
            });
        }
    }
);

// ==========================================
// CREATE LOCAL ORDER
// ==========================================

app.post(
    "/api/orders",
    async (req, res) => {

        try {

            const {
                fileName,
                filePath,
                pageCount,
                printMode,
                pricePerPage,
                totalAmount
            } = req.body;

            // ------------------------------------------
            // VALIDATION
            // ------------------------------------------

            if (
                !fileName ||
                !filePath ||
                !pageCount ||
                !printMode ||
                pricePerPage === undefined ||
                totalAmount === undefined
            ) {

                return res.status(400).json({

                    success: false,

                    message: "Missing order information"
                });
            }

            // ------------------------------------------
            // PRINT MODE
            // ------------------------------------------

            if (
                printMode !== "bw" &&
                printMode !== "color"
            ) {

                return res.status(400).json({

                    success: false,

                    message: "Invalid print mode"
                });
            }

            // ------------------------------------------
            // ORDER ID
            // ------------------------------------------

            const orderId =
                "ORD-" +
                Date.now() +
                "-" +
                Math.floor(Math.random() * 1000);

            // ------------------------------------------
            // INSERT ORDER
            // ------------------------------------------

            const result = await db.query(
                `
                INSERT INTO orders (
                    order_id,
                    file_name,
                    file_path,
                    page_count,
                    print_mode,
                    price_per_page,
                    total_amount,
                    payment_status,
                    print_status
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    'PENDING',
                    'WAITING'
                )
                RETURNING *
                `,
                [
                    orderId,
                    fileName,
                    filePath,
                    pageCount,
                    printMode,
                    pricePerPage,
                    totalAmount
                ]
            );

            const order = result.rows[0];

            console.log("Order saved in PostgreSQL:");

            console.log(order);

            res.json({

                success: true,

                message: "Order created successfully",

                order: order
            });

        } catch (error) {

            console.error(
                "Order creation error:",
                error
            );

            res.status(500).json({

                success: false,

                message: "Failed to create order",

                error: error.message
            });
        }
    }
);

// ==========================================
// CREATE RAZORPAY PAYMENT ORDER
// ==========================================

app.post(
    "/api/payment/create",
    async (req, res) => {

        try {

            const {
                orderId
            } = req.body;

            if (!orderId) {

                return res.status(400).json({

                    success: false,

                    message: "Order ID is required"
                });
            }

            // ------------------------------------------
            // FIND LOCAL ORDER
            // ------------------------------------------

            const result = await db.query(
                `
                SELECT *
                FROM orders
                WHERE order_id = $1
                `,
                [orderId]
            );

            const order = result.rows[0];

            if (!order) {

                return res.status(404).json({

                    success: false,

                    message: "Order not found"
                });
            }

            // ------------------------------------------
            // ALREADY PAID
            // ------------------------------------------

            if (order.payment_status === "PAID") {

                return res.status(400).json({

                    success: false,

                    message: "Order is already paid"
                });
            }

            // ------------------------------------------
            // RUPEES → PAISE
            // ------------------------------------------

            const amountInPaise =
                Math.round(
                    Number(order.total_amount) * 100
                );

            // ------------------------------------------
            // CREATE RAZORPAY ORDER
            // ------------------------------------------

            const razorpayOrder =
                await razorpay.orders.create({

                    amount: amountInPaise,

                    currency: "INR",

                    receipt: order.order_id,

                    notes: {

                        local_order_id:
                            order.order_id,

                        file_name:
                            order.file_name,

                        pages:
                            String(order.page_count),

                        print_mode:
                            order.print_mode
                    }
                });

            console.log(
                "Razorpay Order Created:"
            );

            console.log({

                razorpayOrderId:
                    razorpayOrder.id,

                localOrderId:
                    order.order_id,

                amount:
                    razorpayOrder.amount
            });

            // ------------------------------------------
            // SAVE RAZORPAY ORDER ID
            // ------------------------------------------

            await db.query(
                `
                UPDATE orders
                SET razorpay_order_id = $1
                WHERE order_id = $2
                `,
                [
                    razorpayOrder.id,
                    order.order_id
                ]
            );

            res.json({

                success: true,

                razorpayOrder: {

                    id:
                        razorpayOrder.id,

                    amount:
                        razorpayOrder.amount,

                    currency:
                        razorpayOrder.currency
                }
            });

        } catch (error) {

            console.error(
                "Razorpay order error:",
                error
            );

            res.status(500).json({

                success: false,

                message: "Could not create Razorpay order",

                error: error.message
            });
        }
    }
);

// ==========================================
// VERIFY RAZORPAY PAYMENT
// ==========================================

app.post(
    "/api/payment/verify",
    async (req, res) => {

        try {

            const {
                orderId,
                razorpay_order_id,
                razorpay_payment_id,
                razorpay_signature
            } = req.body;

            // ------------------------------------------
            // VALIDATION
            // ------------------------------------------

            if (
                !orderId ||
                !razorpay_order_id ||
                !razorpay_payment_id ||
                !razorpay_signature
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment verification data missing"
                });
            }

            // ------------------------------------------
            // FIND ORDER
            // ------------------------------------------

            const result = await db.query(
                `
                SELECT *
                FROM orders
                WHERE order_id = $1
                `,
                [orderId]
            );

            const order = result.rows[0];

            if (!order) {

                return res.status(404).json({

                    success: false,

                    message: "Local order not found"
                });
            }

            // ------------------------------------------
            // CHECK RAZORPAY ORDER ID
            // ------------------------------------------

            if (
                order.razorpay_order_id !==
                razorpay_order_id
            ) {

                console.error(
                    "Razorpay Order ID mismatch"
                );

                return res.status(400).json({

                    success: false,

                    message:
                        "Razorpay order verification failed"
                });
            }

            // ------------------------------------------
            // GENERATE SIGNATURE
            // ------------------------------------------

            const generatedSignature =
                crypto
                    .createHmac(
                        "sha256",
                        process.env.RAZORPAY_KEY_SECRET
                    )
                    .update(
                        razorpay_order_id +
                        "|" +
                        razorpay_payment_id
                    )
                    .digest("hex");

            // ------------------------------------------
            // COMPARE SIGNATURE
            // ------------------------------------------

            if (
                generatedSignature !==
                razorpay_signature
            ) {

                console.error(
                    "Invalid Razorpay signature"
                );

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment verification failed"
                });
            }

            // ------------------------------------------
            // UPDATE PAYMENT
            // ------------------------------------------

            await db.query(
                `
                UPDATE orders
                SET
                    payment_status = 'PAID',
                    print_status = 'READY',
                    razorpay_payment_id = $1,
                    razorpay_signature = $2
                WHERE order_id = $3
                `,
                [
                    razorpay_payment_id,
                    razorpay_signature,
                    orderId
                ]
            );

            // ------------------------------------------
            // GET UPDATED ORDER
            // ------------------------------------------

            const updatedResult = await db.query(
                `
                SELECT *
                FROM orders
                WHERE order_id = $1
                `,
                [orderId]
            );

            const updatedOrder =
                updatedResult.rows[0];

            // ------------------------------------------
            // ADD TO PRINT QUEUE
            // ------------------------------------------

            const alreadyQueued =
                printQueue.some(
                    job =>
                        job.orderId === orderId
                );

            if (!alreadyQueued) {

                const printJob = {

                    orderId:
                        updatedOrder.order_id,

                    filePath:
                        updatedOrder.file_path,

                    fileName:
                        updatedOrder.file_name,

                    pageCount:
                        updatedOrder.page_count,

                    printMode:
                        updatedOrder.print_mode,

                    status:
                        "WAITING",

                    createdAt:
                        new Date().toISOString()
                };

                printQueue.push(printJob);

                await db.query(
                    `
                    UPDATE orders
                    SET print_status = 'QUEUED'
                    WHERE order_id = $1
                    `,
                    [orderId]
                );

                console.log(
                    "Print job automatically added:"
                );

                console.log(printJob);
            }

            console.log(
                "PAYMENT VERIFIED:"
            );

            console.log({

                orderId:
                    orderId,

                paymentId:
                    razorpay_payment_id,

                status:
                    "PAID"
            });

            res.json({

                success: true,

                message:
                    "Payment verified successfully",

                order:
                    updatedOrder
            });

        } catch (error) {

            console.error(
                "Payment verification error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Payment verification failed",

                error: error.message
            });
        }
    }
);

// ==========================================
// WINDOWS PRINTER STATUS
// ==========================================

app.get(
    "/api/printer/status",
    (req, res) => {

        // Render cloud cannot access your
        // local Windows printer.

        res.json({

            success: true,

            environment: "cloud",

            message:
                "Physical Windows printer must be connected through a local print agent.",

            printers: []
        });

    }
);

// ==========================================
// GET AVAILABLE PRINTERS
// ==========================================

app.get(
    "/api/printer/list",
    (req, res) => {

        res.json({

            success: true,

            environment: "cloud",

            count: 0,

            printers: [],

            message:
                "No local printers available on cloud server."
        });

    }
);

// ==========================================
// PRINT PDF
// ==========================================

app.post(
    "/api/printer/print",
    (req, res) => {

        res.status(501).json({

            success: false,

            message:
                "Physical printing requires the local Print Agent."
        });

    }
);

// ==========================================
// ADD ORDER TO PRINT QUEUE
// ==========================================

app.post(
    "/api/printer/queue",
    async (req, res) => {

        try {

            const {
                orderId
            } = req.body;

            if (!orderId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Order ID is required"
                });
            }

            const result = await db.query(
                `
                SELECT *
                FROM orders
                WHERE order_id = $1
                `,
                [orderId]
            );

            const order = result.rows[0];

            if (!order) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Order not found"
                });
            }

            if (
                order.payment_status !== "PAID"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment is not verified"
                });
            }

            const alreadyQueued =
                printQueue.some(
                    job =>
                        job.orderId === orderId
                );

            if (alreadyQueued) {

                return res.json({

                    success: true,

                    message:
                        "Order already in print queue"
                });
            }

            const job = {

                orderId:
                    order.order_id,

                filePath:
                    order.file_path,

                fileName:
                    order.file_name,

                pageCount:
                    order.page_count,

                printMode:
                    order.print_mode,

                status:
                    "WAITING",

                createdAt:
                    new Date().toISOString()
            };

            printQueue.push(job);

            await db.query(
                `
                UPDATE orders
                SET print_status = 'QUEUED'
                WHERE order_id = $1
                `,
                [orderId]
            );

            console.log(
                "Print job added:"
            );

            console.log(job);

            res.json({

                success: true,

                message:
                    "Order added to print queue",

                job:
                    job,

                queueLength:
                    printQueue.length
            });

        } catch (error) {

            console.error(
                "Print queue error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not add order to print queue",

                error: error.message
            });
        }
    }
);

// ==========================================
// GET PRINT QUEUE
// ==========================================

app.get(
    "/api/printer/queue",
    (req, res) => {

        res.json({

            success: true,

            queueLength:
                printQueue.length,

            printing:
                isPrinting,

            queue:
                printQueue
        });

    }
);

// ==========================================
// PRINT QUEUE WORKER
// ==========================================

async function processPrintQueue() {

    if (isPrinting) {
        return;
    }

    if (printQueue.length === 0) {
        return;
    }

    const job = printQueue[0];

    console.log(
        "Processing print job:",
        job.orderId
    );

    isPrinting = true;

    try {

        // ------------------------------------------
        // GET ORDER
        // ------------------------------------------

        const result = await db.query(
            `
            SELECT *
            FROM orders
            WHERE order_id = $1
            `,
            [job.orderId]
        );

        const order = result.rows[0];

        if (!order) {

            console.error(
                "Order not found:",
                job.orderId
            );

            job.status = "FAILED";

            printQueue.shift();

            return;
        }

        // ------------------------------------------
        // PAYMENT CHECK
        // ------------------------------------------

        if (
            order.payment_status !== "PAID"
        ) {

            console.error(
                "Payment not verified:",
                job.orderId
            );

            job.status = "FAILED";

            await db.query(
                `
                UPDATE orders
                SET print_status = 'FAILED'
                WHERE order_id = $1
                `,
                [job.orderId]
            );

            printQueue.shift();

            return;
        }

        // ------------------------------------------
        // PDF CHECK
        // ------------------------------------------

        if (
            !fs.existsSync(job.filePath)
        ) {

            console.error(
                "PDF not found:",
                job.filePath
            );

            job.status = "FAILED";

            await db.query(
                `
                UPDATE orders
                SET print_status = 'FAILED'
                WHERE order_id = $1
                `,
                [job.orderId]
            );

            printQueue.shift();

            return;
        }

        // ------------------------------------------
        // DRY RUN
        // ------------------------------------------

        console.log(
            "--------------------------------"
        );

        console.log(
            "PRINT JOB READY"
        );

        console.log(
            "Order:",
            job.orderId
        );

        console.log(
            "File:",
            job.fileName
        );

        console.log(
            "Pages:",
            job.pageCount
        );

        console.log(
            "Mode:",
            job.printMode
        );

        console.log(
            "Path:",
            job.filePath
        );

        console.log(
            "--------------------------------"
        );

        // Physical printer will be handled
        // by the local Print Agent.

        job.status =
            "WAITING_PRINTER";

        await db.query(
            `
            UPDATE orders
            SET print_status = 'WAITING_PRINTER'
            WHERE order_id = $1
            `,
            [job.orderId]
        );

        printQueue.shift();

        console.log(
            "Job removed from active queue."
        );

    } catch (error) {

        console.error(
            "Print worker error:",
            error
        );

        job.status =
            "FAILED";

        await db.query(
            `
            UPDATE orders
            SET print_status = 'FAILED'
            WHERE order_id = $1
            `,
            [job.orderId]
        );

        printQueue.shift();

    } finally {

        isPrinting = false;
    }
}

// ==========================================
// CHECK QUEUE EVERY 5 SECONDS
// ==========================================

setInterval(
    processPrintQueue,
    5000
);

// ==========================================
// GET ALL ORDERS
// ==========================================

app.get(
    "/api/orders",
    async (req, res) => {

        try {

            const result = await db.query(
                `
                SELECT
                    id,
                    order_id,
                    file_name,
                    file_path,
                    page_count,
                    print_mode,
                    price_per_page,
                    total_amount,
                    payment_status,
                    print_status,
                    razorpay_order_id,
                    razorpay_payment_id,
                    created_at,
                    completed_at
                FROM orders
                ORDER BY id DESC
                `
            );

            res.json({

                success: true,

                count:
                    result.rows.length,

                orders:
                    result.rows
            });

        } catch (error) {

            console.error(
                "Order history error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not get orders",

                error:
                    error.message
            });
        }
    }
);

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================

app.use(
    (error, req, res, next) => {

        console.error(
            "Server Error:",
            error
        );

        if (
            error.message ===
            "Only PDF files are allowed"
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Only PDF files are allowed"
            });
        }

        res.status(500).json({

            success: false,

            message:
                "Internal server error"
        });
    }
);

// ==========================================
// START SERVER
// ==========================================

async function startServer() {

    try {

        // Initialize PostgreSQL database
        await db.initDatabase();

        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(
                    "--------------------------------"
                );

                console.log(
                    "Print Vending Backend Started"
                );

                console.log(
                    "--------------------------------"
                );

                console.log(
                    `Server: http://localhost:${PORT}`
                );
            }
        );

    } catch (error) {

        console.error(
            "Failed to start server:",
            error
        );

        process.exit(1);
    }
}

startServer();
