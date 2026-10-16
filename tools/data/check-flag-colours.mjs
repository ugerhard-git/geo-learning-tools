// Checks src/data/flag-colours.txt (or the file named on the command line)
// before it is committed: every line well formed, every code a real place,
// no place twice.
//
// It uses only Node's built-in modules on purpose. The workflow that commits
// the measured file (.github/workflows/flag-colours.yml) can write to the
// repository, so it installs no npm packages and runs nothing but this.
//
//   node tools/data/check-flag-colours.mjs [file]

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * One flag: code, Commons file name, then one to eight colours as
 * #RRGGBB, separated by spaces.
 */
export const FLAG_COLOUR_LINE =
  /^[A-Z]{2}(-[A-Z]{3})?\t[^\t\n<>"]{1,200}\.svg\t#[0-9A-F]{6}( #[0-9A-F]{6}){0,7}$/;

/**
 * The problems with a flag-colours file, or none.
 * @param {string} text the file
 * @param {Set<string>} codes every place code in countries.txt
 * @returns {string[]}
 */
export function checkFlagColours(text, codes) {
  const problems = [];
  const seen = new Set();
  const lines = text.split("\n").filter((l) => l && !l.startsWith("#"));
  for (const [i, line] of lines.entries()) {
    if (!FLAG_COLOUR_LINE.test(line)) {
      problems.push(`line ${i + 1} is not "code, file, colours": ${line.slice(0, 80)}`);
      continue;
    }
    const code = line.split("\t")[0];
    if (!codes.has(code)) problems.push(`${code} is not in countries.txt`);
    if (seen.has(code)) problems.push(`${code} appears twice`);
    seen.add(code);
  }
  if (lines.length < 200)
    problems.push(`only ${lines.length} flags; a full run measures about 240`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("../../", import.meta.url);
  const file = process.argv[2] ?? fileURLToPath(new URL("src/data/flag-colours.txt", root));
  const countries = await readFile(new URL("src/data/countries.txt", root), "utf8");
  const codes = new Set(
    countries
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split("|")[0]),
  );
  const problems = checkFlagColours(await readFile(file, "utf8"), codes);
  if (problems.length) {
    console.error(`${file}:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`${file} is well formed.`);
}
