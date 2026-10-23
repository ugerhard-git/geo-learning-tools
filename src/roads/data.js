/**
 * Roads data: each Street View country's driving side and centre line
 * colour (src/data/roads.json, by hand from the sources it names) and its
 * sign drawings (src/data/signs.json and src/data/signs/, fetched from
 * Wikimedia Commons by tools/data/road-signs.mjs), with the country table.
 * See docs/data.md.
 *
 * @module roads/data
 */
import { loadData } from "../shared/net.js";
import { byCode, parseCountries } from "../shared/countries.js";
import { table } from "../shared/dom.js";

/** The sign drawings, in the order the app shows them. */
export const SIGN_CLUES = ["stop", "crossing", "pedestrian", "chevron", "warning"];

/** Every clue, in the order the app shows them. */
export const CLUES = table({
  side: { label: "Driving side", short: "side" },
  lines: { label: "Centre lines", short: "lines" },
  stop: { label: "Stop signs", short: "stop" },
  crossing: { label: "Crossing here", short: "crossing" },
  pedestrian: { label: "Crossing ahead", short: "crossing warning" },
  chevron: { label: "Chevrons", short: "chevron" },
  warning: { label: "Warning signs", short: "warning" },
});

/** Centre line colours, as the app names them. */
export const COLOURS = table({
  white: "White",
  yellow: "Yellow",
  both: "White and yellow",
});

/** A drawing's file name, as tools/data/road-signs.mjs writes them. */
const SIGN_FILE = /^[a-z]{2}-[a-z]+\.svg$/;

/**
 * @typedef {object} Sign
 * @property {string} file the drawing, in src/data/signs/
 * @property {string} commons its name on Wikimedia Commons
 * @property {string} licence
 * @property {string} author
 * @property {string} source the Wikipedia article it was found in
 * @property {string} [changed] how the copy differs from the file on Commons
 */

/**
 * @typedef {object} Centre
 * @property {"white" | "yellow" | "both"} colour
 * @property {string} note
 * @property {string} source a key of the sources
 * @property {boolean} [regional] only the rule for the country's part of the world is sourced
 */

/**
 * @typedef {object} RoadCountry
 * @property {string} code
 * @property {string} name
 * @property {string[]} aliases
 * @property {string} region
 * @property {"left" | "right"} drive
 * @property {string} driveSource a key of the sources
 * @property {Centre} [centre]
 * @property {Partial<Record<string, Sign>>} signs by clue: stop, crossing, pedestrian, chevron, warning
 */

/**
 * @typedef {object} RoadData
 * @property {RoadCountry[]} countries every Street View country, by name
 * @property {Record<string, RoadCountry>} byCode
 * @property {Record<string, { title: string, url: string, publisher: string }>} sources
 */

/**
 * Turn the data files into the app's data.
 * @param {any} roads roads.json, parsed
 * @param {any} signs signs.json, parsed
 * @param {string} countryText countries.txt
 * @returns {RoadData}
 */
export function makeRoadData(roads, signs, countryText) {
  const known = byCode(parseCountries(countryText));
  const sources = table(roads.sources);
  const countries = [];
  for (const [code, r] of Object.entries(roads.countries)) {
    const c = known[code];
    if (!c || (r.drive !== "left" && r.drive !== "right")) continue;
    const centre =
      r.centre && COLOURS[r.centre.colour] && sources[r.centre.source] ? r.centre : null;
    const own = signs[code] ?? {};
    const drawn = table({});
    for (const clue of SIGN_CLUES) {
      const s = own[clue];
      if (s && SIGN_FILE.test(s.file)) drawn[clue] = s;
    }
    countries.push({
      code,
      name: c.name,
      aliases: c.aliases,
      region: c.region,
      drive: r.drive,
      driveSource: sources[r.driveSource] ? r.driveSource : "",
      ...(centre ? { centre } : {}),
      signs: drawn,
    });
  }
  countries.sort((a, b) => a.name.localeCompare(b.name));
  return {
    countries,
    byCode: table(Object.fromEntries(countries.map((c) => [c.code, c]))),
    sources,
  };
}

/** Whether a country has something to show for a clue. */
export function hasClue(country, clue) {
  if (clue === "side") return true;
  if (clue === "lines") return Boolean(country.centre);
  return Boolean(country.signs[clue]);
}

/** Load the data files. */
export async function loadRoadData() {
  const [roads, signs, countryText] = await Promise.all([
    loadData("roads.json"),
    loadData("signs.json"),
    loadData("countries.txt", "text"),
  ]);
  return makeRoadData(roads, signs, countryText);
}

/** Where a drawing is, from a page in src/roads/. */
export const signUrl = (sign) => `../data/signs/${sign.file}`;

/** A drawing's page on Wikimedia Commons. */
export const commonsUrl = (sign) =>
  `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(sign.commons)}`;

/** A Wikipedia article's address. */
export const articleUrl = (title) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
