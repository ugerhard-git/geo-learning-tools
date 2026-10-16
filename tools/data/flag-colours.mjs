// Builds src/data/flag-colours.txt: the main colours of every flag, as hex
// codes, measured from the flag drawings on Wikimedia Commons.
//
// For each place in src/data/countries.txt that has a flag of its own:
//
//   1. Ask English Wikipedia for the lead image of its flag article ("Flag
//      of Germany"), which is the Commons drawing the article shows. If there
//      is none, fall back to the usual Commons name, "Flag of <name>.svg".
//   2. Download that SVG from Commons.
//   3. Draw it in Chromium (through Playwright, which the tests already use)
//      and count the pixels of each colour. Colours that are nearly the same
//      are merged into the commonest of them, so the soft edges between two
//      stripes do not count as colours of their own.
//   4. Keep the colours that cover at least 2% of the flag, largest first.
//
// Places that fly another country's flag (see NOT_QUIZZABLE and
// NO_OWN_FLAG in src/flags/design.js) are left out; the app shows the
// colours of that country's flag instead.
//
// The drawings are not reachable from every machine, so this normally runs
// on GitHub: see .github/workflows/flag-colours.yml. To run it by hand:
//
//   node tools/data/flag-colours.mjs            # all flags
//   node tools/data/flag-colours.mjs DE FR JP   # just these, printed only
//
// It writes the file (for a full run) and prints a report: the drawing used
// for each flag, and anything that needs a human look.

/* global Image, document -- only used inside page.evaluate(), which runs in the browser */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { parseCountries, flagArticleTitles } from "../../src/shared/countries.js";
import { NO_OWN_FLAG, NOT_QUIZZABLE } from "../../src/flags/design.js";
import { FLAG_COLOUR_LINE } from "./check-flag-colours.mjs";

const ROOT = new URL("../../", import.meta.url);
const OUT = new URL("src/data/flag-colours.txt", ROOT);

/** Colours covering less of the flag than this are details, not main colours. */
const MIN_SHARE = 0.02;
/** At most this many colours per flag. */
const MAX_COLOURS = 8;
/** Colours closer than this (straight-line distance in RGB) count as one. */
const MERGE_DISTANCE = 40;
/** Width the flags are drawn at for counting. Wide enough for thin stripes. */
const DRAW_WIDTH = 600;
/** No flag drawing is anywhere near this big; anything larger is refused. */
const MAX_SVG_BYTES = 5 * 1024 * 1024;

/** Wikimedia asks automated clients to say who they are. */
const HEADERS = {
  "User-Agent":
    "geo-learning-tools flag colour builder (https://github.com/ugerhard-git/geo-learning-tools)",
};

const only = process.argv.slice(2).map((c) => c.toUpperCase());
const countries = parseCountries(await readFile(new URL("src/data/countries.txt", ROOT), "utf8"))
  .filter((c) => !NO_OWN_FLAG.has(c.code) && !NOT_QUIZZABLE.has(c.code))
  .filter((c) => !only.length || only.includes(c.code));

const report = [];
const lines = [];

// The drawing of every flag, looked up before any is downloaded: Wikipedia
// answers 50 titles per request, which keeps well inside its rate limits.
const drawings = await drawingsOf(countries);

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

for (const country of countries) {
  try {
    const file = drawings.get(country.code);
    const svg = await download(file);
    const colours = await measure(svg);
    if (!colours.length) throw new Error("no colour covers 2% of the flag");
    const line = `${country.code}\t${file}\t${colours.map((c) => c.hex).join(" ")}`;
    if (!FLAG_COLOUR_LINE.test(line)) throw new Error(`unexpected result: ${line}`);
    lines.push(line);
    report.push(
      `${country.code}  ${file}  ${colours.map((c) => `${c.hex} ${(c.share * 100).toFixed(0)}%`).join("  ")}`,
    );
  } catch (e) {
    report.push(`${country.code}  NEEDS A LOOK: ${e.message}`);
  }
  // Be gentle with Wikimedia's servers.
  await sleep(500);
}
await browser.close();

console.log(report.join("\n"));
const needLook = report.filter((r) => r.includes("NEEDS A LOOK"));
const summary = `${lines.length} flags measured, ${needLook.length} need a look.`;
console.log(`\n${summary}`);
// On GitHub, also as an annotation on the run, which can be read without
// opening the log.
if (process.env.GITHUB_ACTIONS) {
  const text = [summary, ...needLook].join("\n").slice(0, 4000);
  console.log(
    `::notice title=Flag colours::${text.replaceAll("%", "%25").replaceAll("\n", "%0A")}`,
  );
}

