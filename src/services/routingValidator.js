// src/services/routingValidator.js
// Builds itinerary legs, fetches API travel estimates per leg using the
// departure time for traffic-aware durations, then enforces a buffer.

const { getLegEstimate } = require('./mapsService');
const { addMinutes, diffSec } = require('../utils/time');

/**
 * Validate a user itinerary.
 * @param {{
 *   pickupLocation: string,
 *   pickupTime: Date|string,
 *   stops: Array<{location:string, arrivalTime:Date|string, dwellMinutes?:number}>,
 *   dropoffLocation: string,
 *   dropoffTime: Date|string
 * }} itinerary
 * @param {{bufferMinutes?:number}} options
 * @returns {{legs:Array, allOk:boolean, validatedAt:Date}}
 */
exports.validateItinerary = async (itinerary, options = {}) => {
  const bufferMinutes = Number(options.bufferMinutes ?? 15);

  // Compose ordered points: Pickup -> ...Stops -> Dropoff
  const points = [
    { label: 'Pickup',  location: itinerary.pickupLocation,  arrival: new Date(itinerary.pickupTime), dwell: 0 },
    ...(itinerary.stops || []).map(s => ({
      label: 'Stop', location: s.location, arrival: new Date(s.arrivalTime), dwell: Number(s.dwellMinutes || 0)
    })),
    { label: 'Dropoff', location: itinerary.dropoffLocation, arrival: new Date(itinerary.dropoffTime), dwell: 0 }
  ];

  if (points.length < 2) throw new Error('Insufficient points to validate');

  const legs = [];
  let allOk = true;

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to   = points[i + 1];

    // Planned departure = arrival + dwell (user may stay at stop N minutes)
    const plannedDeparture = addMinutes(from.arrival, from.dwell);
    const plannedArrival   = to.arrival;

    // Ask maps provider for duration in traffic using departure time
    const api = await getLegEstimate({
      origin: from.location,
      destination: to.location,
      departureTime: plannedDeparture
    });

    const minRequiredGapSec = Number(api.durationInTrafficSec || api.durationSec || 0) + bufferMinutes * 60;
    const actualGapSec = diffSec(plannedArrival, plannedDeparture);
    const ok = actualGapSec >= minRequiredGapSec;

    const recommendation = ok
      ? 'OK'
      : `Increase gap by at least ${Math.ceil((minRequiredGapSec - actualGapSec) / 60)} minutes`;

    legs.push({
      from: from.location,
      to: to.location,
      plannedDeparture,
      plannedArrival,
      api,
      bufferMinutes,
      minRequiredGapSec,
      actualGapSec,
      ok,
      recommendation
    });

    if (!ok) allOk = false;
  }

  return { legs, allOk, validatedAt: new Date() };
};
