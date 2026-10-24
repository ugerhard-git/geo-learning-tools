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
import { unpack } from "../shared/codec.js";
import { RegionShapes, parseRegionShapes } from "../shared/regions.js";

export { RegionShapes };
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

  const packedShapes = parseRegionShapes(json.regionShapes);

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
