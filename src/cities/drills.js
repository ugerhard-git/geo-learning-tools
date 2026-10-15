/**
 * Cities and Regions drills: what each drill asks, which places it draws on, and
 * what counts as a right answer. Nothing here touches the page, so it can
 * be tested on its own (test/unit/city-drills.test.js).
 *
 * @module cities/drills
 */
import { esc, table } from "../shared/dom.js";
import { REGIONS } from "../shared/countries.js";
import { answerKey, judgeTyped } from "../shared/text.js";
import { distKm } from "../shared/geo.js";
import { nearbyDistractors } from "../shared/drill.js";
import { shuffle } from "../shared/random.js";
import { CITY_TYPE } from "./data.js";

/** @typedef {import("./data.js").City} City */
/** @typedef {import("./data.js").Region} Region */
/** @typedef {Awaited<ReturnType<import("./data.js").loadCityData>>} CityData */

/**
 * The drills. `prefix` starts every progress key the drill writes; the
 * prefixes are what saved progress is made of and must not change.
 */
export const DRILLS = table({
  locate: {
    label: "Locate",
    blurb: "Name given, click the map",
    kind: "city",
    prefix: "l",
    click: true,
  },
  name: { label: "Name the city", blurb: "Pin shown, name the city", kind: "city", prefix: "n" },
  capital: {
    label: "Capital of",
    blurb: "Country or region to capital",
    kind: "city",
    prefix: "c",
  },
  region: {
    label: "Name the region",
    blurb: "Region shown, name it",
    kind: "region",
    prefix: "r",
  },
  rlocate: {
    label: "Locate the region",
    blurb: "Name given, click the map",
    kind: "region",
    prefix: "rl",
    click: true,
  },
});

/**
 * The progress key of an item in a drill: "l:FR/Paris" for a city,
 * "rl:FR-IDF" for a region.
 * @param {string} type
 * @param {City | Region} item
 */
export const keyOf = (type, item) =>
  DRILLS[type].kind === "city"
    ? `${DRILLS[type].prefix}:${item.iso}/${item.name}`
    : `${DRILLS[type].prefix}:${item.code}`;

/**
 * Which cities a city drill draws on.
 * @param {CityData} data
 */
export const categories = (data) =>
  table({
    cap: { label: "National capitals", pick: (c) => c.t === CITY_TYPE.national },
    reg: {
      label: "Regional capitals",
      pick: (c) => Boolean(c.reg) && data.capitalOfRegion.get(c.reg) === c,
    },
    big: { label: "Cities over 1 million", pick: (c) => c.pop >= 1e6 },
    all: { label: "All cities in this set", pick: () => true },
  });

/**
 * The scopes on offer: the whole world, each continent, and each country
 * with enough places in it to make a drill.
 * @param {CityData} data
 * @param {"city" | "region"} kind
 * @returns {[string, string][]} [value, label]
 */
export function scopeOptions(data, kind) {
  const counts = new Map();
  for (const x of kind === "region" ? data.regions : data.cities) {
    counts.set(x.iso, (counts.get(x.iso) ?? 0) + 1);
  }
  const min = kind === "region" ? 4 : 5;
  const countries = [...counts]
    .filter(([code, n]) => n >= min && data.countryBy[code])
    .map(([code, n]) => [code, `${data.countryBy[code].name} (${n})`])
    .sort((a, b) => a[1].localeCompare(b[1], "en"));
  const continents = Object.entries(REGIONS).filter(([k]) => k !== "N");
  return [["W", "Whole world"], ...continents, ...countries];
}

/**
 * The items a drill draws on.
 * @param {CityData} data
 * @param {{ type: string, cat: string, scope: string }} settings
 * @returns {(City | Region)[]}
 */
export function poolFor(data, { type, cat, scope }) {
  const inScope = (iso) =>
    scope === "W" || (REGIONS[scope] ? data.countryBy[iso]?.region === scope : iso === scope);
  if (DRILLS[type].kind === "region") return data.regions.filter((r) => inScope(r.iso));
  const pick = categories(data)[cat].pick;
  let pool = data.cities.filter((c) => inScope(c.iso) && pick(c));
  // "Capital of" needs something to be capital of.
  if (type === "capital") {
    pool = pool.filter(
      (c) =>
        c.t === CITY_TYPE.national ||
        (c.reg && data.regionBy.has(c.reg) && data.capitalOfRegion.get(c.reg) === c),
    );
  }
  return pool;
}

/**
 * The longitude/latitude box around everything in a pool.
 * @param {(City | Region)[]} pool
 * @param {import("./data.js").RegionShapes} shapes
 */
