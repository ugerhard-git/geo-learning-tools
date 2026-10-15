/**
 * Country outlines for the Cities and Regions and the Terrain apps, from src/data/land.json.
 *
 * The file holds two tab-separated tables as strings:
 *
 * - `shapes`: one line per outline, `codes <TAB> ring|ring|…`, where codes
 *   is a comma-separated list of the countries sharing the outline and each
 *   ring is packed (see shared/codec.js) at `scale.shape` units per degree.
 * - `boxes`: one line per country, `code <TAB> packed`, six numbers at
 *   `scale.box` units per degree: west, south, east, north, and the
 *   longitude/latitude of a point near the middle of its largest piece.
 *
 * The flag apps use src/data/world.json instead, which has more detail.
 *
 * @module shared/land
 */
import { loadData } from "./net.js";
import { unpack, unpackRing } from "./codec.js";

/**
 * @typedef {object} CountryBox
 * @property {[number, number, number, number]} box [lon, lat, width, height] in degrees
 * @property {[number, number]} middle
 */

/**
 * @returns {Promise<{
 *   shapes: import("./map-ui.js").LandShape[],
 *   boxes: Map<string, CountryBox>,
 * }>}
 */
export async function loadLand() {
  const data = await loadData("land.json");
  const shapes = data.shapes.split("\n").map((line) => {
    const [codes, rings] = line.split("\t");
    return {
      codes: codes ? codes.split(",") : [],
      rings: rings ? rings.split("|").map((r) => unpackRing(r, data.scale.shape)) : [],
    };
  });
  const boxes = new Map();
  for (const line of data.boxes.split("\n")) {
    const [code, packed] = line.split("\t");
    const v = unpack(packed).map((n) => n / data.scale.box);
    boxes.set(code, { box: [v[0], v[1], v[2] - v[0], v[3] - v[1]], middle: [v[4], v[5]] });
  }
  return { shapes, boxes };
}
