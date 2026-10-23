// Checks src/data/languages.json and tools/data/sign-words.json (or the
// files named on the command line) before they are committed: every field
// of the expected type and size, every country a real place.
//
// It uses only Node's built-in modules on purpose: the workflow job that
// commits the files (.github/workflows/language-data.yml) can write to the
// repository, so it installs no npm packages and runs nothing but this.
//
//   node tools/data/check-languages.mjs [languages.json] [sign-words.json]

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const isText = (v, max) => typeof v === "string" && v.length <= max;
const SCRIPT = /^[A-Z][a-z]{3}$/;
const LOCALE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/;

/**
 * The problems with a languages.json, or none.
 * @param {any} data parsed
 * @param {Set<string>} codes every place code in countries.txt
 * @returns {string[]}
 */
export function checkLanguages(data, codes) {
  const problems = [];
  if (!data || typeof data !== "object") return ["not an object"];
  const scripts = data.scripts ?? {};
  for (const [code, name] of Object.entries(scripts)) {
    if (!SCRIPT.test(code) || !isText(name, 60)) problems.push(`script ${code}`);
  }
  const langs = Array.isArray(data.languages) ? data.languages : [];
  if (langs.length < 40 || langs.length > 300) problems.push(`${langs.length} languages`);
  const ids = new Set();
  for (const l of langs) {
    const where = `language ${String(l?.id).slice(0, 20)}`;
    if (!LOCALE.test(l?.id ?? "") || ids.has(l.id)) problems.push(`${where}: id`);
    ids.add(l?.id);
    if (!scripts[l?.script]) problems.push(`${where}: script`);
    for (const k of ["name", "autonym", "street", "road", "city"]) {
      if (l?.[k] !== undefined && !isText(l[k], 80)) problems.push(`${where}: ${k}`);
    }
    if (!isText(l?.sentence, 300) || !l.sentence) problems.push(`${where}: sentence`);
    if (!isText(l?.letters, 9000)) problems.push(`${where}: letters`);
    const words = Array.isArray(l?.words) ? l.words : null;
    if (!words || words.length > 60 || !words.every((w) => isText(w, 40))) {
      problems.push(`${where}: words`);
    }
    const place = l?.placeWords ?? [];
    if (
      !Array.isArray(place) ||
      place.length > 60 ||
      !place.every(
        (p) => Array.isArray(p) && p.length === 2 && isText(p[0], 30) && isText(p[1], 40),
      )
    ) {
      problems.push(`${where}: place words`);
    }
    const caps = l?.capitals ?? [];
    if (!Array.isArray(caps) || caps.length > 40 || !caps.every((c) => isText(c, 60))) {
      problems.push(`${where}: capitals`);
    }
    const countries = Array.isArray(l?.countries) ? l.countries : [];
    if (!countries.length || !countries.every((c) => codes.has(c))) {
      problems.push(`${where}: countries`);
    }
  }
  for (const t of Array.isArray(data.telltales) ? data.telltales : []) {
    if (!isText(t?.letter, 4) || !t.languages?.every?.((id) => ids.has(id))) {
      problems.push(`telltale ${String(t?.letter).slice(0, 4)}`);
    }
  }
  return problems;
}

/**
 * The problems with a sign-words.json, or none.
 * @param {any} data parsed
 * @returns {string[]}
 */
export function checkSignWords(data) {
  const problems = [];
  for (const word of ["street", "road", "city"]) {
    const labels = data?.[word];
    if (!labels || typeof labels !== "object") {
      problems.push(`no ${word}`);
      continue;
    }
    for (const [code, label] of Object.entries(labels)) {
      if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(code) || !isText(label, 40)) {
        problems.push(`${word} ${code.slice(0, 20)}`);
      }
    }
  }
  const labelsOk = (labels) =>
    labels &&
    typeof labels === "object" &&
    Object.entries(labels).every(
      ([code, label]) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(code) && isText(label, 40),
    );
  for (const [en, w] of Object.entries(data?.words ?? {})) {
    if (
      !isText(en, 30) ||
      !/^(Q\d+|wiktionary:[a-z]+)$/.test(w?.source ?? "") ||
      !labelsOk(w.labels)
    ) {
      problems.push(`word ${en.slice(0, 30)}`);
    }
  }
  for (const [iso, caps] of Object.entries(data?.capitals ?? {})) {
    if (!/^[A-Z]{2}$/.test(iso) || !Array.isArray(caps))
      problems.push(`capital ${iso.slice(0, 5)}`);
    else
      for (const c of caps) {
        if (!/^Q\d+$/.test(c?.source ?? "") || !labelsOk(c.labels)) problems.push(`capital ${iso}`);
      }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("../../", import.meta.url);
  const langFile = process.argv[2] ?? fileURLToPath(new URL("src/data/languages.json", root));
  const wordFile = process.argv[3] ?? fileURLToPath(new URL("tools/data/sign-words.json", root));
  const countries = await readFile(new URL("src/data/countries.txt", root), "utf8");
  const codes = new Set(countries.split("\n").map((l) => l.split("|")[0]));
  const parse = async (file) => JSON.parse(await readFile(file, "utf8"));
  const problems = [
    ...checkLanguages(await parse(langFile).catch(() => null), codes).map(
      (p) => `${langFile}: ${p}`,
    ),
    ...checkSignWords(await parse(wordFile).catch(() => null)).map((p) => `${wordFile}: ${p}`),
  ];
  if (problems.length) {
    console.error(problems.slice(0, 50).join("\n"));
    if (process.env.GITHUB_ACTIONS) {
      const text = problems.slice(0, 30).join("\n").replaceAll("%", "%25").replaceAll("\n", "%0A");
      console.log(`::error title=Language data::${text}`);
    }
    process.exit(1);
  }
  console.log("The language data is well formed.");
}
