// services/checkrService.js
// Hosted/Embeds flow helpers for Checkr (Node/Express)
// Account Email: swifthavenaleet@gmail.com

const axios = require('axios');
const crypto = require('crypto');

const CHECKR_BASE_URL = process.env.CHECKR_BASE_URL
const CHECKR_API_KEY = process.env.CHECKR_API_KEY;

if (!CHECKR_API_KEY) {
  // Don't crash app; just warn to help during local dev
  // eslint-disable-next-line no-console
  console.warn('[Checkr] Missing CHECKR_API_KEY. Set it in your .env for real calls.');
}

const checkr = axios.create({
  baseURL: CHECKR_BASE_URL,
  timeout: 15000,
  auth: {
    username: CHECKR_API_KEY,
    password: ''
  },
  headers: {
    'Content-Type': 'application/json',
  },
});

const defaultCountry = 'US';
const defaultState = 'CA';
const defaultCity = 'San Francisco';
const defaultPackage = 'basic_plus_criminal';
const defaultNodeId = null

// Build work location object per Checkr guidance
function buildWorkLocation(user) {
  // If you store per-user work site, map it here.
  return {
    country: defaultCountry,
    state: defaultState,
    city: defaultCity,
  };
}

function idempotencyKey() {
  return crypto.randomBytes(16).toString('hex');
}

// GET /v1/packages
async function getPackages() {
  const { data } = await checkr.get('/packages');
  console.log(data, 'Checkr packages');
  return data;
}

// POST /v1/candidates (Hosted flow: DO NOT send SSN/DOB here)
async function createCandidate(user) {
  const name = (user?.name || '').trim();
  const parts = name.split(/\s+/);
  const first = parts[0] || 'Driver';
  const last = parts.slice(1).join(' ') || 'User';

  const payload = {
    first_name: first,
    last_name: last,
    email: user.email,                  // required for invitation
    custom_id: String(user._id || ''),  // cross-reference in your system
    work_locations: [buildWorkLocation(user)],
  };

  const { data } = await checkr.post('/candidates', payload, {
    headers: { 'Idempotency-Key': idempotencyKey() },
  });
  return data; // { id, ... }
}

// POST /v1/invitations
async function createInvitation({ candidateId, pkg, nodeId, work }) {
  if (!candidateId) throw new Error('candidateId is required for createInvitation');

  const payload = {
    candidate_id: candidateId,
    package: defaultPackage,
    work_locations: [work || buildWorkLocation({})],
  };

  if (nodeId || defaultNodeId) payload.node = nodeId || defaultNodeId;

  const { data } = await checkr.post('/invitations', payload);
  return data; // { id, report_id?, ... }
}

async function getCandidateReportStatus(candidateId) {
  const { data } = await checkr.get(`/candidates/${candidateId}`);
  return data; // contains reports array
}

// Map a Checkr webhook `event` into fields for user.driver.checkr
function mapWebhookToState(event) {
  const t = event?.type;
  const body = event?.data?.object || {};

  const updates = {
    lastEvent: t || null,
    lastEventAt: new Date(),
  };

  if (t === 'invitation.created') {
    updates.status = 'invited';
  }

  if (t === 'invitation.completed') {
    updates.status = 'pending';
  }

  // report.updated is used to pick up ETA changes
  if (t === 'report.updated') {
    if (body.estimated_completion_time) {
      updates.eta = new Date(body.estimated_completion_time);
    }
  }

  if (t === 'report.completed') {
    updates.status = 'complete';
    updates.result = body.result || null;               // clear | consider
    updates.assessment = body.assessment || null;       // eligible | review | escalated
    updates.includesCanceled = !!body.includes_canceled;
  }

  if (t === 'report.suspended') updates.status = 'suspended';
  if (t === 'report.resumed') updates.status = 'pending';
  if (t === 'report.canceled') updates.status = 'canceled';
  if (t === 'report.disputed') updates.status = 'dispute';

  // capture report id:
  // — from report events (body.id where object=report)
  // — from invitation.completed (body.report_id)
  if (body.id && body.object === 'report') updates.reportId = body.id;
  if (body.report_id) updates.reportId = body.report_id;

  return updates;
}

module.exports = {
  getPackages,
  createCandidate,
  createInvitation,
  mapWebhookToState,
  getCandidateReportStatus,
};
