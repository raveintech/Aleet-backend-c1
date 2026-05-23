const PlatformConfig = require('../models/PlatformConfig');

let cachedDoc = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 30 * 1000;

const getConfig = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && cachedDoc && now - cacheLoadedAt < CACHE_TTL_MS) return cachedDoc;
  let doc = await PlatformConfig.findOne();
  if (!doc) doc = await PlatformConfig.create({});
  cachedDoc = doc;
  cacheLoadedAt = now;
  return doc;
};

const invalidate = () => {
  cachedDoc = null;
  cacheLoadedAt = 0;
};

module.exports = { getConfig, invalidate };
