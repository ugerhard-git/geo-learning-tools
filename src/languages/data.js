/**
 * Scripts and Languages data: the official languages of the countries with
 * Street View coverage, read from src/data/languages.json (built by
 * tools/data/languages.mjs from Unicode CLDR and the Universal Declaration
 * of Human Rights; see docs/data.md), and the country table.
 *
 * @module languages/data
 */
import { loadData } from "../shared/net.js";
import { byCode, parseCountries } from "../shared/countries.js";
import { table } from "../shared/dom.js";

/**
 * @typedef {object} Language
 * @property {string} id CLDR locale, e.g. "pl", "sr-Latn", "zh-Hant"
 * @property {string} name English name, e.g. "Polish"
 * @property {string} autonym the language's name for itself, e.g. "polski"
 * @property {string} script ISO 15924 code, e.g. "Latn"
 * @property {string[]} countries where it is official, of those with Street View
 * @property {string} letters every letter it uses, in lower case
 * @property {string[]} words real words: place words, capitals, its own name, its names for
 *   its countries, months; none another language here shares
 * @property {string} sentence Article 1 of the Universal Declaration of Human Rights, first
 *   sentence; empty where there is no translation (Odia, Assamese)
 * @property {string} [street] its word for "street", as on street signs (from Wikidata)
 * @property {string} [road] its word for "road" (from Wikidata)
 * @property {string} [city] its word for "city" (from Wikidata)
 * @property {[string, string][]} [placeWords] words of place names and directions, as
 *   [English, word] pairs (from Wikidata)
 * @property {string[]} [capitals] the capitals of its countries, in the language (from Wikidata)
 * @property {string[]} [regional] the countries where it is official only in some states (from
 *   CLDR)
 * @property {Record<string, { official: string[], additional?: string[] }>} [regions] those
 *   states, by country: where it is an official language, and where an additional one
 */

/**
 * @typedef {object} Telltale
 * @property {string} letter
 * @property {string[]} languages ids of the few languages that use it
 */

/**
 * @typedef {object} LanguageData
 * @property {Language[]} languages
 * @property {Record<string, Language>} byId
 * @property {Record<string, string>} scripts code → name
 * @property {Telltale[]} telltales
 * @property {Record<string, import("../shared/countries.js").Country>} countries the country table
 * @property {string[]} streetView every country some language here is official in
 * @property {{ title: string, url: string } | null} regionsSource the Wikipedia article the
 *   states come from
 */

/**
 * Turn the two files into the app's data.
 * @param {any} json languages.json, parsed
 * @param {string} countryText countries.txt
 * @returns {LanguageData}
 */
export function makeLanguageData(json, countryText) {
  const countries = byCode(parseCountries(countryText));
  const scripts = table(json.scripts);
  const languages = json.languages
    .filter((l) => typeof l.id === "string" && scripts[l.script])
    .map((l) => ({ ...l, countries: l.countries.filter((c) => countries[c]) }));
  const byId = table(Object.fromEntries(languages.map((l) => [l.id, l])));
  const telltales = json.telltales
    .map((t) => ({ ...t, languages: t.languages.filter((id) => byId[id]) }))
    .filter((t) => t.languages.length);
  const streetView = [...new Set(languages.flatMap((l) => l.countries))].sort();
  const src = json.regionsSource;
  const regionsSource =
    typeof src?.title === "string" && /^https:\/\/en\.wikipedia\.org\//.test(src?.url ?? "")
      ? { title: src.title, url: src.url }
      : null;
  return { languages, byId, scripts, telltales, countries, streetView, regionsSource };
}

/** Load the data files. */
export async function loadLanguageData() {
  const [json, countryText] = await Promise.all([
    loadData("languages.json"),
    loadData("countries.txt", "text"),
  ]);
  return makeLanguageData(json, countryText);
}

/**
 * The name a learner knows a language by, without the script in brackets:
 * "Serbian (Latin)" is "Serbian", "Simplified Chinese" is "Chinese".
 * @param {Language} lang
 */
export const plainName = (lang) =>
  lang.name.replace(/\s*\(.*\)$/, "").replace(/^(Simplified|Traditional) /, "");
