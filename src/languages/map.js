/**
 * Scripts and Languages maps: where a language is used, as a small map in
 * its details and as the answer of the map drill.
 *
 * A language is used in two kinds of area (see mapAreas in drills.js): the
 * countries where it is official throughout, drawn from the country
 * outlines (src/data/land.json), and the first-level regions of the
 * countries where it is a regional language, drawn from the region outlines
 * carried in src/data/languages.json. A country where it is regional is
 * drawn lighter, so the regions stand out within it.
 *
 * @module languages/map
 */
import { esc } from "../shared/dom.js";
import { ringsToPath } from "../shared/codec.js";
import { projectBox } from "../shared/projection.js";
import { mapAreas } from "./drills.js";

/** @typedef {import("../shared/projection.js").Projection} Projection */
/** @typedef {{ kind: "country" | "region", code: string }} Area */

/** Areas smaller than this share of the view get a dot, so they can be seen at all. */
const DOT_BELOW = 0.012;

export class LanguageAreas {
  /**
   * @param {{ shapes: import("../shared/map-ui.js").LandShape[], boxes: Map<string, { box: number[] }> }} land
   * @param {import("../shared/regions.js").RegionShapes} regionShapes
   */
  constructor(land, regionShapes) {
    this.land = land;
    this.regionShapes = regionShapes;
    /** @type {Map<string, ArrayLike<number>[]>} */
    this.countryRingCache = new Map();
    /** projection key → the land drawn in it */
    this.landCache = new Map();
  }

  /**
   * Every area where a language is used.
   * @param {import("./data.js").Language} lang
   * @returns {Area[]}
   */
  areasOf(lang) {
    const { countries, regions } = mapAreas(lang);
    return [
      ...countries.map((code) => ({ kind: /** @type {const} */ ("country"), code })),
      ...regions.map((code) => ({ kind: /** @type {const} */ ("region"), code })),
    ];
  }

  /** A country's outlines, as longitude/latitude rings. */
  countryRings(code) {
    let rings = this.countryRingCache.get(code);
    if (!rings) {
      rings = this.land.shapes.filter((s) => s.codes.includes(code)).flatMap((s) => s.rings);
      this.countryRingCache.set(code, rings);
    }
    return rings;
  }

  /** @param {Area} area */
  ringsOf(area) {
    return area.kind === "country"
      ? this.countryRings(area.code)
      : this.regionShapes.ringsOf(area.code);
  }

  /**
   * An area's bounding box in degrees, [lon, lat, width, height].
   * @param {Area} area
   */
  boxOf(area) {
    if (area.kind === "region") return this.regionShapes.extent(area.code).box;
    return this.land.boxes.get(area.code)?.box ?? null;
  }

  /**
   * The box around all the areas, in degrees; null when they spread over
   * so much of the world that the whole map is the better view.
   * @param {Area[]} areas
   */
  boxAround(areas) {
    const boxes = areas.map((a) => this.boxOf(a)).filter(Boolean);
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map((b) => b[0]));
    const y0 = Math.min(...boxes.map((b) => b[1]));
    const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
    const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
    if (x1 - x0 > 150 || y1 - y0 > 90) return null;
    return [x0, y0, x1 - x0, y1 - y0];
  }

  /**
   * The land, drawn once per projection: the ocean, a backdrop that hides
   * slivers between neighbours, and every outline.
   * @param {Projection} proj
   * @param {string} key the projection's key
   */
  landMarkup(proj, key) {
    let hit = this.landCache.get(key);
    if (!hit) {
      const d = this.land.shapes.map((s) => ringsToPath(s.rings, proj)).join("");
      hit = `<path class="ocean" d="${proj.ocean()}"/><g class="landbase"><path d="${d}"/></g><g class="landtop"><path d="${d}"/></g>`;
      this.landCache.set(key, hit);
    }
    return hit;
  }

  /**
   * The areas where a language is used, as SVG paths over the land: its
   * countries, its regions, and the countries those regions lie in, drawn
   * lighter. Areas too small to see in a view `span` map units wide, with no
   * other area beside them, also get a dot.
   * @param {import("./data.js").Language} lang
   * @param {Projection} proj
   * @param {number} span the width of the view, in map units
   * @param {string} [cls] the class of the shaded areas
   */
  shadeMarkup(lang, proj, span, cls = "on") {
    const areas = this.areasOf(lang);
    const part = (lang.regional ?? [])
      .map((c) => `<path class="part" d="${ringsToPath(this.countryRings(c), proj)}"/>`)
      .join("");
    const shaded = areas
      .map((a) => `<path class="${cls}" d="${ringsToPath(this.ringsOf(a), proj)}"/>`)
      .join("");
    const boxes = areas.map((a) => this.boxOf(a));
    // A neighbour's box near a small area's: the two read as one shape, no dot needed.
    const near = (i) => {
      const [x, y, w, h] = boxes[i];
      return boxes.some(
        (b, j) =>
          j !== i &&
          b &&
          b[0] <= x + w * 2 &&
          b[0] + b[2] >= x - w &&
          b[1] <= y + h * 2 &&
          b[1] + b[3] >= y - h,
      );
    };
    const dots = boxes
      .map((box, i) => {
        if (!box || near(i)) return "";
        const [x, y, w, h] = projectBox(proj, box);
        if (Math.max(w, h) > span * DOT_BELOW) return "";
        const r = (span * 0.006).toFixed(1);
        return `<circle class="${cls} dot" cx="${(x + w / 2).toFixed(1)}" cy="${(y + h / 2).toFixed(1)}" r="${r}"/>`;
      })
      .join("");
    return `<g class="shade">${part}${shaded}${dots}</g>`;
  }

  /**
   * A small map of where a language is used, framed on its areas.
   * @param {import("./data.js").Language} lang
   * @param {Projection} proj
   * @param {string} key the projection's key
   * @returns {string} an SVG element
   */
  smallMap(lang, proj, key) {
    const box = this.boxAround(this.areasOf(lang));
    let [x, y, w, h] = box ? projectBox(proj, box) : proj.home;
    if (box) {
      // Room around the areas, a sensible least size, and a 2:1 frame.
      const pad = Math.max(w, h) * 0.25 + 150;
      x -= pad;
      y -= pad;
      w += pad * 2;
      h += pad * 2;
    }
    const want = w / 2;
    if (h < want) {
      y -= (want - h) / 2;
      h = want;
    } else {
      x -= (h * 2 - w) / 2;
      w = h * 2;
    }
    const view = [x, y, w, h].map((v) => v.toFixed(0)).join(" ");
    return `<svg class="lmap land" viewBox="${view}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Map of where ${esc(lang.name)} is used">${this.landMarkup(proj, key)}${this.shadeMarkup(lang, proj, w)}</svg>`;
  }
}
