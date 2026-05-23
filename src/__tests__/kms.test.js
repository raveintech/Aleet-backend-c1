/**
 * KMS adapter + selector tests. The AWS path is mocked at the SDK boundary so
 * the suite stays offline.
 */

const cryptoService = require('../services/cryptoService');

describe('cryptoService.initializeKeyFromKms', () => {
  test('Accepts a 32-byte buffer and unlocks encrypt/decrypt', () => {
    // Use a fresh require cache so we get a clean kmsInitialized flag.
    jest.resetModules();
    const fresh = require('../services/cryptoService');
    const dek = Buffer.alloc(32, 9);
    fresh.initializeKeyFromKms(dek);
    const ct = fresh.encrypt('999-99-9999');
    expect(ct.startsWith(fresh.PREFIX)).toBe(true);
    expect(fresh.decrypt(ct)).toBe('999-99-9999');
  });

  test('Throws on wrong-size buffer', () => {
    jest.resetModules();
    const fresh = require('../services/cryptoService');
    expect(() => fresh.initializeKeyFromKms(Buffer.alloc(16, 1))).toThrow(/32-byte/);
  });

  test('Throws if called twice (one-shot boot)', () => {
    jest.resetModules();
    const fresh = require('../services/cryptoService');
    fresh.initializeKeyFromKms(Buffer.alloc(32, 1));
    expect(() => fresh.initializeKeyFromKms(Buffer.alloc(32, 2))).toThrow(/only be called once/);
  });
});

describe('KMS selector (services/kms)', () => {
  const realProvider = process.env.KMS_PROVIDER;
  afterEach(() => {
    if (realProvider === undefined) delete process.env.KMS_PROVIDER;
    else process.env.KMS_PROVIDER = realProvider;
    jest.resetModules();
  });

  test('No-op when KMS_PROVIDER is unset', async () => {
    delete process.env.KMS_PROVIDER;
    jest.resetModules();
    const { initEncryption } = require('../services/kms');
    await expect(initEncryption()).resolves.toBeUndefined();
  });

  test('KMS_PROVIDER=env is the same no-op path', async () => {
    process.env.KMS_PROVIDER = 'env';
    jest.resetModules();
    const { initEncryption } = require('../services/kms');
    await expect(initEncryption()).resolves.toBeUndefined();
  });

  test('Unknown KMS_PROVIDER throws (fail loud, not silent default)', async () => {
    process.env.KMS_PROVIDER = 'gcp'; // not implemented
    jest.resetModules();
    const { initEncryption } = require('../services/kms');
    await expect(initEncryption()).rejects.toThrow(/Unknown KMS_PROVIDER/);
  });

  test('KMS_PROVIDER=aws calls the adapter and seeds the key', async () => {
    process.env.KMS_PROVIDER = 'aws';
    jest.resetModules();

    // Mock the adapter to bypass the real AWS SDK call.
    jest.doMock('../services/kms/awsKmsAdapter', () => ({
      unwrapDek: async () => Buffer.alloc(32, 3),
    }));

    const { initEncryption } = require('../services/kms');
    const freshCrypto = require('../services/cryptoService');

    await expect(initEncryption()).resolves.toBeUndefined();

    // The seeded key is now usable.
    const ct = freshCrypto.encrypt('111-22-3333');
    expect(freshCrypto.decrypt(ct)).toBe('111-22-3333');

    jest.dontMock('../services/kms/awsKmsAdapter');
  });

  test('awsKmsAdapter.unwrapDek throws when SSN_DEK_CIPHERTEXT is missing', async () => {
    const prevDek = process.env.SSN_DEK_CIPHERTEXT;
    const prevKey = process.env.KMS_KEY_ID;
    delete process.env.SSN_DEK_CIPHERTEXT;
    delete process.env.KMS_KEY_ID;
    try {
      jest.resetModules();
      const { unwrapDek } = require('../services/kms/awsKmsAdapter');
      await expect(unwrapDek()).rejects.toThrow(/SSN_DEK_CIPHERTEXT/);
    } finally {
      if (prevDek !== undefined) process.env.SSN_DEK_CIPHERTEXT = prevDek;
      if (prevKey !== undefined) process.env.KMS_KEY_ID = prevKey;
    }
  });
});
