/**
 * Field-level encryption for sensitive PII (T-1.1.1).
 *
 * Algorithm: AES-256-GCM. Key sourced from env var `SSN_ENCRYPTION_KEY` as
 * 32 raw bytes base64-encoded. Production should source this key from the
 * cloud KMS via `kms.Decrypt(wrappedDek)` and pass the unwrapped buffer to
 * `setKey()` once at boot — the rest of this module is agnostic to where
 * the key comes from.
 * 
 * Envelope format (string):
 *   enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 *
 * The version prefix lets us rotate keys / change algorithms without
 * losing access to historical rows.
 *
 * Deploy 1a posture (current): every write is encrypted. Reads accept both
 * the envelope and legacy plaintext (`isEncrypted()` discriminates). This
 * lets old plaintext rows continue to read while new writes encrypt.
 * Deploy 1b backfills plaintext → ciphertext. Deploy 1c removes the
 * plaintext-read fallback (set `STRICT_DECRYPT_ONLY=true`).
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

let cachedKey = null;

const loadKeyFromEnv = () => {
  const raw = (process.env.SSN_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  let buf;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch (_err) {
    return null;
  }
  if (buf.length !== KEY_BYTES) return null;
  return buf;
};

const getKey = () => {
  if (cachedKey) return cachedKey;
  cachedKey = loadKeyFromEnv();
  return cachedKey;
};

// Test seam — production code should not call this. Gated so an in-process
// module can't silently swap the production key.
const setKey = (buf) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('cryptoService.setKey() is disabled in production; use initializeKeyFromKms()');
  }
  if (!Buffer.isBuffer(buf) || buf.length !== KEY_BYTES) {
    throw new Error(`SSN encryption key must be a ${KEY_BYTES}-byte Buffer`);
  }
  cachedKey = buf;
};

let kmsInitialized = false;
/**
 * Boot-only key load from a KMS adapter. Allowed in any environment but only
 * once per process — a second call throws, so a compromised in-process module
 * cannot silently swap the key after boot.
 */
const initializeKeyFromKms = (buf) => {
  if (kmsInitialized) {
    throw new Error('cryptoService.initializeKeyFromKms() may only be called once per process');
  }
  if (!Buffer.isBuffer(buf) || buf.length !== KEY_BYTES) {
    throw new Error(`KMS-unwrapped DEK must be a ${KEY_BYTES}-byte Buffer`);
  }
  cachedKey = buf;
  kmsInitialized = true;
};

// Boot-time assertion in production: fail loud if neither the env-var key
// nor a KMS provider is configured. The KMS provider path skips the env-var
// check because the KEK lives in AWS — the env-var key is the legacy source.
if (process.env.NODE_ENV === 'production') {
  const usingKms = String(process.env.KMS_PROVIDER || '').toLowerCase() === 'aws';
  if (!usingKms && !loadKeyFromEnv()) {
    throw new Error(
      'SSN encryption key is not configured. Either set SSN_ENCRYPTION_KEY (32-byte base64) ' +
      'or set KMS_PROVIDER=aws with KMS_KEY_ID + SSN_DEK_CIPHERTEXT. Refusing to boot.'
    );
  }
}

const isEncrypted = (value) => typeof value === 'string' && value.startsWith(PREFIX);

const isStrictDecryptOnly = () => /^(1|true|yes|on)$/i.test(process.env.STRICT_DECRYPT_ONLY || '');

/**
 * Encrypt a UTF-8 string. Returns the envelope. Throws if the key is not
 * configured — callers MUST surface a clear error rather than silently
 * persisting plaintext.
 */
const encrypt = (plaintext) => {
  if (plaintext == null || plaintext === '') return plaintext;
  if (isEncrypted(plaintext)) return plaintext; // idempotent — already encrypted
  const key = getKey();
  if (!key) {
    throw new Error(
      'SSN_ENCRYPTION_KEY is not configured. Refusing to persist plaintext PII.'
    );
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
};

/**
 * Decrypt an envelope. If `value` is plaintext (no prefix), behaviour depends
 * on `STRICT_DECRYPT_ONLY`:
 *   - false (Deploy 1a/1b): return the plaintext as-is — dual-read fallback.
 *   - true  (Deploy 1c+):   throw — backfill should have caught this.
 */
const decrypt = (value) => {
  if (value == null || value === '') return value;
  if (!isEncrypted(value)) {
    if (isStrictDecryptOnly()) {
      throw new Error('Encountered plaintext PII after strict-decrypt cutover');
    }
    return value;
  }
  const key = getKey();
  if (!key) {
    throw new Error('SSN_ENCRYPTION_KEY is not configured. Cannot decrypt PII.');
  }
  const [, , ivB64, tagB64, ctB64] = value.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
};

/**
 * Mask an SSN for display. Accepts encrypted or plaintext input. Falls back
 * to a fully-masked value if decryption fails — never echo the encrypted
 * envelope to a UI surface.
 */
const maskSSN = (value) => {
  if (!value) return '';
  let plain;
  try {
    plain = decrypt(value);
  } catch (err) {
    logger.warn({ err: err.message }, 'maskSSN failed to decrypt');
    return '***-**-****';
  }
  const digits = String(plain).replace(/\D/g, '');
  if (digits.length < 4) return '***-**-****';
  return `***-**-${digits.slice(-4)}`;
};

module.exports = {
  PREFIX,
  encrypt,
  decrypt,
  maskSSN,
  isEncrypted,
  isStrictDecryptOnly,
  initializeKeyFromKms,
  // exported for tests only
  setKey,
};