if (!only.length) {
  await writeFile(
    OUT,
    "# Main colours of each flag, measured from its drawing on Wikimedia Commons by\n" +
      "# tools/data/flag-colours.mjs. code <TAB> Commons file <TAB> colours, largest first.\n" +
      lines.join("\n") +
      "\n",
  );
  console.log(`Wrote ${OUT.pathname}`);
}
// A run that measured nothing at all has gone wrong (the network, most
// likely), and must not replace the file with an empty one.
if (!lines.length) process.exit(1);

/**
 * The Commons file name of each place's flag drawing: the lead image of its
 * flag article (trying each likely title in turn), or failing that the
 * conventional "Flag of <name>.svg".
 * @returns {Promise<Map<string, string>>} code → file name
 */
async function drawingsOf(list) {
  const found = new Map();
  const titles = list.map((c) => flagArticleTitles(c));
  for (let attempt = 0; attempt < 3; attempt++) {
    const asking = list.filter((c, i) => !found.has(c.code) && titles[i][attempt]);
    const images = await leadImages(asking.map((c) => titles[list.indexOf(c)][attempt]));
    for (const c of asking) {
      const name = images.get(titles[list.indexOf(c)][attempt]);
      // Only a drawing of a flag will do: not a photo of one flying.
      if (name && /^Flag.*\.svg$/i.test(name)) found.set(c.code, name);
    }
  }
  for (const c of list) {
    if (found.has(c.code)) continue;
    const title = c.wiki.startsWith("=") ? c.wiki.slice(1) : `Flag of ${c.wiki || c.name}`;
    found.set(c.code, `${title.replaceAll(" ", "_")}.svg`);
  }
  return found;
}

/**
 * The lead image of each of these Wikipedia articles, 50 to a request.
 * @param {string[]} titles
 * @returns {Promise<Map<string, string>>} title as given → image file name
 */
async function leadImages(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2" +
      `&redirects=1&prop=pageimages&piprop=name&titles=${encodeURIComponent(batch.join("|"))}`;
    const answer = await (await fetchPolitely(url)).json();
    // Follow each title through Wikipedia's normalising and redirects to its page.
    const step = (list) => new Map((list ?? []).map((x) => [x.from, x.to]));
    const normalised = step(answer?.query?.normalized);
    const redirected = step(answer?.query?.redirects);
    const pages = new Map((answer?.query?.pages ?? []).map((p) => [p.title, p.pageimage]));
    for (const title of batch) {
      const n = normalised.get(title) ?? title;
      const image = pages.get(redirected.get(n) ?? n);
      if (typeof image === "string") out.set(title, image);
    }
    await sleep(1000);
  }
  return out;
}

/**
 * Download a drawing straight from Commons' file server, refusing anything
 * that is not a modest SVG. Files live under the first one and two hex
 * digits of the MD5 of their name.
 */
async function download(file) {
  const name = file.replaceAll(" ", "_");
  const md5 = createHash("md5").update(name).digest("hex");
  const url = `https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5.slice(0, 2)}/${encodeURIComponent(name)}`;
  const text = await (await fetchPolitely(url, file)).text();
  if (text.length > MAX_SVG_BYTES) throw new Error(`${file}: too large`);
  if (!/<svg[\s>]/.test(text)) throw new Error(`${file}: not an SVG`);
  return text;
}

/**
 * fetch(), but when Wikimedia says "too many requests" (429) or is briefly
 * unavailable, wait as long as it asks (or longer each time) and try again.
 */
async function fetchPolitely(url, what = "Wikipedia") {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res;
    if (![429, 503].includes(res.status) || attempt === 6) {
      throw new Error(`${what}: answered ${res.status}`);
    }
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await sleep(Math.min(wait, 60) * 1000);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Draw an SVG and return its main colours with the share of the flag each
 * covers. The SVG is shown as an image, so any script in it does not run.
 * @returns {Promise<{ hex: string, share: number }[]>}
 */
async function measure(svg) {
  const counts = await page.evaluate(
    async ({ svg, width }) => {
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const img = new Image();
      img.src = url;
      await img.decode();
      const ratio = img.naturalHeight / img.naturalWidth || 2 / 3;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.max(1, Math.round(width * ratio));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = {};
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 250) continue; // transparent: not part of the flag
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    },
    { svg, width: DRAW_WIDTH },
  );

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return [];
  // Commonest first, so each cluster is named after its commonest colour.
  const byCount = Object.entries(counts)
    .map(([key, n]) => ({ rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255], n }))
    .sort((a, b) => b.n - a.n);
  const clusters = [];
  for (const c of byCount) {
    const near = clusters.find((k) => distance(k.rgb, c.rgb) < MERGE_DISTANCE);
    if (near) near.n += c.n;
    else clusters.push({ ...c });
  }
  return clusters
    .filter((k) => k.n / total >= MIN_SHARE)
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_COLOURS)
    .map((k) => ({ hex: toHex(k.rgb), share: k.n / total }));
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function toHex(rgb) {
  return (
    "#" +
    rgb
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}
