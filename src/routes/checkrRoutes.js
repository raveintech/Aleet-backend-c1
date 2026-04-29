const express = require('express');
const router = express.Router();
const { listPackages, inviteDriver, webhook } = require('../controllers/checkrController');
const authenticateJWT = require('../middleware/authMiddleware');  // Use JWT middleware for protection


// show packages to admin
router.get('/packages', authenticateJWT, listPackages);

// manually send invite (if not auto)
router.post('/drivers/:id/invite', authenticateJWT, inviteDriver);

// webhook receiver (NO auth, raw body needed for signature verification)
router.post('/webhooks/checkr', express.raw({ type: '*/*' }), webhook);

module.exports = router;
