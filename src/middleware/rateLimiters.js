/**
 * Rate Limiters for authentication endpoints.
 *
 * Per-IP buckets via express-rate-limit. Tightest limit is on OTP issuance
 * because each request potentially costs an SMS send.
 */

const rateLimit = require('express-rate-limit');
const { sendError } = require('../utils/responseHelper');

const handler = (req, res /* , next, options */) => {
  return sendError(res, 429, 'Too many requests. Please try again later.');
};

const baseConfig = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
};

// OTP issuance → costs an SMS. Tightest bucket.
const otpStartLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000,
  max: 5,
});

// OTP verify, login → guess-attack surface.
const authAttemptLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000,
  max: 10,
});

// Signup completion + password reset + check-user → moderate.
const generalAuthLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000,
  max: 30,
});

// Pending pages poll on a 30s cadence; with two concurrent pollers (profile +
// Checkr status) a 15-min window holds ~60 calls per endpoint. 120 leaves
// headroom for retries and a brief tab switch without 429ing legit users.
const pollingReadLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000,
  max: 120,
});

module.exports = {
  otpStartLimiter,
  authAttemptLimiter,
  generalAuthLimiter,
  pollingReadLimiter,
};
