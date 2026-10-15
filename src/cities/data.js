/**
 * Cities and Regions data: cities, regions and their outlines, read from
 * src/data/cities.json and src/data/countries.txt.
 *
 * cities.json holds three tab-separated tables as strings (see docs/data.md):
 *
 * - `cities`: name, other names (";"-separated), country code, region code,
 *   packed longitude/latitude, packed population in thousands, and type
 *   (2 national capital, 1 regional capital, 0 other).
 * - `regions`: code, name, other name, country code.
 * - `regionShapes`: code, then packed rings separated by "|".
 *
 * Region outlines are decoded on first use: there are 4,596 of them and a
 * session rarely needs more than a few dozen.
 *
 * @module cities/data
 */
import { loadData } from "../shared/net.js";
import { unpack, unpackRing } from "../shared/codec.js";
import { byCode, parseCountries } from "../shared/countries.js";

/**
 * @typedef {object} City
 * @property {number} i index, also its id in the page
 * @property {string} name
 * @property {string[]} alts
 * @property {string} iso country code
 * @property {string} reg region code, or ""
 * @property {number} lon
 * @property {number} lat
 * @property {number} pop
 * @property {0 | 1 | 2} t type: 2 national capital, 1 regional capital, 0 other
 */

/**
 * @typedef {object} Region
 * @property {string} code e.g. "AR-E"
 * @property {string} name
 * @property {string} alt another name, or ""
 * @property {string} iso country code
 */

export const CITY_TYPE = { national: 2, regional: 1, other: 0 };

export async function loadCityData() {
  const [json, countryText] = await Promise.all([
    loadData("cities.json"),
    loadData("countries.txt", "text"),
  ]);
  const countries = parseCountries(countryText);
  const countryBy = byCode(countries);

  /** @type {City[]} */
  const cities = json.cities.split("\n").map((line, i) => {
    const f = line.split("\t");
    const [lon, lat] = unpack(f[4]);
    return {
      i,
      name: f[0],
      alts: f[1] ? f[1].split(";") : [],
      iso: f[2],
      reg: f[3],
      lon: lon / json.scale.city,
      lat: lat / json.scale.city,
      pop: unpack(f[5])[0] * 1000,
      t: /** @type {0 | 1 | 2} */ (Number(f[6])),
    };
  });

  /** @type {Region[]} */
  const regions = json.regions.split("\n").map((line) => {
    const [code, name, alt, iso] = line.split("\t");
    return { code, name, alt, iso };
  });
  const regionBy = new Map(regions.map((r) => [r.code, r]));

  const packedShapes = new Map(
    json.regionShapes.split("\n").map((line) => {
      const [code, rings] = line.split("\t");
      return [code, rings ? rings.split("|") : []];
    }),
  );

  return {
    countries,
    countryBy,
    cities,
    regions,
    regionBy,
    regionScale: json.scale.region,
    packedShapes,
    ...capitals(cities),
  };
}

/**
 * Who is capital of what.
 *
 * A region's capital is its regional capital or, for a city-state such as
 * Berlin or Vienna, the national capital that is also the region. Some
 * countries and regions have more than one capital (South Africa has
 * three), so these are lists.
 *
 * @param {City[]} cities
 */
function capitals(cities) {
  /** @type {Map<string, City>} region code → its capital */
  const capitalOfRegion = new Map();
  for (const t of [CITY_TYPE.regional, CITY_TYPE.national]) {
    for (const c of cities) {
      if (c.t === t && c.reg && !capitalOfRegion.has(c.reg)) capitalOfRegion.set(c.reg, c);
    }
  }
  /** @type {Map<string, City[]>} country code → national capitals */
  const nationalCapitals = new Map();
  for (const c of cities) {
    if (c.t !== CITY_TYPE.national) continue;
    if (!nationalCapitals.has(c.iso)) nationalCapitals.set(c.iso, []);
    nationalCapitals.get(c.iso).push(c);
  }
  /** @type {Map<string, City[]>} region code → the region's capitals */
  const regionalCapitals = new Map();
  for (const c of cities) {
    if (c.reg && capitalOfRegion.get(c.reg) === c) regionalCapitals.set(c.reg, [c]);
  }
  return { capitalOfRegion, nationalCapitals, regionalCapitals };
}

/**
 * Region outlines, decoded on demand, with their bounding boxes.
 */
export class RegionShapes {
  /**
   * @param {Map<string, string[]>} packed region code → packed rings
   * @param {number} scale
   */
  constructor(packed, scale) {
    this.packed = packed;
    this.scale = scale;
    /** @type {Map<string, Float64Array[]>} */
    this.rings = new Map();
    /** @type {Map<string, { box: number[], middle: number[] }>} */
    this.boxes = new Map();
  }

  /** @returns {Float64Array[]} longitude/latitude rings */
  ringsOf(code) {
    let rings = this.rings.get(code);
    if (!rings) {
      rings = (this.packed.get(code) ?? []).map((r) => unpackRing(r, this.scale));
      this.rings.set(code, rings);
    }
    return rings;
  }

  /**
   * The region's bounding box [lon, lat, width, height], and the middle of
   * its largest piece (by bounding-box area), which is where a map pointing
   * at "this region" should look.
   */
  extent(code) {
    let hit = this.boxes.get(code);
    if (hit) return hit;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let biggest = -1;
    let middle = null;
    for (const r of this.ringsOf(code)) {
      let a0 = Infinity;
      let b0 = Infinity;
      let a1 = -Infinity;
      let b1 = -Infinity;
      for (let i = 0; i < r.length; i += 2) {
        a0 = Math.min(a0, r[i]);
        a1 = Math.max(a1, r[i]);
        b0 = Math.min(b0, r[i + 1]);
        b1 = Math.max(b1, r[i + 1]);
      }
      const area = (a1 - a0) * (b1 - b0);
      if (area > biggest) {
        biggest = area;
        middle = [(a0 + a1) / 2, (b0 + b1) / 2];
      }
      x0 = Math.min(x0, a0);
      x1 = Math.max(x1, a1);
      y0 = Math.min(y0, b0);
      y1 = Math.max(y1, b1);
    }
    hit = Number.isFinite(x0)
      ? { box: [x0, y0, x1 - x0, y1 - y0], middle }
      : { box: [0, 0, 0.1, 0.1], middle: [0, 0] };
    this.boxes.set(code, hit);
    return hit;
  }
}
