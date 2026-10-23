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
import { shuffle } from "../shared/random.js";
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
 * The items a drill asks about, for the clues picked.
 * @param {RoadData} data
 * @param {string} type a key of {@link DRILLS}
 * @param {string[]} clues
 * @returns {RoadItem[]}
 */
export function poolFor(data, type, clues) {
  if (type === "scene") {
    return data.countries
      .filter((c) => sceneClues(c, clues).filter((x) => x !== "side").length >= 1)
      .filter((c) => sceneClues(c, clues).length >= 2)
      .map((c) => ({ clue: "scene", code: c.code }));
  }
  return clues.flatMap((clue) =>
    data.countries.filter((c) => hasClue(c, clue)).map((c) => ({ clue, code: c.code })),
  );
}

/**
 * What a clue looks like in a country, to tell countries apart by it: the
 * side, the line colour, or the drawing's file on Commons.
 */
function valueOf(country, clue) {
  if (clue === "side") return country.drive;
  if (clue === "lines") return country.centre?.colour ?? "";
  return country.signs[clue]?.commons ?? "";
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

/** One question. */
export class RoadQuestion {
  /**
   * @param {RoadItem} item
   * @param {RoadData} data
   * @param {{ hard?: boolean, clues?: string[] }} [options] on hard, wrong
   *   options come from the same part of the world; a scene shows the clues
   *   picked
   */
  constructor(item, data, { hard = false, clues = Object.keys(CLUES) } = {}) {
    this.item = item;
    this.data = data;
    this.hard = hard;
    this.country = data.byCode[item.code];
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
    const mine = this.shows.map((s) => valueOf(this.country, s));
    // A wrong option must differ from the right one in something shown, and
    // have a value for every clue shown, or the question could not be
    // answered.
    const others = this.data.countries.filter(
      (c) =>
        c.code !== this.country.code &&
        this.shows.every((s) => hasClue(c, s)) &&
        this.shows.some((s, i) => valueOf(c, s) !== mine[i]),
    );
    // A sign is shared by countries that use the same drawing; offer at most
    // one country per drawing, so no two options look the same.
    const seen = new Set([mine.join("|")]);
    const distinct = [];
    for (const c of shuffle(others)) {
      const v = this.shows.map((s) => valueOf(c, s)).join("|");
      if (!seen.has(v)) {
        seen.add(v);
        distinct.push(c);
      }
    }
    const region = this.country.region;
    const wrong = pickPreferring(distinct, (c) => (c.region === region) === this.hard, 3);
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
    const parts = [`${c.name}: drives ${sideText(c.drive).toLowerCase()}`];
    if (c.centre) parts.push(`${COLOURS[c.centre.colour].toLowerCase()} centre lines`);
    return `${parts.join(", ")}.${c.centre ? ` ${c.centre.note}` : ""}`;
  }
}