export function poolBox(pool, shapes) {
  let x0 = 180;
  let y0 = 90;
  let x1 = -180;
  let y1 = -90;
  for (const it of pool) {
    if ("lon" in it) {
      x0 = Math.min(x0, it.lon);
      x1 = Math.max(x1, it.lon);
      y0 = Math.min(y0, it.lat);
      y1 = Math.max(y1, it.lat);
    } else {
      const [bx, by, bw, bh] = shapes.extent(it.code).box;
      x0 = Math.min(x0, bx);
      x1 = Math.max(x1, bx + bw);
      y0 = Math.min(y0, by);
      y1 = Math.max(y1, by + bh);
    }
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

/* ----------------------------------------------------------------------- */

/**
 * One question's rules. The "Capital of" drill asks in two directions,
 * chosen at random for each question: `dir` 0 asks for the capital, 1 asks
 * what a city is the capital of.
 */
export class CityQuestion {
  /**
   * @param {CityData} data
   * @param {import("./data.js").RegionShapes} shapes
   * @param {string} type
   * @param {City | Region} item
   * @param {0 | 1} dir
   */
  constructor(data, shapes, type, item, dir = 0) {
    this.data = data;
    this.shapes = shapes;
    this.type = type;
    this.item = item;
    this.dir = type === "capital" ? dir : 0;
  }

  get kind() {
    return DRILLS[this.type].kind;
  }

  countryName(iso) {
    return this.data.countryBy[iso]?.name ?? iso ?? "";
  }

  regionName(code) {
    return this.data.regionBy.get(code)?.name ?? "";
  }

  /**
   * The question. `hint` (where the place is) would give the answer away,
   * so the drill holds it back until it is asked for or the question is
   * answered.
   * @returns {{ main: string, sub: string, hint: string }} HTML
   */
  prompt() {
    const item = /** @type {any} */ (this.item);
    const country = esc(this.countryName(item.iso));
    switch (this.type) {
      case "locate": {
        const region = item.t === CITY_TYPE.regional ? this.regionName(item.reg) : "";
        return {
          main: `Where is ${esc(item.name)}?`,
          sub: "click the map",
          hint: `${country}${region ? ` · ${esc(region)}` : ""}`,
        };
      }
      case "rlocate":
        return { main: `Where is ${esc(item.name)}?`, sub: "click the map", hint: country };
      case "name":
        return { main: "Which city is marked?", sub: "", hint: country };
      case "region":
        return { main: "Which region is highlighted?", sub: "", hint: country };
      default: {
        const national = item.t === CITY_TYPE.national;
        const of = national ? this.countryName(item.iso) : this.regionName(item.reg);
        const hint = national ? "" : `in ${country}`;
        return this.dir === 0
          ? {
              main: `What is the capital of ${esc(of)}?`,
              sub: national ? "Country" : "Region",
              hint,
            }
          : {
              main: `${esc(item.name)} is the capital of what?`,
              sub: national ? "Name the country" : "Name the region",
              hint,
            };
      }
    }
  }

  /** Names that count for an item in its own right. */
  namesOf(o) {
    return this.kind === "city" ? [o.name, ...o.alts] : [o.name, o.alt].filter(Boolean);
  }

  /**
   * Every item that is a right answer. Asking for the capital of a place
   * with several capitals accepts any of them.
   * @returns {(City | Region)[]}
   */
  accepted() {
    const item = /** @type {any} */ (this.item);
    if (this.type !== "capital" || this.dir !== 0) return [item];
    const list =
      item.t === CITY_TYPE.national
        ? this.data.nationalCapitals.get(item.iso)
        : this.data.regionalCapitals.get(item.reg);
    return list?.length ? list : [item];
  }

  /** How an item is labelled as an answer option. */
  label(o) {
    if (this.type === "capital" && this.dir === 1) {
      return o.t === CITY_TYPE.national
        ? this.countryName(o.iso)
        : this.data.regionBy.get(o.reg)?.name || "?";
    }
    return o.name;
  }

  /** Labels of the right answers. */
  rightLabels() {
    return new Set(this.accepted().map((o) => this.label(o)));
  }

  /** Names a typed answer may match. */
  answerNames() {
    const item = /** @type {any} */ (this.item);
    if (this.type === "capital" && this.dir === 1) {
      if (item.t === CITY_TYPE.national) {
        const c = this.data.countryBy[item.iso];
        return [c?.name, ...(c?.aliases ?? [])].filter(Boolean);
      }
      const r = this.data.regionBy.get(item.reg);
      return [r?.name, r?.alt].filter(Boolean);
    }
    return this.accepted().flatMap((o) => this.namesOf(o));
  }

  /** The right answer as feedback states it (HTML). */
  answerText() {
    const labels = [...this.rightLabels()];
    if (this.type === "capital" && this.dir === 0 && labels.length > 1) {
      return esc(labels.join(", "));
    }
    return esc(this.answerNames()[0] ?? this.item.name);
  }

  /** Where an item is, for choosing nearby wrong options. */
  position(o) {
    return "lon" in o ? [o.lon, o.lat] : this.shapes.extent(o.code).middle;
  }

  /**
   * Four options: the item and three of its nearest neighbours in the pool.
   * @param {(City | Region)[]} pool
   * @returns {{ label: string, correct: boolean }[]}
   */
  options(pool) {
    const right = this.rightLabels();
    const [lon, lat] = this.position(this.item);
    const wrong = nearbyDistractors(
      pool.filter((o) => o !== this.item && !right.has(this.label(o))),
      (o) => distKm(lon, lat, ...this.position(o)),
      (o) => this.label(o),
      right,
      3,
    );
    return shuffle([this.item, ...wrong]).map((o) => ({
      label: this.label(o),
      correct: right.has(this.label(o)),
    }));
  }

  /**
   * Judge a typed answer. Naming another place in the pool exactly is wrong
   * and says which place that was.
   * @param {string} text
   * @param {(City | Region)[]} pool
   */
  judge(text, pool) {
    const right = this.rightLabels();
    const verdict = judgeTyped(text, this.answerNames(), (key) =>
      pool.find(
        (o) =>
          o !== this.item &&
          !right.has(this.label(o)) &&
          this.namesOf(o).some((n) => answerKey(n) === key),
      ),
    );
    if (verdict && !verdict.ok && verdict.other) {
      return { ok: false, otherLabel: this.label(verdict.other) };
    }
    return verdict;
  }
}
