// controllers/checkrController.js
const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const User = require('../models/User');
const {
  getPackages,
  createCandidate,
  createInvitation,
  mapWebhookToState,
} = require('../services/checkrService');
const { sendSuccess, sendValidationError, sendNotFound } = require('../utils/responseHelper');
const logger = require('../utils/logger');

const DASH = process.env.CHECKR_DASHBOARD_BASE || 'https://dashboard.staging.checkr.com';

// Verify Checkr webhook signature
// Docs: HMAC-SHA256 of compact JSON body, keyed with the API key
// https://docs.checkr.com/#section/Webhooks/Securing-webhooks
function verifyCheckrSignature(rawBody, signatureHeader) {
  const apiKey = process.env.CHECKR_API_KEY;
  if (!apiKey) {
    logger.warn('Checkr: CHECKR_API_KEY not set, skipping signature verification');
    return true;
  }
  if (!signatureHeader) return false;

  // Checkr signs the compact (non-pretty) JSON string, not the raw buffer
  let compactJson;
  try {
    compactJson = JSON.stringify(JSON.parse(rawBody.toString('utf8')));
  } catch {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', apiKey)
    .update(compactJson)
    .digest('hex');

  const received = signatureHeader.replace(/^sha256=/, '');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch {
    return false;
  }
}

// GET /checkr/packages
exports.listPackages = asyncHandler(async (req, res) => {
  const pkgs = await getPackages();
  res.json({ success: true, data: pkgs });
});

// POST /checkr/drivers/:id/invite
exports.inviteDriver = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { package: pkg, nodeId, work } = req.body;

  const user = await User.findById(id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.role !== 'driver') return res.status(400).json({ success: false, message: 'Not a driver' });

  // Prevent duplicate invitations
  const nonInvitableStatuses = ['background_pending', 'background_completed', 'approved'];
  if (nonInvitableStatuses.includes(user.driver?.status)) {
    return res.status(409).json({ success: false, message: `Driver already has status: ${user.driver.status}` });
  }

  // create candidate if needed
  let candidateId = user.driver?.checkr?.candidateId;
  if (!candidateId) {
    const candidate = await createCandidate(user);
    candidateId = candidate.id;
    user.driver.checkr.candidateId = candidateId;
  }

  // send invitation
  const inv = await createInvitation({
    candidateId,
    pkg: 'standard',
    nodeId,
    work,
  });

  user.driver.checkr.invitationId = inv.id;
  if (inv.report_id) user.driver.checkr.reportId = inv.report_id;
  user.driver.checkr.status = 'invited';
  user.driver.checkr.lastEvent = 'invitation.created';
  user.driver.checkr.lastEventAt = new Date();

  // dashboard link for admins/adjudicators
  user.driver.checkr.dashboardUrl = inv.report_id
    ? `${DASH}/reports/${inv.report_id}`
    : `${DASH}/candidates/${candidateId}`;

  user.driver.status = 'background_pending';

  await user.save();

  res.json({
    success: true,
    message: 'Invitation sent',
    data: {
      candidateId,
      invitationId: inv.id,
      reportId: inv.report_id || null,
      dashboardUrl: user.driver.checkr.dashboardUrl,
    },
  });
});

