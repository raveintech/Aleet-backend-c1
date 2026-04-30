const express = require('express');
const router = express.Router();
const { listPackages, inviteDriver, webhook, simulateClearReport } = require('../controllers/checkrController');
const authenticateJWT = require('../middleware/authMiddleware');  // Use JWT middleware for protection
const requireAdmin = require('../middleware/requireAdmin');


// show packages to admin
router.get('/packages', authenticateJWT, listPackages);

// manually send invite (if not auto)
router.post('/drivers/:id/invite', authenticateJWT, inviteDriver);

// webhook receiver (NO auth, raw body needed for signature verification)
router.post('/webhooks/checkr', express.raw({ type: '*/*' }), webhook);

// TEMP admin endpoint: simulate "report.completed" with result "clear"
router.post('/admin/drivers/:id/simulate-clear', requireAdmin, simulateClearReport);

module.exports = router;
