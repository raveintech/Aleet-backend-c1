/**
 * Structured logger (pino) with PII redaction.
 *
 * The redaction policy enforces masking of SSN, OTP, password, and token-shaped
 * paths at the serializer layer so individual call sites do not have to
 * remember which keys to omit. Adding a new sensitive field is a one-line
 * change to REDACT_PATHS.
 */

const pino = require('pino');

const REDACT_PATHS = [
  '*.ssn',
  '*.SSN',
  '*.password',
  '*.passcode',
  '*.otp',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.signupToken',
  '*.driverToken',
  '*.tempToken',
  '*.docsToken',
  '*.authorization',
  '*.Authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'body.ssn',
  'body.password',
  'body.passcode',
  'body.otp',
  'body.token',
];

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  base: { service: 'aleet-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
module.exports.REDACT_PATHS = REDACT_PATHS;
