/**
 * Pricing helpers — late-night override and overage rates.
 *
 * Per `phase2_notes.docx` and the P0 answers (B2, B5):
 *   - Late-night window is `[00:00, 09:00)` city-local. Hours that fall in the
 *     window are priced at standard rate even for members (and Founder 30).
 *   - Region.timezone is the city-local anchor; if absent, UTC is used.
 *   - Overage hours (above `hoursIncluded` on the subscriber's active
 *     Subscription) are billed at the plan's overage rate ($89/hr Membership,
 *     $69/hr Founder 30).
 *
 * Both behaviours sit behind feature flags so the legacy paths remain the
 * default until finance dry-runs the change.
 */

const PLAN_OVERAGE_RATES = {
  Membership: 89,
  'Founder 30': 69,
};

const LATE_NIGHT_START_HOUR = 0;
const LATE_NIGHT_END_HOUR = 9;

const getOverageRate = (plan) => PLAN_OVERAGE_RATES[plan] ?? null;

/**
 * Read the city-local hour (0-23) from a UTC instant.
 * Falls back to UTC when no timezone is provided. Uses Intl.DateTimeFormat
 * which is available in Node 20+ without any extra dependency.
 */
const cityLocalHour = (date, timezone) => {
  if (!timezone) return new Date(date).getUTCHours();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date(date));
    const hourPart = parts.find((p) => p.type === 'hour');
    if (!hourPart) return new Date(date).getUTCHours();
    const h = parseInt(hourPart.value, 10);
    return Number.isFinite(h) ? h % 24 : new Date(date).getUTCHours();
  } catch (_err) {
    return new Date(date).getUTCHours();
  }
};

/**
 * Count how many whole hours of [startDate, endDate) fall inside the
 * late-night window [00, 09) in the given city-local timezone.
 *
 * The trip is scanned in 1-hour buckets starting at the pickup minute, which
 * is fast enough for the longest trip the platform allows (7 days = 168 buckets)
 * and removes the need to reason about DST boundaries explicitly — every
 * bucket asks Intl what city-local hour it lands in.
 */
const countLateNightHours = (startDate, endDate, timezone) => {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const totalHours = Math.floor((end - start) / (3600 * 1000));
  let lateNight = 0;
  for (let i = 0; i < totalHours; i++) {
    const sampleAt = start + i * 3600 * 1000;
    const h = cityLocalHour(sampleAt, timezone);
    if (h >= LATE_NIGHT_START_HOUR && h < LATE_NIGHT_END_HOUR) lateNight += 1;
  }
  return lateNight;
};

module.exports = {
  PLAN_OVERAGE_RATES,
  LATE_NIGHT_START_HOUR,
  LATE_NIGHT_END_HOUR,
  getOverageRate,
  cityLocalHour,
  countLateNightHours,
};
