/**
 * Distances, directions and point-in-shape tests on longitude/latitude.
 *
 * Rings are flat arrays of alternating longitude and latitude,
 * `[lon0, lat0, lon1, lat1, …]`, as the decoders in codec.js produce.
 *
 * @module shared/geo
 */

const RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;
/** Kilometres per degree of latitude (and of longitude at the equator). */
const KM_PER_DEGREE = 111.195;

/** Great-circle distance in kilometres (haversine). */
export function distKm(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
];

/**
 * The compass direction of the second point as seen from the first, to the
 * nearest of eight points, along the great circle between them.
 *
 * Keep the argument order fixed at every call site. The feedback sentence is
 * always "X lies <direction> of where you clicked", so the click comes first
 * and the answer second. Mixing the two once produced directions that were
 * exactly backwards.
 *
 * @returns {string} e.g. "north-east"
 */
export function bearing(fromLon, fromLat, toLon, toLat) {
  const y = Math.sin((toLon - fromLon) * RAD) * Math.cos(toLat * RAD);
  const x =
    Math.cos(fromLat * RAD) * Math.sin(toLat * RAD) -
    Math.sin(fromLat * RAD) * Math.cos(toLat * RAD) * Math.cos((toLon - fromLon) * RAD);
  const degrees = (Math.atan2(y, x) / RAD + 360) % 360;
  return COMPASS[Math.round(degrees / 45) % 8];
}

/**
 * Distance in kilometres from a point to a line segment, on a local flat
 * approximation (longitude scaled by the cosine of latitude). Accurate over
 * the few hundred kilometres a near miss covers, which is all it is used for.
 */
export function segmentDistKm(lon, lat, aLon, aLat, bLon, bLat) {
  const k = Math.cos(lat * RAD);
  const px = (aLon - lon) * k;
  const py = aLat - lat;
  const dx = (bLon - lon) * k - px;
  const dy = bLat - lat - py;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(px * dx + py * dy) / len2)) : 0;
  return Math.hypot(px + dx * t, py + dy * t) * KM_PER_DEGREE;
}

/**
 * Whether a point lies inside a set of rings, by the even-odd rule: each
 * ring crossed flips inside to outside. A hole, or a region wrapped around
 * an enclave, therefore reads as not containing the enclosed area.
 *
 * @param {ArrayLike<number>[]} rings
 */
export function ringsContain(rings, lon, lat) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1];
      const yj = r[j + 1];
      if (yi > lat !== yj > lat && lon < ((r[j] - r[i]) * (lat - yi)) / (yj - yi) + r[i]) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * The point on the edges of a set of rings closest to a given point, on the
 * same local flat approximation as {@link segmentDistKm}.
 *
 * @param {ArrayLike<number>[]} rings
 * @returns {[number, number] | null} [lon, lat], or null for no rings
 */
export function nearestOnRings(rings, lon, lat) {
  const k = Math.cos(lat * RAD) || 1e-6;
  let best = null;
  let bestD = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = (r[j] - lon) * k;
      const ay = r[j + 1] - lat;
      const dx = (r[i] - lon) * k - ax;
      const dy = r[i + 1] - lat - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const px = ax + dx * t;
      const py = ay + dy * t;
      const d = px * px + py * py;
      if (d < bestD) {
        bestD = d;
        best = [lon + px / k, lat + py];
      }
    }
  }
  return best;
}

/**
 * Approximate area of one ring in square kilometres, using its mean
 * latitude to scale longitude. Good enough to tell an island from a
 * continent, which is all it is for.
 * @param {ArrayLike<number>} ring
 */
export function ringAreaKm2(ring) {
  const n = ring.length;
  if (n < 6) return 0;
  let twiceArea = 0;
  let latSum = 0;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    twiceArea += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
    latSum += ring[i + 1];
  }
  const meanLat = latSum / (n / 2);
  return Math.abs(twiceArea / 2) * KM_PER_DEGREE ** 2 * Math.cos(meanLat * RAD);
}

/**
 * Format a distance for feedback text: one decimal under 10 km, whole
 * kilometres with thousands separators above.
 * @param {number} km
 */
export const formatKm = (km) => (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("en"));
