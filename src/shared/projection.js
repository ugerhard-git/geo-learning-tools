/**
 * The two map projections the viewer can switch between.
 *
 * Both map longitude/latitude onto the same plane, 20000 units wide, with
 * longitude 0 at x = 10000 and y growing southwards (as SVG coordinates do).
 * Map data is stored as longitude/latitude and projected in the browser, so
 * switching projection is a redraw, not a reload.
 *
 * @module shared/projection
 */
import { table } from "./dom.js";
import { storage } from "./storage.js";

/** Width of the projected world, in map units. */
export const WORLD_W = 20000;

const RAD = Math.PI / 180;

/* Equal Earth: Šavrič, Patterson and Jenny (2018). An equal-area projection,
   so every country is shown at its true size relative to the others. */
const EE = { A1: 1.340264, A2: -0.081106, A3: 0.000893, A4: 0.003796, M: Math.sqrt(3) / 2 };
/** Scale that makes the projected world WORLD_W wide. */
const EE_S = WORLD_W / (2 * ((2 * Math.sqrt(3) * Math.PI) / (3 * EE.A1)));
/** Projected half-height: puts the North Pole at y = 0 and the South Pole at 2 * EE_H. */
const EE_H = 4867.17;

/* Mercator, cut off at 85° where it heads towards infinity. */
const MERC_S = WORLD_W / (2 * Math.PI);
const MERC_MAX = 85;
const MERC_H = Math.log(Math.tan(Math.PI / 4 + (MERC_MAX * Math.PI) / 360)) * MERC_S;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @typedef {object} Projection
 * @property {string} name shown on the switch
 * @property {string} note one line on what the projection is good and bad at
 * @property {(lon: number, lat: number) => [number, number]} fwd longitude/latitude to map units
 * @property {(x: number, y: number) => [number, number]} inv map units to longitude/latitude
 * @property {() => string} ocean SVG path filling the world's outline
 * @property {[number, number, number, number]} extent the whole projected world, [x, y, w, h]
 * @property {[number, number, number, number]} home what the "whole world" button frames
 */

/** @type {Record<"ee" | "merc", Projection>} */
export const PROJECTIONS = table({
  ee: {
    name: "Equal Earth",
    note: "Equal Earth: countries at their true relative size; shapes near the poles are compressed.",
    fwd(lon, lat) {
      const l = lon * RAD;
      const t = Math.asin(EE.M * Math.sin(lat * RAD));
      const t2 = t * t;
      const t6 = t2 * t2 * t2;
      const x =
        (2 * Math.sqrt(3) * l * Math.cos(t)) /
        (3 * (9 * EE.A4 * t6 * t2 + 7 * EE.A3 * t6 + 3 * EE.A2 * t2 + EE.A1));
      const y = t * (EE.A1 + EE.A2 * t2 + t6 * (EE.A3 + EE.A4 * t2));
      return [WORLD_W / 2 + x * EE_S, EE_H - y * EE_S];
    },
    // Newton's method on the latitude parameter, as d3-geo does it.
    inv(X, Y) {
      const x = (X - WORLD_W / 2) / EE_S;
      const y = (EE_H - Y) / EE_S;
      let l = y;
      let l2 = l * l;
      let l6 = l2 * l2 * l2;
      for (let i = 0; i < 12; i++) {
        const fy = l * (EE.A1 + EE.A2 * l2 + l6 * (EE.A3 + EE.A4 * l2)) - y;
        const fpy = EE.A1 + 3 * EE.A2 * l2 + l6 * (7 * EE.A3 + 9 * EE.A4 * l2);
        const dl = fy / fpy;
        l -= dl;
        l2 = l * l;
        l6 = l2 * l2 * l2;
        if (Math.abs(dl) < 1e-12) break;
      }
      const lon =
        (EE.M * x * (EE.A1 + 3 * EE.A2 * l2 + l6 * (7 * EE.A3 + 9 * EE.A4 * l2))) /
        Math.cos(l) /
        RAD;
      const lat = Math.asin(clamp(Math.sin(l) / EE.M, -1, 1)) / RAD;
      return [clamp(lon, -180, 180), lat];
    },
    ocean() {
      // The outline is curved, so trace the antimeridian down one side and up the other.
      const pts = [];
      for (let lat = 90; lat >= -90; lat--) pts.push(this.fwd(-180, lat));
      for (let lat = -90; lat <= 90; lat++) pts.push(this.fwd(180, lat));
      return `M${pts.map((p) => p.map(Math.round).join(" ")).join("L")}Z`;
    },
    extent: [0, 0, WORLD_W, 2 * EE_H],
    home: [0, 0, WORLD_W, 2 * EE_H],
  },

  merc: {
    name: "Mercator",
    note: "Mercator: true local shapes; areas grow toward the poles, so Greenland looks as big as Africa.",
    fwd(lon, lat) {
      const p = clamp(lat, -MERC_MAX, MERC_MAX) * RAD;
      return [
        WORLD_W / 2 + lon * RAD * MERC_S,
        MERC_H - Math.log(Math.tan(Math.PI / 4 + p / 2)) * MERC_S,
      ];
    },
    inv(X, Y) {
      const lon = (X - WORLD_W / 2) / MERC_S / RAD;
      const lat = (2 * Math.atan(Math.exp((MERC_H - Y) / MERC_S)) - Math.PI / 2) / RAD;
      return [clamp(lon, -180, 180), lat];
    },
    ocean() {
      return `M0 0H${WORLD_W}V${Math.round(2 * MERC_H)}H0Z`;
    },
    get extent() {
      return [0, 0, WORLD_W, 2 * MERC_H];
    },
    // Antarctica fills the bottom of a Mercator map with very little, so the
    // home view stops a little short of it.
    get home() {
      const top = this.fwd(0, 84)[1];
      const bottom = this.fwd(0, -62)[1];
      return [0, top, WORLD_W, bottom - top];
    },
  },
});

/**
 * A view of the whole world reaching at least a few degrees below `minLat`,
 * for small static maps that must show a southern country in full.
 * @param {Projection} proj
 * @param {number} minLat southernmost latitude that has to be in view
 * @returns {[number, number, number, number]}
 */
export function worldFrame(proj, minLat) {
  if (proj === PROJECTIONS.ee) return proj.extent;
  const top = proj.fwd(0, 84)[1];
  const bottom = proj.fwd(0, clamp(minLat - 4, -MERC_MAX, -62))[1];
  return [0, top, WORLD_W, bottom - top];
}

/**
 * The bounding box, in map units, of a longitude/latitude box. Projected
 * edges can bow outwards, so the box is sampled on a 7 × 7 grid rather than
 * at its corners alone.
 * @param {Projection} proj
 * @param {[number, number, number, number]} box [lon, lat, width, height] in degrees
 * @returns {[number, number, number, number]} [x, y, w, h]
 */
export function projectBox(proj, [lon, lat, w, h]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const [x, y] = proj.fwd(lon + (w * i) / 6, lat + (h * j) / 6);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

/* Which projection the viewer picked. One setting for every map app; the
   key's name predates the others and is kept so nobody's choice is lost. */
const STORE_KEY = "flagatlas.projection";

/** @returns {"ee" | "merc"} */
export const savedProjection = () => (storage.get(STORE_KEY) === "merc" ? "merc" : "ee");

/** @param {"ee" | "merc"} key */
export const saveProjection = (key) => storage.set(STORE_KEY, key);
