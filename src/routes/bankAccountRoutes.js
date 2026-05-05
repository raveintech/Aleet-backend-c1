const express = require("express");
const {
    getPayoutMethods,
    addPayoutMethod,
    setPrimary,
    deletePayoutMethod,
    addBankAccount,
    checkBankAccount,
    getBankAccountStatus,
    getStripeStatus,
    startStripeOnboarding,
} = require("../controllers/bankAccountController");
const authenticateJWT = require("../middleware/authMiddleware");
const router = express.Router();

// Manual payout methods (bank / paypal)
router.get("/", authenticateJWT, getPayoutMethods);
router.post("/", authenticateJWT, addPayoutMethod);
router.patch("/:id/set-primary", authenticateJWT, setPrimary);
router.delete("/:id", authenticateJWT, deletePayoutMethod);

// Stripe Connect
router.get("/stripe/status", authenticateJWT, getStripeStatus);
router.post("/stripe/connect", authenticateJWT, startStripeOnboarding);

// Legacy routes (kept for backward compatibility)
router.put("/create", authenticateJWT, addBankAccount);
router.get("/checkBankAccount", authenticateJWT, checkBankAccount);

module.exports = router;
