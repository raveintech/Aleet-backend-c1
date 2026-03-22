// src/utils/time.js
// Small, reusable time helpers used across services and controllers

/**
 * Convert Date|ISO|string to UNIX seconds (integer).
 */
exports.toUnix = (d) => Math.floor(new Date(d).getTime() / 1000);

/**
 * Add N minutes to a date and return a new Date.
 */
exports.addMinutes = (date, minutes) =>
  new Date(new Date(date).getTime() + minutes * 60000);

/**
 * Difference in seconds between two dates (a - b).
 */
exports.diffSec = (a, b) =>
  Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 1000);
