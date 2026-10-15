/**
 * Terrain Atlas drills, and the geometry that judges a click: what each
 * drill asks, which features it draws on, and what counts as right.
 * Nothing here touches the page (see test/unit/terrain-drills.test.js).
 *
 * @module terrain-atlas/drills
 */
import { esc, table } from "../shared/dom.js";
import { answerKey, judgeTyped } from "../shared/text.js";
import { distKm, ringsContain, segmentDistKm } from "../shared/geo.js";
import { nearbyDistractors } from "../shared/drill.js";
import { shuffle } from "../shared/random.js";
import { CONTINENTS, KINDS } from "./data.js";

/** @typedef {import("./data.js").Feature} Feature */

/** The drills. The first letter of each key starts its progress keys. */
export const DRILLS = table({
  locate: { label: "Locate", blurb: "Name given, click the map" },
  name: { label: "Name it", blurb: "Feature highlighted, name it" },
  clue: { label: "From the clue", blurb: "Named by the countries it touches" },
});

/**
 * How well known the features in a drill are. Natural Earth's scalerank
 * stands in for that; for peaks it follows height.
 */
export const LEVELS = table({
  2: { label: "Well known only" },
  4: { label: "Well known and common" },
  9: { label: "Everything" },
});

/**
 * The progress key of a feature in a drill, e.g. "l:riv/Danube". These keys
 * are what saved progress is made of and must not change.
 */
export const keyOf = (type, f) => `${type[0]}:${f.kind}/${f.name}`;

/**
 * Where a drill's features may be: "W" for the whole world, a continent's
 * key, or "ocean" for the seas that belong to no continent (stored with the
 * continent "W", which is why the scope cannot use that key for them).
 */
export const SCOPES = table({
  W: "Whole world",
  ...Object.fromEntries(Object.entries(CONTINENTS).filter(([k]) => k !== "W")),
  ocean: CONTINENTS.W,
});

/** Whether a feature lies in a scope. */
export const inScope = (f, scope) => scope === "W" || f.cont === (scope === "ocean" ? "W" : scope);

/**
 * The features a drill draws on.
 * @param {Feature[]} features
 * @param {{ type: string, kinds: Set<string>, level: string, scope: string }} settings
 */
export const poolFor = (features, { type, kinds, level, scope }) =>
  features.filter(
    (f) =>
      kinds.has(f.kind) &&
      f.rank <= Number(level) &&
      inScope(f, scope) &&
      // A clue naming one country rarely has a single answer, so this drill needs two or more.
      (type !== "clue" || f.countries.length >= 2),
  );

