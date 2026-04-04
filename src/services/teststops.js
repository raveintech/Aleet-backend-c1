/**
 * Google Distance Matrix — Core API Smoke Test (CommonJS)
 * -------------------------------------------------------
 * Directly hits Google's API (no backend), computes min required gap
 * = duration_in_traffic + buffer (default 15 min).
 *
 * Usage:
 *   1) npm i dotenv (optional, if using .env)
 *   2) .env:
 *        GOOGLE_MAPS_API_KEY=AIza...yourKey
 *        BUFFER_MINUTES=15
 *        UNITS=imperial            # or metric
 *        TRAFFIC_MODEL=best_guess  # or pessimistic | optimistic
 *   3) node src/services/teststops.js
 *
 * Notes:
 * - Requires billing-enabled Google project with Distance Matrix API enabled.
 * - 'departure_time' must be "now" OR a valid ISO datetime string (UTC preferred).
 * - On Windows PowerShell: node .\src\services\teststops.js
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ====== CONFIG ======
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const BUFFER_MINUTES = 15
const UNITS = "imperial"
const TRAFFIC_MODEL = "best_guess"

// Test legs — feel free to edit/extend:
const TEST_LEGS = [
  {
    name: "DC → Richmond (tight-should-fail in app)",
    origin: "Washington, DC",
    destination: "Richmond, VA",
    departure_time: "2025-10-12T16:00:00.000Z", // 4:00 PM UTC
  },
  {
    name: "Richmond → Norfolk",
    origin: "Richmond, VA",
    destination: "Norfolk, VA",
    departure_time: "2025-10-12T17:30:00.000Z", // 5:30 PM UTC
  },
];

// ====== HELPERS ======
function toEpochSeconds(departure_time) {
  if (!departure_time || typeof departure_time !== "string") {
    return Math.floor(Date.now() / 1000);
  }
  if (departure_time.toLowerCase() === "now") {
    return Math.floor(Date.now() / 1000);
  }
  const d = new Date(departure_time);
  const t = Math.floor(d.getTime() / 1000);
  if (Number.isNaN(t)) {
    throw new Error(
      `Invalid departure_time: ${departure_time}. Use "now" or ISO UTC like 2025-10-12T16:00:00.000Z`
    );
  }
  return t;
}

// pretty seconds → "Hh Mm"
function prettyMinutes(sec) {
  const mins = Math.round(sec / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function tsName(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return path.join(process.cwd(), `${prefix}-${stamp}.json`);
}

// ====== CORE CALL ======
async function distanceMatrix(origin, destination, departEpoch) {
  const params = new URLSearchParams({
    origins: origin,
    destinations: destination,
    key: GOOGLE_MAPS_API_KEY,
    units: UNITS,
    departure_time: String(departEpoch),
    traffic_model: TRAFFIC_MODEL,
  });
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json;
}

// ====== RUN ======
(async function run() {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error(
      "❌ GOOGLE_MAPS_API_KEY missing. Put it in your environment or .env file."
    );
    process.exit(1);
  }

  const results = [];
  console.log(`\n🚦 Google Distance Matrix — Smoke Test (CJS)`);
  console.log(
    `   units=${UNITS}, buffer=${BUFFER_MINUTES}m, traffic_model=${TRAFFIC_MODEL}\n`
  );

  for (const test of TEST_LEGS) {
    const departEpoch = toEpochSeconds(test.departure_time);
    process.stdout.write(
      `→ ${test.name}: ${test.origin} → ${test.destination} ... `
    );

    try {
      const data = await distanceMatrix(
        test.origin,
        test.destination,
        departEpoch
      );

      const el = data?.rows?.[0]?.elements?.[0];
      const apiStatus = data?.status || "NO_STATUS";
      const legStatus = el?.status || "NO_LEG_STATUS";

      if (apiStatus !== "OK" || legStatus !== "OK") {
        console.log("not OK");
        results.push({
          ...test,
          ok: false,
          apiStatus,
          legStatus,
          raw: data,
          note: "API or leg status not OK",
        });
        continue;
      }

      const distanceText = el.distance?.text;
      const distanceVal = el.distance?.value; // meters
      const duration = el.duration?.value; // seconds
      const durationTraffic = el.duration_in_traffic?.value ?? duration; // seconds

      const minRequiredSec = durationTraffic + BUFFER_MINUTES * 60;

      console.log("OK");
      results.push({
        ...test,
        ok: true,
        apiStatus,
        legStatus,
        distance_meters: distanceVal,
        distance_text: distanceText,
        duration_sec: duration,
        duration_in_traffic_sec: durationTraffic,
        min_required_gap_sec: minRequiredSec,
      });

      // Pretty print summary
      console.log(
        `   distance: ${distanceText} | normal: ${prettyMinutes(
          duration
        )} | in_traffic: ${prettyMinutes(
          durationTraffic
        )} | min_gap(+${BUFFER_MINUTES}m): ${prettyMinutes(minRequiredSec)}`
      );
    } catch (e) {
      console.log("ERR");
      results.push({
        ...test,
        ok: false,
        error: e.message,
      });
      console.error(`   ⚠️  ${e.message}`);
      console.error(`   Hints:
      - Ensure billing ON & Distance Matrix API enabled
      - departure_time must be "now" or a future epoch/ISO
      - Check key restrictions (HTTP referrers/IPs)`);
    }
  }

  const outfile = tsName("distance_matrix_results");
  fs.writeFileSync(
    outfile,
    JSON.stringify(
      {
        buffer_minutes: BUFFER_MINUTES,
        units: UNITS,
        traffic_model: TRAFFIC_MODEL,
        results,
      },
      null,
      2
    )
  );
  console.log(`\n💾 Saved: ${outfile}\n`);

  // Exit non-zero if any failed (useful in CI)
  const anyFail = results.some((r) => !r.ok);
  process.exit(anyFail ? 2 : 0);
})().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
