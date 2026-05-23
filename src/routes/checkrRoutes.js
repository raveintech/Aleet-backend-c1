const express = require('express');
const router = express.Router();
const {
  listPackages,
  inviteDriver,
  webhook,
  simulateClearReport,
  getMyCheckrStatus,
  resendMyInvite,
} = require('../controllers/checkrController');
const authenticateJWT = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/requireAdmin');
const { pollingReadLimiter, otpStartLimiter } = require('../middleware/rateLimiters');


// show packages to admin
router.get('/packages', authenticateJWT, listPackages);

// manually send invite (if not auto)
router.post('/drivers/:id/invite', authenticateJWT, inviteDriver);

// T-1.2.1 — driver fetches their Checkr status for the pending-review panel.
// Uses pollingReadLimiter because the page polls every 30s; the auth-bucket
// limiter (30/15min) would 429 mid-session.
router.get('/drivers/me/status', authenticateJWT, pollingReadLimiter, getMyCheckrStatus);

// T-1.2.2 — driver-initiated resend; same rate-limit bucket as OTP sends
// because each call re-triggers a Checkr email (cost + abuse surface).
router.post('/drivers/me/resend', authenticateJWT, otpStartLimiter, resendMyInvite);

// webhook receiver (NO auth, raw body needed for signature verification)
router.post('/webhooks/checkr', express.raw({ type: '*/*' }), webhook);

// TEMP admin endpoint: simulate "report.completed" with result "clear"
router.post('/admin/drivers/:id/simulate-clear', requireAdmin, simulateClearReport);

module.exports = router;
