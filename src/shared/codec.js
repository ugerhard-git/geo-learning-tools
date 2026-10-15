/**
 * Decoders for the compact coordinate formats in src/data/, and the step that
 * turns decoded coordinates into SVG path data.
 *
 * Two formats are in use, both delta-encoded: each pair after the first is
 * the change from the previous point, which keeps the numbers small.
 *
 * - **Packed** (cities.json, terrain.json, the landing page): integers
 *   written 6 bits per character, see {@link unpack}.
 * - **CSV** (world.json): integers in hundredths of a degree, as
 *   comma-separated text, rings separated by "|".
 *
 * @module shared/codec
 */

/** 64 characters that are safe inside JSON strings and JavaScript template literals. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) DIGIT[ALPHABET.charCodeAt(i)] = i;

/**
 * Unpack a string of 6-bit characters into signed integers.
 *
 * Each character carries 5 bits of value and a continuation bit (the 6th):
 * while it is set, the next character adds the next 5 bits. Signs are
 * zig-zag encoded, so 0, -1, 1, -2, 2 … are stored as 0, 1, 2, 3, 4 …,
 * keeping small negative numbers short. Characters outside the alphabet are
 * skipped.
 *
 * @param {string} s
 * @returns {number[]}
 */
export function unpack(s) {
  const out = [];
  let value = 0;
  let shift = 0;
  for (let i = 0; i < s.length; i++) {
    const d = DIGIT[s.charCodeAt(i)];
    if (d < 0) continue;
    value |= (d & 31) << shift;
    if (d & 32) {
      shift += 5;
    } else {
      out.push(value & 1 ? -((value + 1) >> 1) : value >> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/**
 * Turn delta-encoded integer pairs into absolute coordinates.
 * @param {number[]} deltas [x0, y0, dx1, dy1, …]
 * @param {number} scale the integers are coordinates multiplied by this
 * @returns {Float64Array} [lon0, lat0, lon1, lat1, …]
 */
export function undelta(deltas, scale) {
  const out = new Float64Array(deltas.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < deltas.length; i += 2) {
    x += deltas[i];
    y += deltas[i + 1];
    out[i] = x / scale;
    out[i + 1] = y / scale;
  }
  return out;
}

/** Decode one packed ring to longitude/latitude. */
export const unpackRing = (packed, scale) => undelta(unpack(packed), scale);

/** Decode the CSV rings of one world.json feature to longitude/latitude. */
export const csvRings = (text) =>
  text.split("|").map((ring) => undelta(ring.split(",").map(Number), 100));

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * SVG path data for decoded rings, projected. Coordinates are rounded to a
 * tenth of a map unit, far below what a screen can show, to keep the DOM small.
 *
 * @param {ArrayLike<number>[]} rings
 * @param {{ fwd(lon: number, lat: number): [number, number] }} proj
 * @param {object} [options]
 * @param {boolean} [options.close] close each ring (shapes) or leave it open (lines)
 * @param {number} [options.minPoints] skip rings with fewer points than this
 * @returns {string}
 */
export function ringsToPath(rings, proj, { close = true, minPoints = 3 } = {}) {
  let d = "";
  for (const r of rings) {
    if (r.length < minPoints * 2) continue;
    for (let i = 0; i < r.length; i += 2) {
      const [x, y] = proj.fwd(r[i], r[i + 1]);
      d += `${i ? "L" : "M"}${round1(x)} ${round1(y)}`;
    }
    if (close) d += "Z";
  }
  return d;
}
