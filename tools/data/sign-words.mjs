// Builds tools/data/sign-words.json: words that show up on signs, in every
// language Wikidata has them in, and each Street View country's capital in
// every language: Wikidata (CC0), and Wiktionary (CC BY-SA) for adjectives.
//
//   - street, road, city: labels of the items Q79007, Q34442 and Q515, for the
//     "On signs" line of each language.
//   - words: the words of place names and directions, labels of the items in
//     NOUNS (north, river, mountain, port…), and for the adjectives (new, old,
//     upper, lower, big, small) the first translation table of the English
//     word on Wiktionary (CC BY-SA). Each keeps its English word, for the app
//     to show.
//   - capitals: each Street View country's capital (P36), labelled in every
//     language.
//
// tools/data/languages.mjs picks out the app's languages and merges the
// words into src/data/languages.json, so run this first, then that. The
// Language data workflow (.github/workflows/language-data.yml) does both on
// GitHub, since Wikidata cannot be reached from every machine.
//
//   node tools/data/sign-words.mjs

import { writeFile } from "node:fs/promises";
import { readStreetView } from "./street-view.mjs";

/** The words of the "On signs" line. */
const ITEMS = { street: "Q79007", road: "Q34442", city: "Q515" };

/**
 * Words of town, road, region and landmark names, and of directions: the
 * English word and its Wikidata item. The item's English label must match,
 * or the word is left out (and reported), so a wrong id cannot slip in.
 */
const NOUNS = {
  north: "Q659",
  south: "Q667",
  east: "Q684",
  west: "Q679",
  village: "Q532",
  town: "Q3957",
  hill: "Q54050",
  mountain: "Q8502",
  valley: "Q39816",
  river: "Q4022",
  lake: "Q23397",
  beach: "Q40080",
  coast: "Q93352",
  island: "Q23442",
  bay: "Q39594",
  port: "Q44782",
  bridge: "Q12280",
  church: "Q16970",
  castle: "Q23413",
  "railway station": "Q55488",
  airport: "Q1248784",
  square: "Q174782",
  forest: "Q4421",
};

/** Adjectives of place names; their translations come from Wiktionary. */
const ADJECTIVES = ["new", "old", "upper", "lower", "big", "small"];

const HEADERS = {
  "User-Agent":
    "geo-learning-tools sign word builder (https://github.com/ugerhard-git/geo-learning-tools)",
  Accept: "application/sparql-results+json",
};

/** A language tag Wikidata uses, and a short enough word. */
const LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;
const clean = (v) => (typeof v === "string" && v.trim().length <= 40 ? v.trim() : "");

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res.json();
    if (![429, 503].includes(res.status) || attempt === 5) {
      throw new Error(`${url.slice(0, 80)}: answered ${res.status}`);
    }
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
  }
}

/** item id → its labels, language → label */
async function labelsOf(qids) {
  const out = {};
  for (let i = 0; i < qids.length; i += 40) {
    const batch = qids.slice(i, i + 40);
    const json = await getJson(
      "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels" +
        `&ids=${batch.join("|")}`,
    );
    for (const q of batch) {
      out[q] = {};
      for (const [code, l] of Object.entries(json.entities?.[q]?.labels ?? {})) {
        const v = clean(l?.value);
        if (LANG.test(code) && v) out[q][code] = v;
      }
    }
  }
  return out;
}

