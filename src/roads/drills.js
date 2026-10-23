/**
 * Roads drills: which items each drill asks about, what it shows, its wrong
 * options and what counts as right. Nothing here touches the page, so it can
 * be tested on its own (test/unit/roads.test.js).
 *
 * Two drills, both limited to the clues the learner picked:
 *
 * - Clue by clue. For the driving side and the centre lines it names a
 *   country and asks for the clue; for a sign it shows the drawing and asks
 *   whose it is.
 * - Which country? A road scene with several of a country's clues at once:
 *   the side it drives on, the colour of its centre line, its signs.
 *
 * Every question is multiple choice. On "hard", the wrong options are
 * countries from the same part of the world.
 *
 * @module roads/drills
 */
import { esc, table } from "../shared/dom.js";
import { pickOne, shuffle } from "../shared/random.js";
import { CLUES, COLOURS, SIGN_CLUES, hasClue } from "./data.js";

/** @typedef {import("./data.js").RoadCountry} RoadCountry */
/** @typedef {import("./data.js").RoadData} RoadData */

/** The drills, in the order the setup offers them. */
export const DRILLS = table({
  clue: {
    label: "Clue by clue",
    blurb: "Name a country's driving side or line colour, or whose sign this is.",
  },
  scene: { label: "Which country?", blurb: "A road with several clues at once; name the country." },
});

/** The letter that starts each clue's progress keys, and the scene drill's. */
const PREFIX = table({
  side: "d",
  lines: "l",
  stop: "s",
  yield: "y",
  crossing: "z",
  pedestrian: "p",
  chevron: "c",
  warning: "w",
  scene: "x",
});

/**
 * An item: a country, and the clue asked about ("scene" for the scene drill).
 * @typedef {{ clue: string, code: string }} RoadItem
 */

/**
 * An item's progress key: the clue's prefix (see {@link PREFIX}), then the
 * country code, e.g. "s:JP" for Japan's stop sign.
 * @param {RoadItem} item
 */
export const keyOf = (item) => `${PREFIX[item.clue]}:${item.code}`;

/**
 * The item a progress key stands for, or null.
 * @param {string} key
 * @returns {RoadItem | null}
 */
export function itemOfKey(key) {
  const [prefix, code] = key.split(":");
  const clue = Object.keys(PREFIX).find((k) => PREFIX[k] === prefix);
  return clue && code ? { clue, code } : null;
}

/** The clues of a list that exist, in the app's order; every clue if none do. */
export function cleanClues(list) {
  const known = Object.keys(CLUES).filter((c) => list.includes(c));
  return known.length ? known : Object.keys(CLUES);
}

/**
 * The clues a scene of this country can show, of those picked. The driving
 * side alone is not enough to tell a country, so a scene needs one more.
 * @param {RoadCountry} country
 * @param {string[]} clues
 */
export const sceneClues = (country, clues) => clues.filter((c) => hasClue(country, c));

/**
 * Whether a country is in the part of the world picked: "all", a region
 * letter from the country table ("E" Europe), or a UN sub-region code
 * ("039" Southern Europe).
 * @param {RoadCountry} country
 * @param {string} where
 */
export const isIn = (country, where) =>
  where === "all" || country.region === where || country.subregion === where;

/**
 * The items a drill asks about, for the clues picked.
 * @param {RoadData} data
 * @param {string} type a key of {@link DRILLS}
 * @param {string[]} clues
 * @param {string} [where] see {@link isIn}
 * @returns {RoadItem[]}
 */
export function poolFor(data, type, clues, where = "all") {
  const countries = data.countries.filter((c) => isIn(c, where));
  if (type === "scene") {
    return countries
      .filter((c) => sceneClues(c, clues).filter((x) => x !== "side").length >= 1)
      .filter((c) => sceneClues(c, clues).length >= 2)
      .map((c) => ({ clue: "scene", code: c.code }));
  }
  return clues.flatMap((clue) =>
    countries.filter((c) => hasClue(c, clue)).map((c) => ({ clue, code: c.code })),
  );
}

/**
 * Two drawn chevron boards that could not be told apart: the same colours,
 * and the same number of arrows or a number not given for either.
 */
const sameChevron = (a, b) =>
  a.bg === b.bg &&
  a.fg === b.fg &&
  (a.arrows === undefined || b.arrows === undefined || a.arrows === b.arrows);

/**
 * Whether two countries look the same in a clue, so that one cannot be told
 * from the other by it: the same side, line colour or drawing. Chevrons
 * described in words look the same when any of their styles do (Italy's and
 * Greece's white on black, for instance).
 */
export function looksAlike(a, b, clue) {
  if (clue === "side") return a.drive === b.drive;
  if (clue === "lines") return (a.centre?.colour ?? "") === (b.centre?.colour ?? "");
  if (clue === "chevron" && a.chevron && b.chevron) {
    return a.chevron.styles.some((x) => b.chevron.styles.some((y) => sameChevron(x, y)));
  }
  const fa = a.signs[clue]?.commons;
  return Boolean(fa) && fa === b.signs[clue]?.commons;
}

/**
 * Up to `n` items from `candidates`, the preferred ones first, then the rest,
 * each group shuffled.
 * @template T
 * @param {T[]} candidates
 * @param {(item: T) => boolean} preferred
 * @param {number} n
 */
