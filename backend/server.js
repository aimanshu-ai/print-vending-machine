// ==========================================
// PRINT VENDING BACKEND
// ==========================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const db = require("./database");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Razorpay = require("razorpay");
const { execFile } = require("child_process");

// ==========================================
// RAZORPAY CONFIGURATION
// ==========================================

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ==========================================
// EXPRESS APP
// ==========================================

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ==========================================
// PDF UPLOAD CONFIGURATION
// ==========================================

const uploadFolder = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder);
}

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
// HOME API
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
// PDF UPLOAD API
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
// CREATE LOCAL PRINT ORDER
// ==========================================

app.post(
    "/api/orders",
    (req, res) => {

        try {

            const {
                fileName,
                filePath,
                pageCount,
                printMode,
                pricePerPage,
                totalAmount
            } = req.body;

            // Validation

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

            // Validate print mode

            if (
                printMode !== "bw" &&
                printMode !== "color"
            ) {

                return res.status(400).json({

                    success: false,

                    message: "Invalid print mode"
                });
            }

            // Generate local Order ID

            const orderId =
                "ORD-" +
                Date.now() +
                "-" +
                Math.floor(Math.random() * 1000);

            // Save order

            const insertOrder = db.prepare(`

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

                    @orderId,
                    @fileName,
                    @filePath,
                    @pageCount,
                    @printMode,
                    @pricePerPage,
                    @totalAmount,
                    'PENDING',
                    'WAITING'

                )

            `);

            insertOrder.run({

                orderId: orderId,

                fileName: fileName,

                filePath: filePath,

                pageCount: pageCount,

                printMode: printMode,

                pricePerPage: pricePerPage,

                totalAmount: totalAmount

            });

            // Get saved order

            const order = db.prepare(`

                SELECT *

                FROM orders

                WHERE order_id = ?

            `).get(orderId);

            console.log(
                "Order saved in database:"
            );

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

                message: "Failed to create order"
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

            // Find local order

            const order = db.prepare(`

                SELECT *

                FROM orders

                WHERE order_id = ?

            `).get(orderId);

            if (!order) {

                return res.status(404).json({

                    success: false,

                    message: "Order not found"
                });
            }

            // Already paid?

            if (
                order.payment_status === "PAID"
            ) {

                return res.status(400).json({

                    success: false,

                    message: "Order is already paid"
                });
            }

            // Convert rupees to paise

            const amountInPaise =
                Math.round(
                    Number(order.total_amount) * 100
                );

            // Create Razorpay Order FIRST

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

            // Save Razorpay Order ID

            db.prepare(`

                UPDATE orders

                SET razorpay_order_id = ?

                WHERE order_id = ?

            `).run(

                razorpayOrder.id,

                order.order_id

            );

            console.log(
                "Razorpay Order ID saved:",
                razorpayOrder.id
            );

            // Send data to frontend

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

                message: "Could not create Razorpay order"
            });
        }
    }
);

// ==========================================
// VERIFY RAZORPAY PAYMENT
// ==========================================

