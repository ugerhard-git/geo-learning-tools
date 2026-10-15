/**
 * Pieces every map page has: the land drawn under everything else, the
 * switch between the two projections, and the name tag that follows the
 * pointer.
 *
 * @module shared/map-ui
 */
import { PROJECTIONS, saveProjection } from "./projection.js";
import { ringsToPath } from "./codec.js";

/**
 * @typedef {object} LandShape
 * @property {string[]} codes the countries this outline belongs to
 * @property {ArrayLike<number>[]} rings longitude/latitude rings
 */

/**
 * Draw the ocean and the land into a group.
 *
 * Every outline is drawn twice: once as a plain backdrop and once on top,
 * where it can be highlighted. See map.css for why the backdrop is needed.
 *
 * @param {SVGGElement} group
 * @param {LandShape[]} shapes
 * @param {import("./projection.js").Projection} proj
 * @returns {Map<string, SVGPathElement[]>} each country's outlines on top, for highlighting
 */
export function drawLand(group, shapes, proj) {
  const paths = shapes.map((s) => ringsToPath(s.rings, proj));
  const outlines = paths.map((d) => `<path d="${d}"/>`).join("");
  group.classList.add("land");
  group.innerHTML = `<path class="ocean" d="${proj.ocean()}"/><g class="landbase">${outlines}</g><g class="landtop">${outlines}</g>`;

  const byCode = new Map();
  group.querySelectorAll(".landtop path").forEach((path, i) => {
    for (const code of shapes[i].codes) {
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(path);
    }
  });
  return byCode;
}

/**
 * The Equal Earth / Mercator switch in the corner of the map.
 *
 * @param {HTMLElement} root holds buttons with data-proj and a .pnote paragraph
 * @param {object} options
 * @param {() => string} options.current the projection key in use
 * @param {(key: "ee" | "merc") => void} options.onSwitch redraw the map in another projection
 * @param {Partial<Record<"ee" | "merc", string>>} [options.notes] the line under the
 *   switch, where this app's wording differs from the projection's own note
 * @returns {{ sync(): void }}
 */
export function projectionSwitch(root, { current, onSwitch, notes = {} }) {
  const sync = () => {
    root.querySelectorAll("[data-proj]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.proj === current()));
    });
    const note = root.querySelector(".pnote");
    if (note) note.textContent = notes[current()] ?? PROJECTIONS[current()].note;
  };
  root.addEventListener("click", (e) => {
    const key = e.target.closest("[data-proj]")?.dataset.proj;
    if (!PROJECTIONS[key] || key === current()) return;
    saveProjection(key);
    onSwitch(key);
    sync();
  });
  sync();
  return { sync };
}

/**
 * The name tag that follows the pointer over the map.
 */
export class Tooltip {
  /**
   * @param {HTMLElement} el the tag, absolutely positioned inside `stage`
   * @param {HTMLElement} stage
   */
  constructor(el, stage) {
    this.el = el;
    this.stage = stage;
  }

  show(text, clientX, clientY) {
    const r = this.stage.getBoundingClientRect();
    this.el.textContent = text;
    this.el.hidden = false;
    this.el.style.left = `${clientX - r.left}px`;
    this.el.style.top = `${clientY - r.top}px`;
  }

  hide() {
    this.el.hidden = true;
  }
}
