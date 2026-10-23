// Checks the sign drawings tools/data/road-signs.mjs fetched, before the
// workflow commits them: signs.json well formed, every drawing it names
// present, a modest SVG that cannot run script, and nothing else in the
// folder.
//
// It uses only Node's built-in modules (and tools/site-checks.mjs, which
// does too), because the workflow job that commits the drawings
// (.github/workflows/road-signs.yml) can write to the repository.
//
//   node tools/data/check-road-signs.mjs [folder holding signs.json and signs/]

import { readFile, readdir, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { checkSvg } from "../site-checks.mjs";

const SIGN_NAMES = ["chevron", "crossing", "pedestrian", "stop", "warning"];
const isText = (v, max) => typeof v === "string" && v.length <= max;

/**
 * The problems with signs.json and its drawings, or none.
 * @param {any} signs parsed signs.json
 * @param {Map<string, string>} files drawing name → its text
 * @param {Set<string>} codes every place code in countries.txt
 */
export function checkRoadSigns(signs, files, codes) {
  const problems = [];
  if (!signs || typeof signs !== "object") return ["signs.json is not an object"];
  const named = new Set();
  for (const [code, entry] of Object.entries(signs)) {
    if (!codes.has(code)) problems.push(`${code.slice(0, 10)} is not in countries.txt`);
    for (const [sign, s] of Object.entries(entry ?? {})) {
      const where = `${code} ${sign}`;
      if (!SIGN_NAMES.includes(sign)) problems.push(`${where}: unknown sign`);
      if (s?.file !== `${code.toLowerCase()}-${sign}.svg`) problems.push(`${where}: file name`);
      for (const k of ["commons", "licence", "author", "source"]) {
        if (!isText(s?.[k], 200)) problems.push(`${where}: ${k}`);
      }
      if (s?.changed !== undefined && !isText(s.changed, 60)) problems.push(`${where}: changed`);
      named.add(s?.file);
      const svg = files.get(s?.file);
      if (svg === undefined) problems.push(`${where}: drawing missing`);
      else {
        if (svg.length > 2 * 1024 * 1024) problems.push(`${where}: drawing too large`);
        for (const p of checkSvg(svg)) problems.push(`${where}: ${p}`);
      }
    }
  }
  for (const name of files.keys())
    if (!named.has(name)) problems.push(`${name}: not in signs.json`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const dir = process.argv[2] ?? join(root, "src", "data");
  const codes = new Set(
    (await readFile(join(root, "src", "data", "countries.txt"), "utf8"))
      .split("\n")
      .map((l) => l.split("|")[0]),
  );
  const signs = JSON.parse(await readFile(join(dir, "signs.json"), "utf8").catch(() => "null"));
  const files = new Map();
  const problems = [];
  for (const name of await readdir(join(dir, "signs")).catch(() => [])) {
    const path = join(dir, "signs", name);
    if (!(await lstat(path)).isFile() || !/^[a-z]{2}(-[a-z]{3})?-[a-z]+\.svg$/.test(name)) {
      problems.push(`${name.slice(0, 40)}: unexpected entry`);
      continue;
    }
    files.set(name, await readFile(path, "utf8"));
  }
  problems.push(...checkRoadSigns(signs, files, codes));
  if (problems.length) {
    console.error(problems.slice(0, 60).join("\n"));
    if (process.env.GITHUB_ACTIONS) {
      const text = problems.slice(0, 30).join("\n").replaceAll("%", "%25").replaceAll("\n", "%0A");
      console.log(`::error title=Road signs::${text}`);
    }
    process.exit(1);
  }
  console.log(`${files.size} sign drawings, all well formed.`);
}