function pickPreferring(candidates, preferred, n) {
  const first = shuffle(candidates.filter(preferred));
  const rest = shuffle(candidates.filter((c) => !preferred(c)));
  return [...first, ...rest].slice(0, n);
}

/** "On the left" or "On the right". */
export const sideText = (drive) => (drive === "left" ? "On the left" : "On the right");

/**
 * A centre line pattern in words: "solid yellow, broken white". A line whose
 * style the source does not give is named by its colour alone.
 */
export function linesText(lines) {
  const words = lines.map((l) =>
    l
      .replace(/^dashed-/, "broken ")
      .replace(/^long-dash-/, "long-dashed ")
      .replace(/^short-dash-/, "short-dashed ")
      .replace(/^solid-/, "solid ")
      .replace(/^line-/, ""),
  );
  // Two or three of the same line: "double yellow", "triple broken white".
  if (words.length > 1 && words.every((w) => w === words[0])) {
    return `${words.length === 2 ? "double" : "triple"} ${words[0]}`;
  }
  return words.join(", ");
}

/** One question. */
export class RoadQuestion {
  /**
   * @param {RoadItem} item
   * @param {RoadData} data
   * @param {{ hard?: boolean, clues?: string[], where?: string }} [options] on
   *   hard, wrong options come from the same part of the world; a scene shows
   *   the clues picked; wrong options come from the part of the world picked
   *   while there are enough
   */
  constructor(item, data, { hard = false, clues = Object.keys(CLUES), where = "all" } = {}) {
    this.item = item;
    this.data = data;
    this.hard = hard;
    this.where = where;
    this.country = data.byCode[item.code];
    // A chevron with no drawing on Commons is drawn from its description;
    // where there are several, one of them, as a learner might meet it.
    const styles = this.country.chevron?.styles ?? [];
    /** @type {import("./data.js").ChevronStyle | null} */
    this.chevronStyle = !this.country.signs.chevron && styles.length ? pickOne(styles) : null;
    /** The clues the question shows: a scene's, or a sign. */
    this.shows =
      item.clue === "scene"
        ? sceneClues(this.country, clues)
        : SIGN_CLUES.includes(item.clue)
          ? [item.clue]
          : [];
  }

  /** The question's text for the drill bar (HTML). */
  prompt() {
    const name = esc(this.country.name);
    switch (this.item.clue) {
      case "side":
        return { main: `Which side of the road do they drive on in ${name}?`, sub: "" };
      case "lines":
        return {
          main: `What colour is the centre line in ${name}?`,
          sub: "the line between the two directions",
        };
      case "scene":
        return { main: "Which country is this road in?", sub: "" };
      default:
        return {
          main: `Whose ${esc(CLUES[this.item.clue].short)} sign is this?`,
          sub: this.hard ? "the options are neighbours" : "",
        };
    }
  }

  /**
   * The options, one right, in random order: Left and Right, the three line
   * colours, or four countries that can be told apart by what is shown.
   */
  options() {
    const { clue } = this.item;
    if (clue === "side") {
      return ["left", "right"].map((d) => ({
        label: sideText(d),
        correct: d === this.country.drive,
      }));
    }
    if (clue === "lines") {
      return Object.keys(COLOURS).map((k) => ({
        label: COLOURS[k],
        correct: k === this.country.centre.colour,
      }));
    }
    // A wrong option must have every clue shown, and must look different
    // from the right answer, and from every other option, in at least one of
    // them, or the question could not be answered.
    const differs = (a, b) => this.shows.some((s) => !looksAlike(a, b, s));
    const me = this.country;
    let candidates = this.data.countries.filter(
      (c) => c.code !== me.code && this.shows.every((s) => hasClue(c, s)) && differs(c, me),
    );
    // Stay within the part of the world picked while there are enough.
    const inside = candidates.filter((c) => isIn(c, this.where));
    if (inside.length >= 3) candidates = inside;
    const distinct = [];
    for (const c of shuffle(candidates)) {
      if (distinct.every((d) => differs(c, d))) distinct.push(c);
    }
    // Hard: neighbours, from the same sub-region where known.
    const near = (c) => (me.subregion ? c.subregion === me.subregion : c.region === me.region);
    const wrong = pickPreferring(distinct, (c) => near(c) === this.hard, 3);
    return shuffle([
      { label: this.country.name, correct: true },
      ...wrong.map((c) => ({ label: c.name, correct: false })),
    ]);
  }

  /** The right answer as feedback states it (HTML). */
  answerText() {
    const { clue } = this.item;
    if (clue === "side") return sideText(this.country.drive).toLowerCase();
    if (clue === "lines") return esc(COLOURS[this.country.centre.colour].toLowerCase());
    return esc(this.country.name);
  }

  /** A line under the scene once answered (plain text). */
  reveal() {
    const c = this.country;
    // A chevron question says what tells the country's chevrons apart.
    if (this.item.clue === "chevron" && c.chevron) return `${c.name}. ${c.chevron.note}`;
    const parts = [`${c.name}: drives ${sideText(c.drive).toLowerCase()}`];
    if (c.centre) {
      const usual = c.centre.patterns?.[0];
      parts.push(
        usual
          ? `centre line usually ${linesText(usual.lines)}`
          : `${COLOURS[c.centre.colour].toLowerCase()} centre lines`,
      );
    }
    return `${parts.join(", ")}.${c.centre ? ` ${c.centre.note}` : ""}`;
  }
}
