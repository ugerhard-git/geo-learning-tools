/**
 * The table of countries and territories in src/data/countries.txt, which
 * every app reads.
 *
 * One line per place, fields separated by "|":
 *
 *     code | alpha-3 | name | region | status | wiki | aliases
 *
 * - **code**: ISO 3166-1 alpha-2, or a subdivision code such as GB-SCT
 *   for the constituent countries of the United Kingdom.
 * - **region**: one letter, see {@link REGIONS}.
 * - **status**: one letter, see {@link STATUS}.
 * - **wiki**: what English Wikipedia calls the place in the title of its
 *   flag article, "Flag of <wiki>" ("the Netherlands", "Georgia (country)").
 *   Empty when that is the name. A leading "=" gives the whole title
 *   instead, for the few articles that do not follow the pattern.
 * - **aliases**: other names accepted as answers, comma-separated.
 *
 * @module shared/countries
 */
import { table } from "./dom.js";

/** Continental regions, as used for scopes and filters. */
export const REGIONS = table({
  F: "Africa",
  A: "Americas",
  S: "Asia",
  E: "Europe",
  O: "Oceania",
  N: "Antarctica",
});

/** Political status. */
export const STATUS = table({
  u: "UN member",
  o: "UN observer state",
  p: "Partially recognised",
  t: "Territory",
  c: "Constituent country",
});

/**
 * @typedef {object} Country
 * @property {string} code
 * @property {string} a3
 * @property {string} name
 * @property {string} region a key of {@link REGIONS}
 * @property {string} status a key of {@link STATUS}
 * @property {string} wiki see the module description; "" when not needed
 * @property {string[]} aliases
 */

/**
 * Parse the table.
 * @param {string} text the contents of countries.txt
 * @returns {Country[]}
 */
export function parseCountries(text) {
  return text
    .trim()
    .split("\n")
    .map((line) => {
      const [code, a3, name, region, status, wiki = "", aliases = ""] = line.split("|");
      return { code, a3, name, region, status, wiki, aliases: aliases.split(",").filter(Boolean) };
    });
}

/**
 * A lookup from code to country.
 * @param {Country[]} list
 * @returns {Record<string, Country>}
 */
export const byCode = (list) => table(Object.fromEntries(list.map((c) => [c.code, c])));

/**
 * Wikipedia titles that may hold the article about a place's flag, most
 * likely first.
 * @param {Country} c
 * @returns {string[]}
 */
export function flagArticleTitles(c) {
  if (c.wiki.startsWith("=")) return [c.wiki.slice(1), `Flags of ${c.name}`];
  if (c.wiki) return [`Flag of ${c.wiki}`, `Flags of ${c.wiki}`];
  return [`Flag of ${c.name}`, `Flag of the ${c.name}`, `Flags of ${c.name}`];
}
