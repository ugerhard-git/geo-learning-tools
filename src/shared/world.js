/**
 * The detailed world outlines the two flag apps draw, from src/data/world.json.
 *
 *     { "f": [{ "r": "x,y,dx,dy,…|…", "c": ["FR", …] }, …],
 *       "i": { "FR": { "b": [west, south, east, north], "m": [lon, lat] }, … } }
 *
 * `f` lists outlines: rings in hundredths of a degree, delta-encoded (see
 * csvRings in shared/codec.js), and the codes of the countries each belongs
 * to. `i` gives each country's main landmass as a box, and a point near
 * its middle that a ring or a dot can mark.
 *
 * @module shared/world
 */
import { loadData } from "./net.js";
import { csvRings, ringsToPath } from "./codec.js";
import { projectBox } from "./projection.js";
import { ringAreaKm2 } from "./geo.js";

/**
 * @typedef {object} WorldShape
 * @property {string[]} codes
 * @property {Float64Array[]} rings
 */

/**
 * @typedef {object} PlaceInfo
 * @property {[number, number, number, number]} box [lon, lat, width, height] of the main landmass
 * @property {[number, number]} middle
 */

/** @returns {Promise<{ shapes: WorldShape[], info: Map<string, PlaceInfo> }>} */
export async function loadWorld() {
  const json = await loadData("world.json");
  const shapes = json.f.map((f) => ({ codes: f.c, rings: csvRings(f.r) }));
  const info = new Map(
    Object.entries(json.i).map(([code, { b, m }]) => [
      code,
      { box: [b[0], b[1], b[2] - b[0], b[3] - b[1]], middle: m },
    ]),
  );
  return { shapes, info };
}

/**
 * Draw the ocean and every outline into a group, one path per outline with
 * its index in `data-i`.
 *
 * @param {SVGGElement} group
 * @param {WorldShape[]} shapes
 * @param {import("./projection.js").Projection} proj
 * @param {(i: number) => boolean} [hasData] false greys an outline out as having nothing to show
 * @returns {Map<string, SVGPathElement[]>} each country's outlines
 */
export function drawWorld(group, shapes, proj, hasData = () => true) {
  group.innerHTML =
    `<path class="ocean" d="${proj.ocean()}"/>` +
    shapes
      .map(
        (s, i) =>
          `<path data-i="${i}"${hasData(i) ? "" : ' class="nodata"'} d="${ringsToPath(s.rings, proj, { minPoints: 1 })}"/>`,
      )
      .join("");
  const byCode = new Map();
  group.querySelectorAll("path[data-i]").forEach((path) => {
    for (const code of shapes[Number(path.dataset.i)].codes) {
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(path);
    }
  });
  return byCode;
}

/**
 * Fill each `<g data-world>` placeholder under `root` with a copy of a drawn
 * world group, for a small map beside the main one: a detail view's world
 * and outline maps.
 *
 * A copy rather than `<use href="#world">`: Safari styles what `<use>` shows
 * by adding a stylesheet of its own, which the Content-Security-Policy
 * refuses, so on iPads and iPhones those maps lost their colours. A copy is
 * ordinary markup that the site's own stylesheets reach. It shows the drawing
 * as it is now, highlighted country included, without the pointer's hover.
 * @param {ParentNode} root
 * @param {Element} group the drawn world
 */
export function fillWorldCopies(root, group) {
  for (const spot of root.querySelectorAll("g[data-world]")) {
    const copy = /** @type {Element} */ (group.cloneNode(true));
    copy.removeAttribute("id");
    copy.setAttribute("aria-hidden", "true");
    for (const p of copy.querySelectorAll(".hov")) p.classList.remove("hov");
    spot.replaceWith(copy);
  }
}

/**
 * A place's main landmass in map units: its box, and the point that marks it.
 * @param {import("./projection.js").Projection} proj
 * @param {PlaceInfo} place
 * @returns {{ box: [number, number, number, number], middle: [number, number] }}
 */
export const projectPlace = (proj, place) => ({
  box: projectBox(proj, place.box),
  middle: proj.fwd(place.middle[0], place.middle[1]),
});

/**
 * The largest single piece of land each country has, in square kilometres.
 * A bounding box will not do for this: the Maldives spread a wide box over
 * a scatter of atolls with nothing inside it to hit.
 *
 * @param {WorldShape[]} shapes
 * @returns {Map<string, number>}
 */
export function largestPieces(shapes) {
  const out = new Map();
  for (const { codes, rings } of shapes) {
    const biggest = Math.max(0, ...rings.map(ringAreaKm2));
    for (const c of codes) out.set(c, Math.max(out.get(c) ?? 0, biggest));
  }
  return out;
}
