/**
 * Test environment setup — runs before each test file.
 *
 * Tests must not hit external services. We force a known Stripe key, suppress
 * the dotenv inject log, and set NODE_ENV=test so the backend's "dev" SMS
 * fallback is bypassed during unit runs.
 */

process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_unit';
// 32-byte base64 key for cryptoService tests.
process.env.SSN_ENCRYPTION_KEY = process.env.SSN_ENCRYPTION_KEY || Buffer.alloc(32, 1).toString('base64');
process.env.LOG_LEVEL = 'silent';
