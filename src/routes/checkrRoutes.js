const express = require('express');
const router = express.Router();
const { listPackages, inviteDriver, webhook } = require('../controllers/checkrController');
const authenticateJWT = require('../middleware/authMiddleware');  // Use JWT middleware for protection


// show packages to admin
router.get('/packages', authenticateJWT, listPackages);

// manually send invite (if not auto)
router.post('/drivers/:id/invite', authenticateJWT, inviteDriver);

// webhook receiver (NO protect here)
router.post('/webhooks/checkr', express.json({ type: '*/*' }), webhook);

module.exports = router;
