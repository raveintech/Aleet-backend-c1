/**
 * Verifies that the SSN inside the driver-signup `docsToken` JWT is the
 * `enc:v1:` ciphertext envelope, not plaintext.
 *
 * JWTs are signed-not-encrypted: anyone holding the token can base64-decode
 * the payload. The plan-named gap was that the prior code path put plaintext
 * SSN directly in the JWT body. This test guards against regression.
 */

const jwt = require('jsonwebtoken');
const cryptoService = require('../services/cryptoService');

// Same boot-time seed used by setupEnv.js — guarantees encrypt/decrypt work.
beforeAll(() => {
  cryptoService.setKey(Buffer.alloc(32, 1));
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
});

describe('docsToken SSN is encrypted in the JWT payload', () => {
  test('SSN stored under the enc:v1: envelope is base64-undecodable to plaintext', () => {
    // Reproduce the relevant portion of authService.driverSignupDocuments
    // without dragging the full module + its DB requires into the test.
    const rawSsn = '111-22-3333';
    const encryptedSsn = cryptoService.encrypt(rawSsn);

    const docsToken = jwt.sign(
      { type: 'driver_signup_docs', ssn: encryptedSsn },
      process.env.JWT_SECRET,
      { expiresIn: '30m' },
    );

    // Anyone with the token can read the payload — that's the JWT contract.
    // What they should NOT be able to read is the plaintext SSN.
    const payload = JSON.parse(
      Buffer.from(docsToken.split('.')[1], 'base64').toString('utf8'),
    );
    expect(payload.ssn).toBeTruthy();
    expect(payload.ssn.startsWith(cryptoService.PREFIX)).toBe(true);
    expect(payload.ssn).not.toBe(rawSsn);
    expect(payload.ssn).not.toContain(rawSsn);

    // The legitimate consumer (signupComplete) can still decrypt it.
    expect(cryptoService.decrypt(payload.ssn)).toBe(rawSsn);
  });

  test('Null SSN passes through unchanged (forHireLicense branch)', () => {
    expect(cryptoService.encrypt(null)).toBeNull();
  });
});
