/**
 * Terrain data: 2,121 physical features from src/data/terrain.json.
 *
 * `features` is a tab-separated table, one feature per line:
 *
 *     kind  name  other names (;)  continent  countries ( · )  Wikidata id
 *     extra (a peak's height in metres)  scalerank  geometry type  parts (|)
 *
 * The geometry type is "p" for an area (closed rings), "l" for a line
 * (rivers) or "x" for a point (peaks). Parts are packed coordinates (see
 * shared/codec.js), at `scale.point` units per degree for points and
 * `scale.line` for the rest.
 *
 * @module terrain/data
 */
import { loadData } from "../shared/net.js";
import { unpackRing } from "../shared/codec.js";
import { table } from "../shared/dom.js";

/**
 * The kinds of feature, in the order the layer switches list them. `one`
 * names a single feature in a question ("Which mountain range …").
 */
export const KINDS = table({
  riv: { label: "Rivers", one: "River" },
  lak: { label: "Lakes", one: "Lake" },
  sea: { label: "Seas & oceans", one: "Sea" },
  gul: { label: "Gulfs & bays", one: "Gulf or bay" },
  str: { label: "Straits & channels", one: "Strait or channel" },
  rng: { label: "Mountain ranges", one: "Mountain range" },
  pea: { label: "Peaks", one: "Peak" },
  des: { label: "Deserts", one: "Desert" },
  plt: { label: "Plateaus & plains", one: "Plateau or plain" },
  isl: { label: "Islands", one: "Island" },
  pen: { label: "Peninsulas & capes", one: "Peninsula or cape" },
  reg: { label: "Land regions", one: "Land region" },
});

export const KIND_ORDER = Object.keys(KINDS);

/** Continents, plus the open ocean for seas that belong to none. */
export const CONTINENTS = table({
  F: "Africa",
  A: "Americas",
  S: "Asia",
  E: "Europe",
  O: "Oceania",
  N: "Antarctica",
  W: "Open ocean",
});

/**
 * @typedef {object} Feature
 * @property {number} i its line in the data, used as its id on the page
 * @property {string} kind a key of {@link KINDS}
 * @property {string} name
 * @property {string[]} alts
 * @property {string} cont a key of {@link CONTINENTS}
 * @property {string[]} countries
 * @property {string} qid Wikidata id, or ""
 * @property {string} extra
 * @property {number} rank Natural Earth's scalerank: lower is better known
 * @property {"p" | "l" | "x"} geom area, line or point
 * @property {Float64Array[]} parts longitude/latitude
 * @property {[number, number, number, number]} box [lon, lat, width, height]
 * @property {[number, number]} middle
 */

/** @returns {Promise<Feature[]>} */
export async function loadFeatures() {
  const json = await loadData("terrain.json");
  return json.features
    .split("\n")
    .map((line, i) => {
      const f = line.split("\t");
      const geom = /** @type {"p" | "l" | "x"} */ (f[8]);
      const scale = geom === "x" ? json.scale.point : json.scale.line;
      const parts = (f[9] ? f[9].split("|") : [])
        .map((p) => unpackRing(p, scale))
        .filter((p) => p.length >= 2);
      let x0 = 180;
      let y0 = 90;
      let x1 = -180;
      let y1 = -90;
      for (const p of parts) {
        for (let k = 0; k < p.length; k += 2) {
          x0 = Math.min(x0, p[k]);
          x1 = Math.max(x1, p[k]);
          y0 = Math.min(y0, p[k + 1]);
          y1 = Math.max(y1, p[k + 1]);
        }
      }
      return {
        i,
        kind: f[0],
        name: f[1],
        alts: f[2]
          ? f[2]
              .split(";")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        cont: f[3],
        countries: f[4] ? f[4].split(" · ") : [],
        qid: f[5],
        extra: f[6],
        rank: Number(f[7]) || 0,
        geom,
        parts,
        box: [x0, y0, x1 - x0, y1 - y0],
        middle: [(x0 + x1) / 2, (y0 + y1) / 2],
      };
    })
    .filter((f) => f.parts.length && KINDS[f.kind]);
}
