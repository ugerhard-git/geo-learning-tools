// Finds and fetches the sign drawings of the Roads app: each Street View
// country's chevron, pedestrian crossing, stop sign and general warning
// sign, as drawn on
// Wikimedia Commons, with each file's licence and author.
//
// For every country in tools/data/street-view-countries.txt:
//
//   1. Read its "Road signs in …" article on English Wikipedia (or "Traffic
//      signs in …"), and collect the drawings in its galleries whose caption
//      names one of the signs below. These are the candidates, written to
//      tools/data/road-sign-candidates.json for review.
//   2. Pick one drawing per sign: the one named in tools/data/road-sign-picks.json
//      if there is one (a person's choice after reading the candidates),
//      otherwise the first candidate.
//   3. Ask Commons for each picked file's licence. Only files whose licence
//      allows reuse are kept (public domain, CC0, CC BY, CC BY-SA); files
//      stored on English Wikipedia rather than Commons are skipped, since
//      those are often not free.
//   4. Download the kept drawings into src/data/signs/ and write
//      src/data/signs.json: per country and sign, the file, its licence,
//      its author and the article it came from.
//
// Wikipedia and Commons cannot be reached from every machine, so this
// normally runs on GitHub: see .github/workflows/road-signs.yml.
//
//   node tools/data/road-signs.mjs

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { parseCountries } from "../../src/shared/countries.js";
import { readStreetView } from "./street-view.mjs";
import { SIGNS, captionedFiles } from "./road-sign-wikitext.mjs";
import { checkSvg } from "../site-checks.mjs";

/** Licences that allow reuse, as Commons names them (LicenseShortName). */
const FREE = /^(public domain|pd\b|cc0|cc[- ]by(-sa)?[- ]?\d|cc by(-sa)? \d)/i;

/** No sign drawing is anywhere near this big. */
const MAX_BYTES = 2 * 1024 * 1024;

const HEADERS = {
  "User-Agent":
    "geo-learning-tools road sign builder (https://github.com/ugerhard-git/geo-learning-tools)",
};

const ROOT = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), "utf8");

const countries = parseCountries(await read("src/data/countries.txt"));
const byCode = new Map(countries.map((c) => [c.code, c]));
const streetView = await readStreetView();
const picks = JSON.parse(await read("tools/data/road-sign-picks.json").catch(() => "{}"));

/* --------------------------------------------------------------- articles */

/** The article titles that may hold a country's signs, likeliest first. */
function articleTitles(c) {
  const names = [
    ...new Set([c.wiki && !c.wiki.startsWith("=") ? c.wiki : "", c.name].filter(Boolean)),
  ];
  return names.flatMap((n) => [
    `Road signs in ${n}`,
    `Traffic signs in ${n}`,
    `Road signs in the ${n}`,
  ]);
}

/**
 * The wikitext of the first of these articles that exists, following
 * redirects.
 * @returns {Promise<{ title: string, text: string } | null>}
 */
async function firstArticle(titles) {
  for (const title of titles) {
    const url =
      "https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&redirects=1" +
      `&prop=wikitext&page=${encodeURIComponent(title)}`;
    const res = await fetchPolitely(url);
    const json = await res.json();
    if (json?.parse?.wikitext) return { title: json.parse.title, text: json.parse.wikitext };
    await sleep(300);
  }
  return null;
}

/* ------------------------------------------------------------- licences */

/**
 * Commons' description of each file: where it is, its licence and author.
 * @param {string[]} files
 */
async function fileInfo(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 40) {
    const batch = files.slice(i, i + 40);
    const url =
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1" +
      "&prop=imageinfo&iiprop=url|extmetadata&iiextmetadatafilter=LicenseShortName|Artist|AttributionRequired" +
      `&titles=${encodeURIComponent(batch.map((f) => `File:${f}`).join("|"))}`;
    const json = await (await fetchPolitely(url)).json();
    const step = (list) => new Map((list ?? []).map((x) => [x.from, x.to]));
    const normalised = step(json?.query?.normalized);
    const redirected = step(json?.query?.redirects);
    const pages = new Map((json?.query?.pages ?? []).map((p) => [p.title, p]));
    for (const f of batch) {
      const t = `File:${f}`;
      const n = normalised.get(t) ?? t;
      const page = pages.get(redirected.get(n) ?? n);
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      const meta = info.extmetadata ?? {};
      out.set(f, {
        url: info.url,
        licence: plain(meta.LicenseShortName?.value ?? ""),
        author: plain(meta.Artist?.value ?? ""),
        attribution: meta.AttributionRequired?.value === "true",
      });
    }
    await sleep(500);
  }
  return out;
}

