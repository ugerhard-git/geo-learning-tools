/**
 * The parts of the world a drill or a list can be limited to: everywhere,
 * a continent (a region letter from the country table, "E" Europe) or a UN
 * sub-region ("039" Southern Europe, from src/data/subregions.json).
 *
 * @module shared/where
 */
import { esc } from "./dom.js";
import { REGIONS } from "./countries.js";

/**
 * The name of a part of the world, or "" if there is none by that code.
 * @param {string} where
 * @param {Record<string, string>} subregions sub-region code → name
 */
export function placeName(where, subregions) {
  if (where === "all") return "Everywhere";
  return REGIONS[where] ?? subregions[where] ?? "";
}

/**
 * Whether a country is in a part of the world.
 * @param {{ region: string, subregion?: string } | undefined} country
 * @param {string} where
 */
export const countryIn = (country, where) =>
  where === "all" || country?.region === where || (country?.subregion ?? "") === where;

/**
 * A select of "Everywhere", the continents, then the sub-regions, of those
 * the given countries lie in.
 * @param {{ id: string, value: string, label?: string }} select
 * @param {{ region: string, subregion?: string }[]} countries
 * @param {Record<string, string>} subregions
 */
export function whereSelect({ id, value, label = "Where" }, countries, subregions) {
  const regions = [...new Set(countries.map((c) => c.region))]
    .filter((r) => REGIONS[r])
    .sort((a, b) => REGIONS[a].localeCompare(REGIONS[b]));
  const subs = [
    ...new Set(countries.map((c) => c.subregion).filter((s) => s && subregions[s])),
  ].sort((a, b) => subregions[a].localeCompare(subregions[b]));
  const opt = (v) =>
    `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(placeName(v, subregions))}</option>`;
  return `<select id="${esc(id)}" aria-label="${esc(label)}">${opt("all")}<optgroup label="Continents">${regions.map(opt).join("")}</optgroup><optgroup label="Parts of continents">${subs.map(opt).join("")}</optgroup></select>`;
}
