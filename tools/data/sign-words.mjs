// Builds tools/data/sign-words.json: words that show up on signs, in every
// language Wikidata has them in, and each Street View country's capital in
// every language: Wikidata (CC0), and Wiktionary (CC BY-SA) for adjectives.
//
//   - street, road, city: labels of the items Q79007, Q34442 and Q515, for the
//     "On signs" line of each language.
//   - words: the words of place names and directions (north, river,
//     mountain, port, new, old…), from the English word's translation table
//     on Wiktionary (CC BY-SA), which gives the plain word signs use, and the
//     labels of a Wikidata item as a fallback. Each keeps its English word,
//     for the app to show. The list is WORDS.
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
 * English word, its Wiktionary entry (page, part of speech, and words the
 * gloss of the right sense contains, where the first sense is not the one
 * place names mean) and, for nouns, the Wikidata item as a fallback. The
 * item's English label must contain the word, or it is not used, so a wrong
 * id cannot slip in.
 */
const WORDS = {
  north: { pos: "Noun", gloss: /compass|direction/, qid: "Q659" },
  south: { pos: "Noun", gloss: /compass|direction/, qid: "Q667" },
  east: { pos: "Noun", gloss: /compass|direction/, qid: "Q684" },
  west: { pos: "Noun", gloss: /compass|direction/, qid: "Q679" },
  village: { pos: "Noun", qid: "Q532" },
  town: { pos: "Noun", qid: "Q3957" },
  hill: { pos: "Noun", qid: "Q54050" },
  mountain: { pos: "Noun", gloss: /elevation|landform|earth|rock|summit/, qid: "Q8502" },
  valley: { pos: "Noun", gloss: /hills|mountains|between|depression/, qid: "Q39816" },
  river: { pos: "Noun", qid: "Q4022" },
  lake: { pos: "Noun", qid: "Q23397" },
  beach: { pos: "Noun", qid: "Q40080" },
  coast: { pos: "Noun", qid: "Q93352" },
  island: { pos: "Noun", qid: "Q23442" },
  bay: { pos: "Noun", gloss: /water|coast|sea/, qid: "Q39594" },
  port: { pos: "Noun", gloss: /harbou?r|ships|dock/, qid: "Q44782" },
  bridge: { pos: "Noun", qid: "Q12280" },
  church: { pos: "Noun", gloss: /worship|building/, qid: "Q16970" },
  castle: { pos: "Noun", qid: "Q23413" },
  station: { page: "railway station", pos: "Noun", qid: "Q55488" },
  airport: { pos: "Noun", qid: "Q1248784" },
  square: { page: "town square", pos: "Noun", qid: "Q174782" },
  forest: { pos: "Noun", qid: "Q4421" },
  new: { pos: "Adjective" },
  old: { pos: "Adjective" },
  upper: { pos: "Adjective" },
  lower: { pos: "Adjective" },
  small: { pos: "Adjective" },
};

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
    "Wiktionary (CC BY-SA 4.0): translation tables of the place words. Wikidata (CC0): item labels and each country's capital (P36)",
};

// The "On signs" words.
const signLabels = await labelsOf(Object.values(ITEMS));
for (const [word, qid] of Object.entries(ITEMS)) out[word] = signLabels[qid];

/**
 * A dictionary's word as a sign writes it: without the marks dictionaries
 * add to help pronounce it. Serbo-Croatian pitch and length on vowels (and
 * syllabic r; consonants keep theirs, ć č š ž), stress on Cyrillic vowels,
 * Arabic vowel marks and Hebrew points.
 */
function plainWord(code, v) {
  let w = v.normalize("NFD");
  if (["sh", "sr", "hr", "bs"].includes(code)) {
    w = w.replace(
      /([aeiourAEIOUR\u0430\u0435\u0438\u043e\u0443\u0440])[\u0300-\u0304\u030f\u0311]+/g,
      "$1",
    );
  }
  w = w
    .replace(/([\u0400-\u04FF])[\u0300\u0301]/g, "$1")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, "");
  return w.normalize("NFC");
}

