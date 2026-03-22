const express = require("express");
const { addBankAccount, checkBankAccount } = require("../controllers/bankAccountController");
const authenticateJWT = require("../middleware/authMiddleware");
const router = express.Router();

router.put("/create", authenticateJWT, addBankAccount);
router.get("/checkBankAccount", authenticateJWT, checkBankAccount);

module.exports = router;