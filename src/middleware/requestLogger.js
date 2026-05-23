/**
 * Request-ID + access-log middleware.
 *
 * Generates a request ID (uses the `x-request-id` header if the client sends
 * one), attaches it to `req.id`, mirrors it on the response, and binds a
 * child logger at `req.log` so controllers can write structured logs that
 * are automatically correlated.
 */

const { randomUUID } = require('crypto');
const pinoHttp = require('pino-http');
const logger = require('../utils/logger');

const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id = (typeof incoming === 'string' && incoming.length > 0 && incoming.length < 200)
      ? incoming
      : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});

module.exports = requestLogger;