/**
 * The translations in an entry's translation table on Wiktionary: the first
 * table of the part of speech whose gloss matches, if a gloss is given.
 * @returns {Promise<Record<string, string[]>>} language code → its words, as listed
 */
async function wiktionary(page, pos, gloss) {
  for (const title of [`${page}/translations`, page]) {
    // Wiktionary throttles quick requests; a pause keeps it answering.
    await new Promise((r) => setTimeout(r, 1500));
    const json = await getJson(
      "https://en.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2&redirects=1" +
        `&prop=wikitext&page=${encodeURIComponent(title)}`,
    ).catch((e) => {
      report.push(`${title}: ${e.message}`);
      return null;
    });
    // A missing page (often the /translations one) is an error in the answer.
    if (json?.error && json.error.code !== "missingtitle")
      report.push(`${title}: ${json.error.code}`);
    const wt = json?.parse?.wikitext ?? "";
    // The English entry's section for the part of speech, up to the next one.
    const english = wt.slice(Math.max(0, wt.search(/==\s*English\s*==/)));
    const start = english.search(new RegExp(`===+\\s*${pos}\\s*===+`));
    const section = start < 0 ? english : english.slice(start);
    for (const m of section.matchAll(/\{\{trans-top\|([^}]*)\}\}([\s\S]*?)\{\{trans-bottom\}\}/g)) {
      if (gloss && !gloss.test(m[1])) continue;
      const labels = {};
      for (const t of m[2].matchAll(/\{\{tt?\+?\|([a-z-]{2,12})\|([^|}]+)/g)) {
        let code = t[1];
        // "vár#Hungarian" links to a section; the word is before the #.
        // Korean adds the Chinese characters in brackets: "강(江)".
        const v = plainWord(
          code,
          clean(
            t[2]
              .replace(/\[\[|\]\]/g, "")
              .replace(/#.*$/, "")
              .replace(/\s*\([^)]*\)/g, ""),
          ),
        );
        // Serbo-Croatian lists both scripts under one code.
        if (code === "sh") code = /[\u0400-\u04FF]/.test(v) ? "sr-ec" : "sh";
        if (LANG.test(code) && v) (labels[code] ??= []).includes(v) || labels[code].push(v);
      }
      return labels;
    }
  }
  return {};
}

out.words = {};
const itemLabels = await labelsOf(Object.values(WORDS).flatMap((w) => (w.qid ? [w.qid] : [])));
for (const [en, w] of Object.entries(WORDS)) {
  const candidates = await wiktionary(w.page ?? en, w.pos, w.gloss);
  let fromWikidata = {};
  if (w.qid) {
    const labels = itemLabels[w.qid];
    // "church" is "church building"; the English word must be in the label.
    if ((labels.en ?? "").toLowerCase().split(/\s+/).includes(en)) fromWikidata = labels;
    else report.push(`${en}: ${w.qid} is "${labels.en ?? "?"}" in English; its labels not used`);
  }
  // Wiktionary may list several words, the first not always the usual one
  // (Serbian "brv" before "most" for bridge); the one Wikidata also gives
  // is taken where there is one, the first otherwise.
  const fromWiktionary = {};
  for (const [code, words] of Object.entries(candidates)) {
    const label = (fromWikidata[code] ?? "").toLowerCase();
    fromWiktionary[code] = words.find((x) => x.toLowerCase() === label) ?? words[0];
  }
  const n = Object.keys(fromWiktionary).length;
  if (n < 20) report.push(`${en}: ${n} translations on Wiktionary`);
  if (n + Object.keys(fromWikidata).length < 20) {
    report.push(`${en}: left out`);
    continue;
  }
  out.words[en] = {
    source: [n ? `wiktionary:${(w.page ?? en).replaceAll(" ", "_")}` : "", w.qid ?? ""]
      .filter(Boolean)
      .join(" "),
    wiktionary: fromWiktionary,
    wikidata: fromWikidata,
  };
  await new Promise((r) => setTimeout(r, 300));
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
