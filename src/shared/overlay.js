/**
 * Markers drawn on top of the map: rings around a target, pins, the spot a
 * learner clicked, and the dashed line from there to the answer.
 *
 * Markers are placed by longitude/latitude, so they survive a projection
 * switch by simply being drawn again. Their size is given in screen pixels
 * and converted to map units after every move of the map ({@link MarkerLayer#fit}),
 * so a ring is the same size on screen at any zoom.
 *
 * @module shared/overlay
 */

/**
 * @typedef {object} Marker
 * @property {"ring" | "pin" | "guess" | "line"} kind
 * @property {number} lon
 * @property {number} lat
 * @property {number} [lon2] the line's other end
 * @property {number} [lat2]
 * @property {number} [size] radius in screen pixels (circles only)
 * @property {"ok"} [tone] colour the marker as a right answer
 */

/** Default on-screen radius for each kind of circle, in pixels. */
const RADIUS = { ring: 16, pin: 6, guess: 7 };

const SVG_NS = "http://www.w3.org/2000/svg";
const fix1 = (v) => v.toFixed(1);

export class MarkerLayer {
  /**
   * @param {SVGGElement} group the <g> to draw into, above everything else
   * @param {() => import("./projection.js").Projection} projection
   */
  constructor(group, projection) {
    this.group = group;
    this.projection = projection;
    /** @type {Marker[]} */
    this.items = [];
    this.unitsPerPixel = 1;
  }

  /** Replace every marker. */
  set(items) {
    this.items = items;
    this.draw();
  }

  /** Add markers to those already shown. */
  add(...items) {
    this.set([...this.items, ...items]);
  }

  clear() {
    this.set([]);
  }

  /** Redraw from the stored markers, e.g. after a projection switch. */
  draw() {
    const proj = this.projection();
    this.group.replaceChildren(
      ...this.items.map((m) => {
        const [x, y] = proj.fwd(m.lon, m.lat);
        if (m.kind === "line") {
          const [x2, y2] = proj.fwd(m.lon2, m.lat2);
          return svgEl("line", {
            class: "mk-line",
            x1: fix1(x),
            y1: fix1(y),
            x2: fix1(x2),
            y2: fix1(y2),
          });
        }
        const cls = `mk-${m.kind}${m.tone ? ` ${m.tone}` : ""}`;
        const el = svgEl("circle", { class: cls, cx: fix1(x), cy: fix1(y), r: 0 });
        el.dataset.px = String(m.size ?? RADIUS[m.kind]);
        return el;
      }),
    );
    this.fit(this.unitsPerPixel);
  }

  /**
   * Resize circles for the current zoom.
   * @param {number} unitsPerPixel map units per screen pixel
   */
  fit(unitsPerPixel) {
    this.unitsPerPixel = unitsPerPixel;
    for (const el of this.group.querySelectorAll("circle[data-px]")) {
      el.setAttribute("r", (Number(el.dataset.px) * unitsPerPixel).toFixed(2));
    }
  }
}

/**
 * Create an SVG element with attributes.
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 */
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
