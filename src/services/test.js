// services/checkrService.js
// Hosted/Embeds flow helpers for Checkr (Node/Express)

const axios = require('axios');
const crypto = require('crypto');

const CHECKR_BASE_URL = process.env.CHECKR_BASE_URL || 'https://api.checkr-staging.com/v1';
const CHECKR_API_KEY = process.env.CHECKR_API_KEY;

if (!CHECKR_API_KEY) {
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

const defaultCountry = process.env.CHECKR_DEFAULT_COUNTRY || 'US';
const defaultState = process.env.CHECKR_DEFAULT_STATE || 'CA';
const defaultCity = process.env.CHECKR_DEFAULT_CITY || 'San Francisco';
const defaultPackage = process.env.CHECKR_DEFAULT_PACKAGE || 'basic_plus_criminal';
const defaultNodeId = process.env.CHECKR_NODE_ID || null;

// Build work location object per Checkr guidance
function buildWorkLocation(user) {
  return {
    country: defaultCountry,
    state: defaultState,
    city: defaultCity,
  };
}

function idempotencyKey() {
  return crypto.randomBytes(16).toString('hex');
}

// ✅ Get Packages
async function getPackages() {
  const { data } = await checkr.get('/packages');
  console.log(data, 'Checkr packages');
  return data;
}

// ✅ Create Candidate
async function createCandidate(user) {
  const name = (user?.name || '').trim();
  const parts = name.split(/\s+/);
  const first = parts[0] || 'Driver';
  const last = parts.slice(1).join(' ') || 'User';

  const payload = {
    first_name: first,
    last_name: last,
    email: user.email,
    custom_id: String(user._id || ''),
    work_locations: [buildWorkLocation(user)],
  };

  const { data } = await checkr.post('/candidates', payload, {
    headers: { 'Idempotency-Key': idempotencyKey() },
  });
  return data;
}

// ✅ Create Invitation
async function createInvitation({ candidateId, pkg, nodeId, work }) {
  if (!candidateId) throw new Error('candidateId is required for createInvitation');

  const payload = {
    candidate_id: candidateId,
    package: pkg || defaultPackage,
    work_locations: [work || buildWorkLocation({})],
  };

  if (nodeId || defaultNodeId) payload.node = nodeId || defaultNodeId;

  const { data } = await checkr.post('/invitations', payload);
  return data;
}

// ✅ Get Candidate + Report Status
async function getCandidateReportStatus(candidateId) {
  if (!candidateId) throw new Error('candidateId is required');

  // 1️⃣ Get candidate details
  const { data: candidate } = await checkr.get(`/candidates/${candidateId}`);
  console.log('📌 Candidate:', candidate);

  if (!candidate.report_ids || candidate.report_ids.length === 0) {
    console.log(`❌ No background report found for candidate ${candidateId}`);
    return { status: 'no-report' };
  }

  // 2️⃣ Get latest report
  const latestReportId = candidate.report_ids[0];
  const { data: report } = await checkr.get(`/reports/${latestReportId}`);
  console.log('📝 Report:', report);
  console.log('📝 Report:', report.result);


  // 3️⃣ Analyze status/result
  if (report.result === 'clear') {
    return { status: 'approved', report };
  } else if (report.result === 'consider') {
    return { status: 'flagged', report };
  } else {
    return { status: report.status || 'pending', report };
  }
}

// ✅ Map Checkr webhook → DB updates
function mapWebhookToState(event) {
  const t = event?.type;
  const body = event?.data?.object || {};

  const updates = {
    lastEvent: t || null,
    lastEventAt: new Date(),
  };

  if (t === 'invitation.created') updates.status = 'invited';
  if (t === 'invitation.completed') updates.status = 'pending';

  if (t === 'report.updated' && body.estimated_completion_time) {
    updates.eta = new Date(body.estimated_completion_time);
  }

  if (t === 'report.completed') {
    updates.status = 'complete';
    updates.result = body.result || null;
    updates.assessment = body.assessment || null;
    updates.includesCanceled = !!body.includes_canceled;
  }

  if (t === 'report.suspended') updates.status = 'suspended';
  if (t === 'report.resumed') updates.status = 'pending';
  if (t === 'report.canceled') updates.status = 'canceled';
  if (t === 'report.disputed') updates.status = 'dispute';

  if (body.id && body.object === 'report') updates.reportId = body.id;

  console.log(updates, 'updates from checkr webhook');
  return updates;
}

module.exports = {
  getPackages,
  createCandidate,
  createInvitation,
  getCandidateReportStatus,
  mapWebhookToState,
};
getCandidateReportStatus('401bf484d52f8ef4a16c174e')
  .then(res => console.log('✅ Final Status:', res))
  .catch(console.error);