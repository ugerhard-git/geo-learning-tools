/**
 * What Flags knows about the design of each flag: its colours, layout
 * and symbols (src/data/flag-tags.txt), and which flags are easily mistaken
 * for one another.
 *
 * flag-tags.txt has one line per flag:
 *
 *     code  colours  layout  symbols
 *
 * Colours and symbols are strings of one-letter keys (see {@link COLOURS}
 * and {@link SYMBOLS}), colours in order of how much of the flag they
 * cover; "-" means no symbols. The layout is a key of {@link LAYOUTS}.
 *
 * @module flags/design
 */
import { table } from "../shared/dom.js";

/** Colour keys: name, and the swatch shown beside it (see app.css). */
export const COLOURS = table({
  r: "Red",
  b: "Blue",
  g: "Green",
  w: "White",
  y: "Yellow or gold",
  k: "Black",
  l: "Light blue",
  o: "Orange",
  m: "Maroon",
});

export const LAYOUTS = table({
  h: ["Horizontal stripes", "Bands running across the flag."],
  v: ["Vertical stripes", "Bands running from top to bottom."],
  x: ["Cross or saltire", "An upright or diagonal cross, including Nordic crosses."],
  c: ["Canton", "A distinct panel in the upper hoist corner, including British ensigns."],
  t: ["Hoist triangle or chevron", "A triangle or chevron pointing in from the flagpole side."],
  d: ["Diagonal division", "A diagonal band or split."],
  e: ["Single field with an emblem", "One background colour carrying a symbol."],
  q: ["Other layouts", "Unusual constructions that fit no single pattern."],
});

export const SYMBOLS = table({
  s: "Stars",
  m: "Crescents",
  u: "Suns",
  a: "Animals",
  e: "Coats of arms and emblems",
  j: "Union Jack",
  w: "Weapons and tools",
  p: "Plants",
  b: "Buildings",
  x: "Writing",
  g: "Maps",
});

/** Groups of flags that are easily confused, with what they share. */
export const ALIKE = [
  ["Blue, yellow, red vertical stripes", "TD RO AD MD"],
  ["Red over white", "ID MC PL"],
  ["Green, white, orange or red verticals", "IE CI IT"],
  ["Niger's orange, white, green versus India's", "NE IN"],
  ["Red, white, blue horizontals", "NL LU PY HR"],
  ["Slavic white, blue, red tricolours", "RU SK SI RS"],
  ["Southern Cross on a blue ensign", "AU NZ CK"],
  ["Light-blue ensigns", "TV FJ"],
  ["British blue ensigns with a badge", "VG KY MS AI FK TC PN SH"],
  ["Green, yellow, red verticals", "SN ML GN CM"],
  ["Red, yellow, green horizontals", "BO GH LT ET"],
  ["Black, red, green with white fimbriation", "KE SS MW"],
  ["Nordic crosses", "DK NO SE FI IS FO AX"],
  ["Pan-Arab red, white, black horizontals", "EG IQ SY YE"],
  ["Pan-Arab colours with a hoist triangle or bar", "JO PS SD KW AE"],
  ["Serrated maroon and white", "QA BH"],
  ["Yellow, blue, red horizontals", "CO EC VE"],
  ["Blue, white, blue horizontals", "HN NI SV GT"],
  ["Sun of May", "AR UY"],
  ["Black, red, gold", "DE BE"],
  ["White, green, red horizontals", "HU BG IR TJ"],
  ["Stripes with a blue canton", "US LR MY"],
  ["Star on a triangle, blue and red stripes", "CU PR"],
  ["A red disc", "JP BD PW"],
  ["Blue over red", "HT LI"],
  ["Crescent and star on red", "TR TN"],
  ["Red, white, red horizontals", "AT LV"],
].map(([title, codes]) => ({ title, codes: codes.split(" ") }));

/** For each flag, the flags it is easily confused with. */
export function lookAlikes() {
  const out = new Map();
  for (const { codes } of ALIKE) {
    for (const c of codes) {
      if (!out.has(c)) out.set(c, new Set());
      for (const x of codes) if (x !== c) out.get(c).add(x);
    }
  }
  return out;
}

/**
 * Places in the country table that fly another country's flag and so have
 * no flag of their own to show: Svalbard and Jan Mayen and Bouvet Island
 * (Norway's), the Caribbean Netherlands (the Netherlands'), Heard Island
 * and McDonald Islands (Australia's).
 */
export const NO_OWN_FLAG = new Set(["SJ", "BQ", "BV", "HM"]);

/**
 * Territories that fly the French tricolour, so their flag cannot be told
 * from France's. They are shown, but left out of the quiz.
 */
export const NOT_QUIZZABLE = new Set(["GF", "GP", "MQ", "YT", "RE", "BL", "MF"]);

/**
 * @typedef {object} FlagDesign
 * @property {string[]} col colour keys, largest share first
 * @property {string} lay layout key
 * @property {string[]} sym symbol keys
 */

/**
 * Parse flag-tags.txt.
 * @param {string} text
 * @returns {Map<string, FlagDesign>}
 */
export function parseTags(text) {
  const out = new Map();
  for (const line of text.trim().split("\n")) {
    const [code, col, lay, sym] = line.trim().split(" ");
    out.set(code, { col: [...col], lay, sym: sym === "-" ? [] : [...sym] });
  }
  return out;
}

/** A colour code as the measuring writes it. */
const HEX = /^#[0-9A-F]{6}$/;

/**
 * Parse flag-colours.txt: each flag's main colours as hex codes, largest
 * area first, measured from its drawing on Wikimedia Commons (see
 * tools/data/flag-colours.mjs). Lines that do not fit are skipped.
 * @param {string} text
 * @returns {Map<string, string[]>} code → colours, e.g. "DE" → ["#000000", …]
 */
export function parseFlagColours(text) {
  const out = new Map();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [code, , colours = ""] = line.split("\t");
    const hexes = colours.split(" ").filter((h) => HEX.test(h));
    if (/^[A-Z]{2}(-[A-Z]{3})?$/.test(code) && hexes.length) out.set(code, hexes);
  }
  return out;
}

/**
 * The colour codes to show for a flag. The French territories fly the
 * tricolour (see {@link NOT_QUIZZABLE}), so they get France's colours.
 * @param {string} code
 * @param {Map<string, string[]>} colours from {@link parseFlagColours}
 * @returns {string[]}
 */
export const flagColours = (code, colours) =>
  colours.get(NOT_QUIZZABLE.has(code) ? "FR" : code) ?? [];
