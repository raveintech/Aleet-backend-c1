/**
 * Spec-conformance tests for `services/cryptoService.js` (T-1.1.1).
 *
 * Covers encrypt/decrypt round-trip, envelope prefix, dual-read fallback,
 * masking, and the strict-decrypt cutover toggle.
 */

const crypto = require('crypto');

// setKey is exported for tests so we can pin a known key per case.
const cryptoSvc = require('../services/cryptoService');

const KEY = Buffer.alloc(32, 7); // deterministic test key
cryptoSvc.setKey(KEY);

describe('encrypt / decrypt round-trip', () => {
  test('Plaintext SSN is encrypted to the envelope prefix and decrypts back', () => {
    const ct = cryptoSvc.encrypt('123-45-6789');
    expect(ct.startsWith(cryptoSvc.PREFIX)).toBe(true);
    expect(cryptoSvc.decrypt(ct)).toBe('123-45-6789');
  });

  test('Encrypt is idempotent — already-encrypted value is not double-encrypted', () => {
    const once = cryptoSvc.encrypt('555-12-3456');
    const twice = cryptoSvc.encrypt(once);
    expect(twice).toBe(once);
  });

  test('Empty / null pass through both sides', () => {
    expect(cryptoSvc.encrypt(null)).toBeNull();
    expect(cryptoSvc.encrypt('')).toBe('');
    expect(cryptoSvc.decrypt(null)).toBeNull();
    expect(cryptoSvc.decrypt('')).toBe('');
  });

  test('Two encrypts of the same plaintext produce different ciphertext (IV randomness)', () => {
    const a = cryptoSvc.encrypt('111-22-3333');
    const b = cryptoSvc.encrypt('111-22-3333');
    expect(a).not.toBe(b);
    expect(cryptoSvc.decrypt(a)).toBe(cryptoSvc.decrypt(b));
  });

  test('Decrypting a tampered ciphertext throws (GCM auth tag check)', () => {
    const ct = cryptoSvc.encrypt('999-99-9999');
    // flip a base64 char in the ciphertext segment
    const parts = ct.split(':');
    parts[4] = parts[4].slice(0, -2) + (parts[4].endsWith('A') ? 'B' : 'A') + '=';
    const tampered = parts.join(':');
    expect(() => cryptoSvc.decrypt(tampered)).toThrow();
  });
});

describe('dual-read posture (Deploy 1a / 1b)', () => {
  test('Plaintext SSN passes through decrypt unchanged when STRICT_DECRYPT_ONLY is off', () => {
    expect(cryptoSvc.decrypt('plaintext-ssn-legacy')).toBe('plaintext-ssn-legacy');
  });

  test('STRICT_DECRYPT_ONLY=true makes plaintext reads throw (Deploy 1c)', () => {
    const prev = process.env.STRICT_DECRYPT_ONLY;
    process.env.STRICT_DECRYPT_ONLY = 'true';
    try {
      expect(() => cryptoSvc.decrypt('plaintext-after-cutover')).toThrow(/strict-decrypt/);
    } finally {
      if (prev === undefined) delete process.env.STRICT_DECRYPT_ONLY;
      else process.env.STRICT_DECRYPT_ONLY = prev;
    }
  });
});

describe('maskSSN', () => {
  test('Masks a plaintext SSN to last-4', () => {
    expect(cryptoSvc.maskSSN('123-45-6789')).toBe('***-**-6789');
  });

  test('Masks an encrypted envelope to last-4 of decrypted digits', () => {
    const ct = cryptoSvc.encrypt('111-22-3456');
    expect(cryptoSvc.maskSSN(ct)).toBe('***-**-3456');
  });

  test('Falls back to fully-masked when decryption fails', () => {
    expect(cryptoSvc.maskSSN('enc:v1:bogus:bogus:bogus')).toBe('***-**-****');
  });

  test('Returns empty string for null / empty input', () => {
    expect(cryptoSvc.maskSSN(null)).toBe('');
    expect(cryptoSvc.maskSSN('')).toBe('');
  });
});
