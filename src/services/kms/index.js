/**
 * KMS provider selector. The runtime picks an adapter based on `KMS_PROVIDER`:
 *
 *   KMS_PROVIDER=aws            → AWS KMS (envelope encryption, recommended for prod)
 *   KMS_PROVIDER=env or unset   → legacy env-var key (dev / staging)
 *
 * `initEncryption` runs once at boot, before the app listens. It is a
 * no-op when KMS_PROVIDER is unset / `env`, because cryptoService already
 * loads the key lazily from `SSN_ENCRYPTION_KEY` in that mode.
 */

const logger = require('../../utils/logger');
const cryptoService = require('../cryptoService');

const initEncryption = async () => {
  const provider = String(process.env.KMS_PROVIDER || '').trim().toLowerCase();

  if (!provider || provider === 'env') {
    // Legacy / dev path. cryptoService.loadKeyFromEnv runs at first use; if
    // SSN_ENCRYPTION_KEY is also missing in production, cryptoService's
    // boot-time assertion will already have thrown when it was required.
    logger.info({ provider: provider || 'env' }, 'SSN encryption: using env-var key source');
    return;
  }

  if (provider === 'aws') {
    const { unwrapDek } = require('./awsKmsAdapter');
    const dek = await unwrapDek();
    cryptoService.initializeKeyFromKms(dek);
    logger.info('SSN encryption: AWS KMS-backed DEK loaded into memory');
    return;
  }

  throw new Error(`Unknown KMS_PROVIDER: ${provider} (expected "aws" or "env")`);
};

module.exports = { initEncryption };
