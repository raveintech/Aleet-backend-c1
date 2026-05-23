/**
 * AWS KMS adapter — unwraps the data encryption key (DEK) used by
 * cryptoService.
 *
 * Wrapping scheme (envelope encryption, AWS-standard):
 *   - Master key (KEK) lives in AWS KMS, identified by `KMS_KEY_ID`
 *     (alias/aleet-ssn or full ARN). Never leaves AWS.
 *   - DEK is 32 random bytes generated ONCE per environment, wrapped via
 *     `kms.Encrypt({ KeyId, Plaintext: dek })`. The ciphertext blob lives
 *     in `SSN_DEK_CIPHERTEXT` (base64, written to secrets manager).
 *   - At boot, the app calls `kms.Decrypt({ CiphertextBlob })` to unwrap
 *     the DEK in memory and pass it to `cryptoService.setKey(buf)`.
 *
 * The runbook in `docs/ssn-encryption-runbook.md` describes IAM scoping,
 * the rotation procedure, and the dev-environment story.
 */

const logger = require('../../utils/logger');

const cleanEnv = (raw) => String(raw || '').trim().replace(/^['"]|['"]$/g, '');

let cachedKmsClient = null;

const getKmsClient = () => {
  if (cachedKmsClient) return cachedKmsClient;
  // Lazy-require so dev environments without KMS configured don't pay the
  // import cost. The @aws-sdk/client-kms package is in dependencies.
  const { KMSClient } = require('@aws-sdk/client-kms');
  const region = cleanEnv(process.env.AWS_REGION) || cleanEnv(process.env.KMS_REGION) || 'us-east-1';
  cachedKmsClient = new KMSClient({ region });
  return cachedKmsClient;
};

/**
 * Decrypt the wrapped DEK and return the raw 32-byte Buffer.
 *
 * Throws (not silently returns null) when the env vars are misconfigured or
 * the Decrypt call fails — boot should fail loud so a misconfigured prod
 * never silently falls back to an env-var key.
 */
const unwrapDek = async () => {
  const wrapped = cleanEnv(process.env.SSN_DEK_CIPHERTEXT);
  const keyId = cleanEnv(process.env.KMS_KEY_ID);

  if (!wrapped) {
    throw new Error('SSN_DEK_CIPHERTEXT is not set — cannot unwrap KMS-wrapped DEK');
  }
  if (!keyId) {
    // KMS will infer the KeyId from the ciphertext metadata, but requiring it
    // here forces ops to be explicit about which key they're trusting.
    throw new Error('KMS_KEY_ID is not set — refusing to call KMS.Decrypt without explicit key context');
  }

  const { DecryptCommand } = require('@aws-sdk/client-kms');
  const client = getKmsClient();
  const result = await client.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(wrapped, 'base64'),
      KeyId: keyId,
    })
  );

  if (!result.Plaintext || result.Plaintext.length !== 32) {
    throw new Error(`KMS Decrypt returned an unexpected key length (${result.Plaintext?.length ?? 0} bytes, want 32)`);
  }

  logger.info({ keyId }, 'AWS KMS unwrapped the SSN DEK');
  return Buffer.from(result.Plaintext);
};

module.exports = { unwrapDek };
