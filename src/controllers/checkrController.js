// controllers/checkrController.js
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const {
  getPackages,
  createCandidate,
  createInvitation,
  mapWebhookToState,
} = require('../services/checkrService');

const DASH = process.env.CHECKR_DASHBOARD_BASE || 'https://dashboard.staging.checkr.com';

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

// POST /checkr/webhooks/checkr
exports.webhook = asyncHandler(async (req, res) => {
  const event = req.body;
  const obj = event?.data?.object || {};

  // find user either by candidate_id or report id
  let user = null;
  if (obj.candidate_id) {
    user = await User.findOne({ 'driver.checkr.candidateId': obj.candidate_id });
  }
  if (!user && obj.id && obj.object === 'report') {
    user = await User.findOne({ 'driver.checkr.reportId': obj.id });
  }

  if (!user) {
    return res.status(200).json({ received: true, note: 'User not found for event' });
  }

  const updates = mapWebhookToState(event);

  if (updates.reportId) {
    user.driver.checkr.dashboardUrl = `${DASH}/reports/${updates.reportId}`;
  }

  user.driver.checkr = { ...user.driver.checkr, ...updates };

  // mark backgroundCheck boolean
  if (user.driver.checkr.assessment === 'eligible' || user.driver.checkr.result === 'clear') {
    user.driver.backgroundCheck = true;
  }

  await user.save();

  res.status(200).json({ received: true });
});
