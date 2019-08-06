var dotenv = require('dotenv');
dotenv.config();

module.exports = {
    email: {
        host: 'gmail.com',
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    secret: process.env.SECRET,
    ap_email: process.env.AP_EMAIL,
    endpoint: 'http://' + process.env.IP_ADDRESS,
    approval_route: '/invoices/approve',
    admin_email: process.env.ADMIN_EMAIL,
    shiftboard: {
        accessKey: process.env.SB_ACCESS_KEY,
        signature: process.env.SB_SIGNATURE
    },
    mileage_rate: 0.545,
    start_week: 0, // 0 to start this week, 1 to start next week
    use_AWS_SES: true,
    transport_settings: {
        host: 'smtp.gmail.com',
        secure: true,
        pool: true,
        maxConnections: 100,
        maxMessages: 10000,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    },
    bill_to: [
        "General Dynamics Information Technology",
        "Accounts Payable",
        "101 Station Drive",
        "Westwood, MA 02090",
        process.env.AP_EMAIL
    ],
};