/** The longitude/latitude box around a set of features. */
export function poolBox(list) {
  let x0 = 180;
  let y0 = 90;
  let x1 = -180;
  let y1 = -90;
  for (const { box } of list) {
    x0 = Math.min(x0, box[0]);
    y0 = Math.min(y0, box[1]);
    x1 = Math.max(x1, box[0] + box[2]);
    y1 = Math.max(y1, box[1] + box[3]);
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

/**
 * Distance in kilometres from a point to a feature: to the nearest peak,
 * the nearest stretch of river, or the edge of an area (zero inside it).
 * @param {Feature} f
 */
export function featureDistance(f, lon, lat) {
  let best = Infinity;
  if (f.geom === "x") {
    for (const p of f.parts) best = Math.min(best, distKm(lon, lat, p[0], p[1]));
    return best;
  }
  for (const p of f.parts) {
    const n = p.length;
    if (f.geom === "p") {
      if (ringsContain([p], lon, lat)) return 0;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        best = Math.min(best, segmentDistKm(lon, lat, p[j], p[j + 1], p[i], p[i + 1]));
      }
    } else {
      for (let i = 0; i < n - 2; i += 2) {
        best = Math.min(best, segmentDistKm(lon, lat, p[i], p[i + 1], p[i + 2], p[i + 3]));
      }
    }
    if (best === 0) return 0;
  }
  return best;
}

/**
 * The feature nearest to a point, within `maxKm`. Features whose box is
 * nowhere near are skipped without measuring. When two are equally near
 * (both zero, say: a lake inside a sea), the smaller one wins, so it can
 * still be picked.
 *
 * @param {Feature[]} features
 * @param {number} lon
 * @param {number} lat
 * @param {number} maxKm
 * @returns {Feature | null}
 */
export function nearestFeature(features, lon, lat, maxKm) {
  const pad = Math.min(8, maxKm / 70);
  let best = null;
  let bestD = Infinity;
  let bestSize = Infinity;
  for (const f of features) {
    const [bx, by, bw, bh] = f.box;
    if (lon < bx - pad || lon > bx + bw + pad || lat < by - pad || lat > by + bh + pad) continue;
    const d = featureDistance(f, lon, lat);
    if (d > maxKm) continue;
    const size = Math.max(bw, bh);
    if (d < bestD - 0.001 || (Math.abs(d - bestD) <= 0.001 && size < bestSize)) {
      best = f;
      bestD = d;
      bestSize = size;
    }
  }
  return best;
}

/** The point of a feature nearest to a click, for drawing the line to it. */
export function nearestVertex(f, lon, lat) {
  let best = f.middle;
  let bestD = Infinity;
  for (const p of f.parts) {
    for (let i = 0; i < p.length; i += 2) {
      const d = distKm(lon, lat, p[i], p[i + 1]);
      if (d < bestD) {
        bestD = d;
        best = [p[i], p[i + 1]];
      }
    }
  }
  return best;
}

/* ----------------------------------------------------------------------- */

const namesOf = (f) => [f.name, ...f.alts];

/** One question's rules. */
export class TerrainQuestion {
  /**
   * @param {string} type
   * @param {Feature} item
   * @param {Feature[]} pool
   */
  constructor(type, item, pool) {
    this.type = type;
    this.item = item;
    this.pool = pool;
  }

  /** @returns {{ main: string, sub: string }} HTML */
  prompt() {
    const f = this.item;
    const kind = KINDS[f.kind].one;
    const continent = esc(CONTINENTS[f.cont] ?? "");
    if (this.type === "locate") {
      return {
        main: `Where is ${esc(f.name)}?`,
        sub: `${esc(kind)} · ${continent} · click the map`,
      };
    }
    if (this.type === "name") {
      return { main: `Which ${esc(kind.toLowerCase())} is highlighted?`, sub: continent };
    }
    const verb = f.kind === "riv" ? "flows through" : f.geom === "x" ? "stands in" : "touches";
    return {
      main: `Which ${esc(kind.toLowerCase())} ${verb} ${esc(f.countries.slice(0, 4).join(", "))}?`,
      sub: continent,
    };
  }

  /** Every feature that answers the question as asked: a clue may fit several. */
  accepted() {
    if (this.type !== "clue") return [this.item];
    const want = this.item.countries.slice(0, 4);
    return this.pool.filter(
      (o) => o.kind === this.item.kind && want.every((c) => o.countries.includes(c)),
    );
  }

  /**
   * Four options: the feature and three nearby ones of the same kind if
   * there are enough, otherwise of any kind in the pool.
   */
  options() {
    const item = this.item;
    const alsoRight = new Set(this.accepted().map((o) => o.name));
    const candidates = this.pool.filter(
      (o) => o !== item && o.name !== item.name && !alsoRight.has(o.name),
    );
    const sameKind = candidates.filter((o) => o.kind === item.kind);
    const wrong = nearbyDistractors(
      sameKind.length >= 3 ? sameKind : candidates,
      (o) => distKm(item.middle[0], item.middle[1], o.middle[0], o.middle[1]),
      (o) => o.name,
      new Set([item.name]),
      3,
    );
    return shuffle([item, ...wrong]).map((o) => ({ label: o.name, correct: o === item }));
  }

  /** Judge a typed answer; naming another feature in the pool says which. */
  judge(text) {
    const accepted = this.accepted();
    const verdict = judgeTyped(text, accepted.flatMap(namesOf), (key) =>
      this.pool.find((o) => !accepted.includes(o) && namesOf(o).some((n) => answerKey(n) === key)),
    );
    if (verdict && !verdict.ok && verdict.other) {
      return { ok: false, otherLabel: verdict.other.name };
    }
    return verdict;
  }

  /** After a right typed answer to a clue: how many others would have counted too. */
  rightNote() {
    const others = this.accepted().length - 1;
    return others > 0 ? ` ${others} other${others > 1 ? "s" : ""} would also have counted.` : "";
  }
}
