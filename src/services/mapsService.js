// src/services/mapsService.js
// Provider-agnostic adapter around Google Distance Matrix (default)
// or Mapbox Directions Matrix (optional). Keeps controllers clean.

const axios = require('axios');
const { toUnix } = require('../utils/time');

const PROVIDER = "google"

/**
 * Google Distance Matrix (traffic-aware with departure_time)
 * origin/destination can be freeform addresses (Google geocodes internally).
 */
async function googleDistanceMatrix({ origin, destination, departureTime }) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY missing');

  const params = new URLSearchParams({
    origins: origin,
    destinations: destination,
    key,
    units: 'imperial',
    departure_time: String(toUnix(departureTime) || 'now'),
    traffic_model: 'best_guess'
  });

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;
  const { data } = await axios.get(url, { timeout: 15000 });
  const el = data?.rows?.[0]?.elements?.[0];

  if (!el || el.status !== 'OK') {
    const status = el?.status || data?.status || 'UNKNOWN';
    throw new Error(`Google DistanceMatrix error: ${status}`);
  }

  return {
    provider: 'google',
    distanceMeters: el.distance?.value ?? null,
    durationSec: el.duration?.value ?? null,
    durationInTrafficSec: el.duration_in_traffic?.value ?? el.duration?.value ?? null
  };
}

/**
 * Mapbox Directions Matrix (optional)
 * NOTE: Mapbox requires "lon,lat" for points. If you want to use Mapbox,
 * send pre-geocoded "lng,lat" strings from your front end or add a geocoder.
 */
async function mapboxMatrix({ origin, destination, departureTime }) {
  const token = process.env.MAPBOX_API_KEY;
  if (!token) throw new Error('MAPBOX_API_KEY missing');

  const base = 'https://api.mapbox.com/directions-matrix/v1/mapbox/driving';
  const annotations = 'duration,distance';
  const departAt = new Date(departureTime).toISOString();

  const url = `${base}/${origin};${destination}?sources=0&destinations=1&annotations=${annotations}&access_token=${token}&depart_at=${departAt}`;
  const { data } = await axios.get(url, { timeout: 15000 });

  const dur = data?.durations?.[0]?.[1];
  const dist = data?.distances?.[0]?.[1];
  if (dur == null) throw new Error('Mapbox matrix error');

  return {
    provider: 'mapbox',
    distanceMeters: Math.round(dist),
    durationSec: Math.round(dur),
    durationInTrafficSec: Math.round(dur) // treat as traffic-aware
  };
}

/**
 * Public service: get travel estimate for a single leg.
 */
exports.getLegEstimate = async ({ origin, destination, departureTime }) => {
  if (PROVIDER === 'mapbox') {
    return mapboxMatrix({ origin, destination, departureTime });
  }
  return googleDistanceMatrix({ origin, destination, departureTime });
};
