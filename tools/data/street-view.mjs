// The list of countries with Street View coverage, kept in
// tools/data/street-view-countries.txt, and its reader. Shared by the
// scripts that build the Scripts and Languages and the Roads data.

import { readFile } from "node:fs/promises";

/**
 * Read the list: one code per line, lines starting with # are notes.
 * @param {string} text the file
 * @returns {string[]} codes
 */
export function parseCountryList(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** The Street View countries, read from the file. */
export const readStreetView = async () =>
  parseCountryList(await readFile(new URL("street-view-countries.txt", import.meta.url), "utf8"));