/** Commons metadata is HTML; keep its text. */
function plain(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/* ------------------------------------------------------------------ run */

const candidates = {};
const report = [];
for (const code of streetView) {
  const c = byCode.get(code);
  if (!c) continue;
  const article = await firstArticle(articleTitles(c));
  if (!article) {
    report.push(`${code}  no road sign article`);
    continue;
  }
  const files = captionedFiles(article.text);
  const found = {};
  for (const [sign, words] of Object.entries(SIGNS)) {
    const matching = files.filter((f) => words.test(f.caption));
    if (matching.length) found[sign] = matching.slice(0, 6);
  }
  candidates[code] = { article: article.title, ...found };
  report.push(`${code}  ${article.title}: ${Object.keys(found).join(", ") || "nothing captioned"}`);
  await sleep(300);
}

// One drawing per country and sign: the person's pick, else the first candidate.
const chosen = [];
for (const [code, entry] of Object.entries(candidates)) {
  for (const sign of Object.keys(SIGNS)) {
    const file = picks[code]?.[sign] ?? entry[sign]?.[0]?.file;
    if (file && file !== "-") chosen.push({ code, sign, file, article: entry.article });
  }
}

const infos = await fileInfo([...new Set(chosen.map((c) => c.file))]);
await rm(new URL("src/data/signs/", ROOT), { recursive: true, force: true });
await mkdir(new URL("src/data/signs/", ROOT), { recursive: true });
const signs = {};
for (const pick of chosen) {
  const info = infos.get(pick.file);
  const why = !info
    ? "not on Commons"
    : !info.url.startsWith("https://upload.wikimedia.org/wikipedia/commons/")
      ? "stored on Wikipedia, not Commons"
      : !FREE.test(info.licence)
        ? `licence "${info.licence}" not reusable`
        : "";
  if (why) {
    report.push(`${pick.code} ${pick.sign}: ${pick.file} left out (${why})`);
    continue;
  }
  const res = await fetchPolitely(info.url);
  const svg = await res.text();
  if (svg.length > MAX_BYTES || !/<svg[\s>]/.test(svg) || checkSvg(svg).length) {
    report.push(`${pick.code} ${pick.sign}: ${pick.file} left out (not a plain, modest SVG)`);
    continue;
  }
  const name = `${pick.code.toLowerCase()}-${pick.sign}.svg`;
  await writeFile(new URL(`src/data/signs/${name}`, ROOT), svg);
  signs[pick.code] ??= {};
  signs[pick.code][pick.sign] = {
    file: name,
    commons: pick.file,
    licence: info.licence,
    author: info.author,
    source: pick.article,
  };
  await sleep(300);
}

await writeFile(
  new URL("tools/data/road-sign-candidates.json", ROOT),
  JSON.stringify(candidates, null, 1) + "\n",
);
await writeFile(new URL("src/data/signs.json", ROOT), JSON.stringify(signs) + "\n");
const counts = Object.keys(SIGNS).map(
  (s) => `${Object.values(signs).filter((x) => x[s]).length} ${s}`,
);
console.log(report.join("\n"));
console.log(`\nKept: ${counts.join(", ")}.`);
if (process.env.GITHUB_ACTIONS) {
  console.log(`::notice title=Road signs::Kept ${counts.join(", ")}.`);
}

/** fetch(), waiting and retrying when Wikimedia asks for it (429/503). */
async function fetchPolitely(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res;
    if (![429, 503].includes(res.status) || attempt === 6) {
      throw new Error(`${url.slice(0, 80)}: answered ${res.status}`);
    }
    await sleep((Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