const sparql = (query) =>
  getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`);

const report = [];
const out = {
  source:
    "Wikidata (CC0): item labels and each country's capital (P36). Wiktionary (CC BY-SA 4.0): translations of the adjectives",
};

// The "On signs" words.
const signLabels = await labelsOf(Object.values(ITEMS));
for (const [word, qid] of Object.entries(ITEMS)) out[word] = signLabels[qid];

// Nouns, checked against their English label.
const nounLabels = await labelsOf(Object.values(NOUNS));
out.words = {};
for (const [en, qid] of Object.entries(NOUNS)) {
  const labels = nounLabels[qid];
  // "church" is "church building"; the English word must be in the label.
  if (!(labels.en ?? "").toLowerCase().split(/\s+/).includes(en.split(" ").at(-1))) {
    report.push(`${en}: ${qid} is "${labels.en ?? "?"}" in English; left out`);
    continue;
  }
  out.words[en] = { source: qid, labels };
}

// Adjectives, from Wiktionary's translation tables (CC BY-SA): the first
// sense of each word, the one place names mean ("new" as in recently made).
for (const en of ADJECTIVES) {
  let text = "";
  for (const page of [`${en}/translations`, en]) {
    const json = await getJson(
      "https://en.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2" +
        `&prop=wikitext&page=${encodeURIComponent(page)}`,
    ).catch(() => null);
    const wt = json?.parse?.wikitext ?? "";
    // The adjective's section, then its first translation table.
    const adj = wt.slice(Math.max(0, wt.search(/===\s*Adjective\s*===/)));
    const m = /\{\{trans-top[^}]*\}\}([\s\S]*?)\{\{trans-bottom\}\}/.exec(adj);
    if (m) {
      text = m[1];
      break;
    }
  }
  const labels = {};
  for (const t of text.matchAll(/\{\{tt?\+?\|([a-z-]{2,12})\|([^|}]+)/g)) {
    let code = t[1];
    const v = clean(t[2].replace(/\[\[|\]\]/g, ""));
    // Serbo-Croatian lists both scripts under one code.
    if (code === "sh") code = /[\u0400-\u04FF]/.test(v) ? "sr-ec" : "sh";
    if (LANG.test(code) && v && !labels[code]) labels[code] = v;
  }
  if (Object.keys(labels).length < 20) {
    report.push(`${en}: only ${Object.keys(labels).length} translations on Wiktionary; left out`);
    continue;
  }
  out.words[en] = { source: `wiktionary:${en}`, labels };
}

// Capitals of the Street View countries.
const streetView = await readStreetView();
const caps = await sparql(`
  SELECT ?iso ?capital WHERE {
    VALUES ?iso { ${streetView.map((c) => `"${c}"`).join(" ")} }
    ?country wdt:P297 ?iso; p:P36 ?st.
    ?st ps:P36 ?capital.
    FILTER NOT EXISTS { ?st pq:P582 ?end }
  }`);
const capitalsOf = {};
for (const b of caps.results?.bindings ?? []) {
  const iso = b.iso?.value;
  const q = String(b.capital?.value ?? "").replace(/^.*\//, "");
  if (/^[A-Z]{2}$/.test(iso) && /^Q\d+$/.test(q)) (capitalsOf[iso] ??= []).push(q);
}
const capLabels = await labelsOf([...new Set(Object.values(capitalsOf).flat())]);
out.capitals = {};
for (const iso of streetView) {
  const qs = [...new Set(capitalsOf[iso] ?? [])];
  if (!qs.length) report.push(`${iso}: no capital on Wikidata`);
  out.capitals[iso] = qs.map((q) => ({ source: q, labels: capLabels[q] ?? {} }));
}

const counts = [
  ...Object.keys(ITEMS).map((w) => `${Object.keys(out[w] ?? {}).length} ${w}`),
  `${Object.keys(out.words).length} words`,
  `${Object.values(out.capitals).filter((c) => c.length).length} countries with capitals`,
];
console.log([...report, `Labels: ${counts.join(", ")}.`].join("\n"));
if (Object.keys(ITEMS).some((w) => Object.keys(out[w] ?? {}).length < 100)) {
  console.error("Too few labels; not writing the file.");
  process.exit(1);
}
if (process.env.GITHUB_ACTIONS && report.length) {
  const text = report.join("\n").replaceAll("%", "%25").replaceAll("\n", "%0A");
  console.log(`::warning title=Sign words left out::${text}`);
}
await writeFile(new URL("sign-words.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