app.post(
    "/api/payment/verify",
    (req, res) => {

        try {

            const {
                orderId,
                razorpay_order_id,
                razorpay_payment_id,
                razorpay_signature
            } = req.body;

            // Check required data

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

            // Find local order

            const order = db.prepare(`

                SELECT *

                FROM orders

                WHERE order_id = ?

            `).get(orderId);

            if (!order) {

                return res.status(404).json({

                    success: false,

                    message: "Local order not found"
                });
            }

            // IMPORTANT:
            // Razorpay Order ID must match DB

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

            // Generate signature

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

            // Compare signatures

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

            // Update payment status

            db.prepare(`

                UPDATE orders

                SET

                    payment_status = 'PAID',

                    print_status = 'READY',

                    razorpay_payment_id = ?,

                    razorpay_signature = ?

                WHERE order_id = ?

            `).run(

                razorpay_payment_id,

                razorpay_signature,

                orderId
            );

            // Get updated order

            const updatedOrder =
                db.prepare(`

                    SELECT *

                    FROM orders

                    WHERE order_id = ?

                `).get(orderId);

            // ==========================================
            // ADD VERIFIED PAYMENT TO PRINT QUEUE
            // ==========================================

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

                db.prepare(`

                    UPDATE orders

                    SET print_status = 'QUEUED'

                    WHERE order_id = ?

                `).run(orderId);

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
                    "Payment verification failed"
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

        execFile(

            "powershell.exe",

            [
                "-NoProfile",

                "-Command",

                "Get-Printer | Select-Object Name,PrinterStatus,Default | ConvertTo-Json"
            ],

            (error, stdout, stderr) => {

                if (error) {

                    console.error(
                        "Printer detection error:",
                        error
                    );

                    return res.status(500).json({

                        success: false,

                        message:
                            "Could not detect Windows printers"
                    });
                }

                try {

                    let printers =
                        stdout.trim()
                            ? JSON.parse(stdout)
                            : [];

                    if (
                        !Array.isArray(printers)
                    ) {

                        printers = [printers];
                    }

                    res.json({

                        success: true,

                        printers:
                            printers
                    });

                } catch (parseError) {

                    console.error(
                        "Printer data parse error:",
                        parseError
                    );

                    res.status(500).json({

                        success: false,

                        message:
                            "Could not read printer information"
                    });
                }
            }
        );
    }
);

// ==========================================
// GET AVAILABLE PRINTERS
// ==========================================

app.get(
    "/api/printer/list",
    (req, res) => {

        execFile(

            "powershell.exe",

            [
                "-NoProfile",

                "-Command",

                `
                Get-Printer |
                Select-Object Name, PrinterStatus, Default |
                ConvertTo-Json
                `
            ],

            (error, stdout, stderr) => {

                if (error) {

                    console.error(
                        "Printer list error:",
                        error
                    );

                    return res.status(500).json({

                        success: false,

                        message:
                            "Could not get printer list"
                    });
                }

                try {

                    let printers =
                        stdout.trim()
                            ? JSON.parse(stdout)
                            : [];

                    if (
                        !Array.isArray(printers)
                    ) {

                        printers = [printers];
                    }

                    res.json({

                        success: true,

                        count:
                            printers.length,

                        printers:
                            printers
                    });

                } catch (error) {

                    console.error(
                        "Printer JSON error:",
                        error
                    );

                    res.status(500).json({

                        success: false,

                        message:
                            "Invalid printer data"
                    });
                }
            }
        );
    }
);

// ==========================================
// PRINT PDF API
// ==========================================

app.post(
    "/api/printer/print",
    (req, res) => {

        try {

            const {
                filePath,
                printerName
            } = req.body;

            if (!filePath) {

                return res.status(400).json({

                    success: false,

                    message:
                        "PDF file path is required"
                });
            }

            if (!fs.existsSync(filePath)) {

                return res.status(404).json({

                    success: false,

                    message:
                        "PDF file not found"
                });
            }

            const selectedPrinter =
                printerName ||
                "Microsoft Print to PDF";

            console.log(
                "Print Request:"
            );

            console.log({

                filePath:
                    filePath,

                printer:
                    selectedPrinter
            });

            const safePrinter =
                selectedPrinter.replace(
                    /'/g,
                    "''"
                );

            const command = `

                $printer = Get-CimInstance Win32_Printer |

                    Where-Object {
                        $_.Name -eq '${safePrinter}'
                    };

                if ($null -eq $printer) {
                    throw "Printer not found";
                }

                Write-Output "Printer found: $($printer.Name)";

            `;

            execFile(

                "powershell.exe",

                [
                    "-NoProfile",
                    "-Command",
                    command
                ],

                (error, stdout, stderr) => {

                    if (error) {

                        console.error(
                            "Printer error:",
                            stderr || error.message
                        );

                        return res.status(500).json({

                            success: false,

                            message:
                                "Printer not found or unavailable"
                        });
                    }

                    console.log(stdout);

                    res.json({

                        success: true,

                        message:
                            "Printer found and ready",

                        printer:
                            selectedPrinter
                    });
                }
            );

        } catch (error) {

            console.error(
                "Print API error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Print request failed"
            });
        }
    }
);

// ==========================================
// ADD ORDER TO PRINT QUEUE MANUALLY
// ==========================================

app.post(
    "/api/printer/queue",
    (req, res) => {

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

            const order = db.prepare(`

                SELECT *

                FROM orders

                WHERE order_id = ?

            `).get(orderId);

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

            db.prepare(`

                UPDATE orders

                SET print_status = 'QUEUED'

                WHERE order_id = ?

            `).run(orderId);

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
                    "Could not add order to print queue"
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

        // Get current order

        const order = db.prepare(`

            SELECT *

            FROM orders

            WHERE order_id = ?

        `).get(job.orderId);

        if (!order) {

            console.error(
                "Order not found:",
                job.orderId
            );

            job.status = "FAILED";

            printQueue.shift();

            return;
        }

        // Check payment

        if (
            order.payment_status !== "PAID"
        ) {

            console.error(
                "Payment not verified:",
                job.orderId
            );

            job.status = "FAILED";

            db.prepare(`

                UPDATE orders

                SET print_status = 'FAILED'

                WHERE order_id = ?

            `).run(job.orderId);

            printQueue.shift();

            return;
        }

        // Check PDF

        if (
            !fs.existsSync(job.filePath)
        ) {

            console.error(
                "PDF not found:",
                job.filePath
            );

            job.status = "FAILED";

            db.prepare(`

                UPDATE orders

                SET print_status = 'FAILED'

                WHERE order_id = ?

            `).run(job.orderId);

            printQueue.shift();

            return;
        }

        // ==========================================
        // DRY RUN
        // ==========================================

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

        /*
            IMPORTANT:

            Actual physical printer command
            abhi intentionally nahi chalaya ja raha.

            Physical printer connect hone ke baad
            yahan actual printing implement karenge.
        */

        job.status =
            "WAITING_PRINTER";

        db.prepare(`

            UPDATE orders

            SET print_status = 'WAITING_PRINTER'

            WHERE order_id = ?

        `).run(job.orderId);

        // Remove from active queue

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

        db.prepare(`

            UPDATE orders

            SET print_status = 'FAILED'

            WHERE order_id = ?

        `).run(job.orderId);

        printQueue.shift();

    } finally {

        isPrinting = false;
    }
}

// Check print queue every 5 seconds

setInterval(
    processPrintQueue,
    5000
);

// ==========================================
// GET ALL ORDERS
// ==========================================

app.get(
    "/api/orders",
    (req, res) => {

        try {

            const orders = db.prepare(`

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

            `).all();

            res.json({

                success: true,

                count:
                    orders.length,

                orders:
                    orders
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

app.listen(
    PORT,
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