// POST /checkr/webhooks/checkr  (raw body for signature verification)
exports.webhook = asyncHandler(async (req, res) => {
  const sig = req.headers['x-checkr-signature'];
  const rawBody = req.body;

  (req.log || logger).info('Checkr webhook incoming request');
  (req.log || logger).info({
    contentType: req.headers['content-type'],
    signature: sig,
    userAgent: req.headers['user-agent'],
  }, 'Checkr webhook headers');
  (req.log || logger).info({ rawBody: rawBody?.toString('utf8') }, 'Checkr webhook raw body');

  // Verify signature using raw body buffer
  if (!verifyCheckrSignature(rawBody, sig)) {
    (req.log || logger).warn('Checkr webhook signature verification failed');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  (req.log || logger).info('Checkr webhook signature OK');

  // Parse JSON from raw buffer (already validated as parseable in verifyCheckrSignature)
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    (req.log || logger).error('Checkr webhook failed to parse JSON body');
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const eventType = event?.type;
  const obj = event?.data?.object || {};

  (req.log || logger).info({ eventType }, 'Checkr webhook event type');
  (req.log || logger).info({ candidateId: obj.candidate_id, object: obj.object, id: obj.id }, 'Checkr webhook event payload');

  // find user either by candidate_id or report id
  let user = null;
  if (obj.candidate_id) {
    user = await User.findOne({ 'driver.checkr.candidateId': obj.candidate_id });
  }
  if (!user && obj.id && obj.object === 'report') {
    user = await User.findOne({ 'driver.checkr.reportId': obj.id });
  }

  if (!user) {
    (req.log || logger).warn({ candidateId: obj.candidate_id }, 'Checkr webhook no user found for candidateId');
    return res.status(200).json({ received: true, note: 'User not found for event' });
  }

  const prevStatus = user.driver.status;
  const updates = mapWebhookToState(event);

  if (updates.reportId) {
    user.driver.checkr.reportId = updates.reportId;
    user.driver.checkr.dashboardUrl = `${DASH}/reports/${updates.reportId}`;
    delete updates.reportId;
  }

  // Apply updates individually to keep Mongoose change tracking
  Object.assign(user.driver.checkr, updates);
  user.markModified('driver.checkr');

  // Status transitions — only 3 meaningful cases:
  // report.completed  → admin reviews result and approves/rejects
  // report.suspended  → driver needs to provide docs, admin re-invites
  // report.canceled   → same recovery path as suspended
  if (eventType === 'report.completed') {
    user.driver.status = 'background_completed';
  }
  if (eventType === 'report.suspended' || eventType === 'report.canceled') {
    // Return to submitted so admin can take action / re-invite
    user.driver.status = 'submitted';
  }
  // All other events (invitation.*, report.updated, etc.) — record in checkr subdoc, no status change

  // mark backgroundCheck boolean
  if (user.driver.checkr.assessment === 'eligible' || user.driver.checkr.result === 'clear') {
    user.driver.backgroundCheck = true;
  }

  await user.save();

  (req.log || logger).info({ prevStatus, nextStatus: user.driver.status }, 'Checkr webhook driver status updated');
  (req.log || logger).info({ checkr: user.driver.checkr }, 'Checkr webhook checkr subdoc after update');
  (req.log || logger).info('Checkr webhook done');

  res.status(200).json({ received: true });
});

// GET /checkr/drivers/me/status (T-1.2.1)
// Driver fetches their own Checkr status so the pending-review page can render
// a panel beyond the binary "background_pending" string. Maps the persisted
// `checkr.status` to a customer-facing label.
exports.getMyCheckrStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return sendNotFound(res, 'User not found');
  if (user.role !== 'driver') return sendValidationError(res, 'Driver only');

  const checkr = user.driver?.checkr || {};
  // Surface the labels the spec calls out ("Invited / Awaiting consent /
  // Processing / Clear / Consider") with a fallback for unmapped raw states.
  const LABEL_MAP = {
    invited: 'Invited',
    awaiting_consent: 'Awaiting consent',
    pending: 'Processing',
    processing: 'Processing',
    suspended: 'Awaiting consent',
    consider: 'Consider',
    clear: 'Clear',
    complete: 'Clear',
    completed: 'Clear',
    canceled: 'Canceled',
    dispute: 'Disputed',
  };

  const rawStatus = String(checkr.status || '').toLowerCase();
  const label = LABEL_MAP[rawStatus] || (rawStatus ? rawStatus : 'Not started');

  return sendSuccess(res, 200, 'Checkr status retrieved', {
    label,
    rawStatus: checkr.status || null,
    lastEvent: checkr.lastEvent || null,
    lastEventAt: checkr.lastEventAt || null,
    invitedAt: checkr.invitedAt || null,
    helpUrl: 'https://help.checkr.com/hc/en-us/categories/360001216234-Candidates',
  });
});

// POST /checkr/drivers/me/resend (T-1.2.2)
// Driver-initiated re-invitation when the original invite email got lost.
// Rate-limited via the route layer (P2 #16); idempotent at the Checkr API —
// Checkr returns the existing invitation if one is already open.
exports.resendMyInvite = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return sendNotFound(res, 'User not found');
  if (user.role !== 'driver') return sendValidationError(res, 'Driver only');

  const candidateId = user.driver?.checkr?.candidateId;
  if (!candidateId) {
    return sendValidationError(
      res,
      'No Checkr candidate is on file yet. Complete signup first.',
      { reason: 'CHECKR_NO_CANDIDATE' }
    );
  }

  const inv = await createInvitation({ candidateId, pkg: 'standard' });
  if (!user.driver.checkr) user.driver.checkr = {};
  user.driver.checkr.invitationId = inv.id;
  if (inv.report_id) user.driver.checkr.reportId = inv.report_id;
  user.driver.checkr.status = user.driver.checkr.status || 'invited';
  user.driver.checkr.lastEvent = 'invitation.resent';
  user.driver.checkr.lastEventAt = new Date();
  await user.save();

  return sendSuccess(res, 200, 'Invitation re-sent', {
    invitationId: inv.id,
    reportId: inv.report_id || null,
  });
});

// POST /checkr/admin/drivers/:id/simulate-clear
// Temporary admin utility: simulate Checkr "report.completed" with clear result.
exports.simulateClearReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) return sendValidationError(res, 'Driver user ID is required');

  const user = await User.findById(id);
  if (!user) return sendNotFound(res, 'User not found');
  if (user.role !== 'driver') return sendValidationError(res, 'User is not a driver');

  const event = {
    type: 'report.completed',
    data: {
      object: {
        object: 'report',
        id: user.driver?.checkr?.reportId || `manual-report-${String(user._id)}`,
        candidate_id: user.driver?.checkr?.candidateId || null,
        result: 'clear',
        assessment: 'eligible',
        includes_canceled: false
      }
    }
  };

  const updates = mapWebhookToState(event);

  if (!user.driver) user.driver = {};
  if (!user.driver.checkr) user.driver.checkr = {};

  if (updates.reportId) {
    user.driver.checkr.reportId = updates.reportId;
    user.driver.checkr.dashboardUrl = `${DASH}/reports/${updates.reportId}`;
    delete updates.reportId;
  }

  Object.assign(user.driver.checkr, updates);
  user.driver.status = 'background_completed';
  user.driver.backgroundCheck = true;
  user.markModified('driver.checkr');
  await user.save();

  return sendSuccess(res, 200, 'Simulated Checkr clear report applied', {
    userId: String(user._id),
    checkr: user.driver.checkr,
    driverStatus: user.driver.status,
    backgroundCheck: user.driver.backgroundCheck
  });
});
