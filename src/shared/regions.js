/**
 * First-level region outlines (states, provinces, counties), packed as in
 * src/data/cities.json and decoded on demand: the Cities and Regions app
 * draws all of them, the Scripts and Languages app those its maps shade.
 *
 * @module shared/regions
 */
import { unpackRing } from "./codec.js";

/**
 * Read a table of packed outlines, "code <TAB> ring|ring|…" per line.
 * @param {string} text
 * @returns {Map<string, string[]>} region code → packed rings
 */
export function parseRegionShapes(text) {
  return new Map(
    (text ? text.split("\n") : []).map((line) => {
      const [code, rings] = line.split("\t");
      return [code, rings ? rings.split("|") : []];
    }),
  );
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
