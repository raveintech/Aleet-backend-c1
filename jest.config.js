/**
 * Jest configuration — backend unit tests.
 *
 * Pure-function tests only for the initial pass (T-2.3.3): payout matrices,
 * pricing helpers, same-day calculator. Controller / integration tests will
 * follow once a test Mongo instance is wired up.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFiles: ['<rootDir>/src/__tests__/setupEnv.js'],
  // Pure-function tests don't need a Mongo connection; the few that touch
  // mongoose schemas import them but never call .save / .find.
  testTimeout: 5000,
  clearMocks: true,
  // Don't bother with coverage thresholds yet — first pass is "any tests at all".
  coverageProvider: 'v8',
};
