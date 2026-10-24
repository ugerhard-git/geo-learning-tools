// Builds src/data/languages.json, the data of the Scripts and Languages app:
// the official languages of the countries with Street View coverage, the
// script each is written in, the letters that give each away, and real text
// to recognise them by.
//
// Everything comes from published, openly licensed data:
//
//   - Unicode CLDR (Unicode License v3): which languages are official where
//     (territoryInfo), each language's script (likelySubtags), the letters it
//     uses (exemplar characters), its month names, and the names
//     of languages, scripts and countries in English and in the language
//     itself.
//   - The Universal Declaration of Human Rights in Unicode, as packaged by
//     the udhr npm package (MIT): the first sentence of Article 1 in each
//     language, a real sentence to show as a specimen.
//   - Wikidata (CC0): the words for "street", "road" and "city", the words
//     of place names and directions ("north", "river", "new"…), the
//     capitals' names, from tools/data/sign-words.json (made by
//     tools/data/sign-words.mjs). They are left out if that file is missing.
//   - Wikipedia (CC BY-SA): where each regional or minority language is
//     official or seen on signs, written by hand into REGIONS below, and
//     which of CLDR's regional languages are official nationwide (NATIONAL).
//
// A country's languages are those CLDR marks official there, those in
// NATIONAL, and the regional and minority languages in REGIONS.
//
// It reads the packages from a folder, as npm unpacks them, rather than
// depending on them: they are needed only when the data is rebuilt.
//
//   mkdir -p /tmp/lang && cd /tmp/lang
//   for p in cldr-core cldr-misc-full cldr-dates-full cldr-localenames-full; do
//     npm pack $p@48.2.0 && mkdir $p && tar xzf $p-48.2.0.tgz -C $p --strip-components 1
//   done
//   npm pack udhr@6.0.0 && mkdir udhr && tar xzf udhr-6.0.0.tgz -C udhr --strip-components 1
//   node tools/data/languages.mjs /tmp/lang
//
// It prints a report of every language, for checking by eye, and writes the
// file.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseUnicodeSet } from "./unicode-set.mjs";
import { readStreetView } from "./street-view.mjs";

/**
 * Official languages left out, with the reason. Each is official somewhere
 * on the list but rarely or never seen on signs there.
 */
const LEFT_OUT = {
  gsw: "Swiss German is spoken, but signs in Switzerland are in Standard German",
  "es-419": "a CLDR grouping of Latin American Spanish, not a language of its own",
  no: "the same as Norwegian Bokmål (nb), which is kept",
  "bs-Cyrl": "Bosnian is written in Latin letters on signs; Cyrillic signs there are Serbian",
  yue: "signs in Macau and Hong Kong are in written Chinese, kept as Traditional Chinese",
  mai: "written in Devanagari like Hindi, and with too few words of its own on Wikidata to tell it by",
};

/** Wikipedia's articles the hand-written REGIONS and NATIONAL come from. */
const wiki = (title) => ({
  title,
  url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`,
});
const SOURCES = {
  india: wiki("Languages with official recognition in India"),
  spain: wiki("Languages of Spain"),
  galician: wiki("Galician language"),
  asturian: wiki("Asturian language"),
  basque: wiki("Basque language"),
  breton: wiki("Breton language"),
  corsican: wiki("Corsican language"),
  occitan: wiki("Occitan language"),
  welsh: wiki("Welsh language"),
  signs: wiki("Bilingual sign"),
  frisian: wiki("West Frisian language"),
  romansh: wiki("Romansh language"),
  sami: wiki("Northern Sámi"),
  sorbian: wiki("Upper Sorbian language"),
  tatar: wiki("Tatar language"),
  bashkir: wiki("Bashkir language"),
  italy: wiki("Languages of Italy"),
  austria: wiki("Languages of Austria"),
  croatia: wiki("Italian language in Croatia"),
  hungarian: wiki("Hungarian language"),
  slovakia: wiki("Hungarians in Slovakia"),
  romania: wiki("Hungarians in Romania"),
  southAfrica: wiki("Languages of South Africa"),
  macedonia: wiki("Languages of North Macedonia"),
};

/**
 * Languages official in all of a country that CLDR marks official only in
 * part of it ("official_regional"): South Africa's eleven languages are all
 * official under its constitution, and Albanian has been official across
 * North Macedonia since 2019.
 */
const NATIONAL = {
  ZA: {
    source: "southAfrica",
    languages: ["af", "nr", "nso", "ss", "st", "tn", "ts", "ve", "xh", "zu"],
  },
  MK: { source: "macedonia", languages: ["sq"] },
};

/**
 * Languages seen on signs in only part of a country, and where: the regions
 * that make it an official language (official), an additional one
 * (additional), those where it is on signs (signs), and those where it is
 * spoken without official status (spoken). Written by hand from the
 * Wikipedia article each names (read October 2026), in the article's terms;
 * CLDR's "official_regional" marks too few of them, and Wikidata's
 * statements of regions' official languages (P37) cover only some regions.
 * Each is a clue to where in the country you are.
 */
const REGIONS = {
  IN: {
    as: { official: ["Assam"], source: "india" },
    bn: {
      official: ["Tripura", "West Bengal"],
      additional: ["Assam", "Jharkhand"],
      source: "india",
    },
    gu: { official: ["Dadra and Nagar Haveli and Daman and Diu", "Gujarat"], source: "india" },
    kn: { official: ["Karnataka"], source: "india" },
    ml: { official: ["Kerala", "Puducherry"], additional: ["Lakshadweep"], source: "india" },
    mr: { official: ["Maharashtra"], additional: ["Goa"], source: "india" },
    or: { official: ["Odisha"], additional: ["Jharkhand", "West Bengal"], source: "india" },
    pa: { official: ["Delhi", "Punjab"], additional: ["Haryana", "West Bengal"], source: "india" },
    ta: { official: ["Puducherry", "Tamil Nadu"], source: "india" },
    te: {
      official: ["Andhra Pradesh", "Puducherry", "Telangana"],
      additional: ["West Bengal"],
      source: "india",
    },
    ur: {
      official: ["Delhi", "Jammu and Kashmir", "Ladakh"],
      additional: [
        "Andhra Pradesh",
        "Bihar",
        "Jharkhand",
        "Telangana",
        "Uttar Pradesh",
        "West Bengal",
      ],
      source: "india",
    },
  },
  ES: {
    ca: {
      official: ["Catalonia", "the Balearic Islands", "the Valencian Community (as Valencian)"],
      source: "spain",
    },
    eu: {
      official: ["the Basque Country", "the Basque-speaking north of Navarre"],
      source: "spain",
    },
    gl: { official: ["Galicia"], source: "galician" },
    oc: {
      official: ["Catalonia, where it is spoken in the Val d'Aran (as Aranese)"],
      source: "spain",
    },
    ast: {
      spoken: ["Asturias, where it is protected and many places have official Asturian names"],
      source: "asturian",
    },
  },
  FR: {
    br: {
      signs: ["Breton towns, in street names"],
      spoken: ["Lower Brittany, above all Finistère, Morbihan and Côtes-d'Armor"],
      source: "breton",
    },
    eu: { spoken: ["the French Basque Country"], source: "basque" },
    co: { spoken: ["Corsica"], source: "corsican" },
    oc: {
      signs: ["a few towns, such as Toulouse"],
      spoken: ["much of southern France"],
      source: "occitan",
    },
  },
  GB: {
    cy: { official: ["Wales, where road signs are in Welsh and English"], source: "welsh" },
    gd: { signs: ["the north-west of Scotland, its islands and main routes"], source: "signs" },
  },
  NL: { fy: { official: ["Friesland (Fryslân)"], source: "frisian" } },
  CH: { rm: { official: ["Graubünden, beside German and Italian"], source: "romansh" } },
  NO: {
    se: {
      official: ["Troms and Finnmark", "Kautokeino, Karasjok and six other municipalities"],
      source: "sami",
    },
  },
  FI: { se: { official: ["Enontekiö", "Inari", "Sodankylä", "Utsjoki"], source: "sami" } },
  DE: {
    hsb: {
      official: ["the Sorbian core area around Crostwitz"],
      signs: ["the Sorbian settlement area of Upper Lusatia, in Saxony"],
      source: "sorbian",
    },
  },
  RU: {
    tt: { official: ["Tatarstan"], source: "tatar" },
    ba: { official: ["Bashkortostan"], source: "bashkir" },
  },
  IT: {
    de: { signs: ["South Tyrol, where every road sign is in German and Italian"], source: "signs" },
    fr: { official: ["the Aosta Valley"], source: "italy" },
    sl: {
      signs: ["smaller villages in the provinces of Trieste, Gorizia and Udine"],
      source: "signs",
    },
  },
  AT: {
    sl: { official: ["the mixed-language districts of Carinthia"], source: "austria" },
    hr: { official: ["some districts of Burgenland"], source: "austria" },
    hu: { official: ["some districts of Burgenland"], source: "austria" },
  },
  HR: {
    it: {
      official: ["Istria County, and nineteen of its towns, such as Pula, Rovinj and Umag"],
      source: "croatia",
    },
  },
  SI: {
    it: {
      official: ["parts of Slovenian Istria, where road signs are bilingual"],
      source: "signs",
    },
    hu: { official: ["Hodoš, Dobrovnik and Lendava, in Prekmurje"], source: "hungarian" },
  },
  RS: { hu: { official: ["Vojvodina"], source: "hungarian" } },
  SK: {
    hu: {
      official: ["municipalities of southern Slovakia where at least 15% speak it"],
      source: "slovakia",
    },
  },
  RO: {
    hu: {
      official: ["localities over 20% Hungarian, as in Harghita and Covasna"],
      signs: ["those localities, on their name signs"],
      source: "romania",
    },
  },
};

/**
 * The name the app gives each script. CLDR's English names are mostly right,
 * but some are names of a writing system's variant ("Simplified") or of a
 * language rather than its script.
 */
const SCRIPT_NAMES = {
  Hans: "Simplified Chinese characters",
  Hant: "Traditional Chinese characters",
  Jpan: "Japanese (kana and kanji)",
  Kore: "Hangul (Korean)",
  // Bengali and Assamese share it.
  Beng: "Bengali–Assamese",
};

/** The UDHR translation for each language (udhr package file names). */
const UDHR = {
  af: "afr",
  am: "amh",
  ar: "arb",
  az: "azj",
  be: "bel",
  bg: "bul",
  bn: "ben",
  ast: "ast",
  br: "bre",
  co: "cos",
  eu: "eus",
  fy: "fri",
  gd: "gla",
  gl: "glg",
  hsb: "hsb",
  // Occitan: Languedocien, the variety of Toulouse.
  oc: "lnc",
  se: "sme",
  tt: "tat",
  gu: "guj",
  kn: "kan",
  ml: "mal",
  mr: "mar",
  pa: "pan",
  te: "tel",
  bs: "bos_latn",
  ca: "cat",
  cs: "ces",
  cy: "cym",
  da: "dan",
  de: "deu_1996",
  dz: "dzo",
  el: "ell_monotonic",
  en: "eng",
  es: "spa",
  et: "est",
  fa: "pes",
  fi: "fin",
  fil: "tgl",
  fo: "fao",
  fr: "fra",
  ga: "gle",
  he: "heb",
  hi: "hin",
  hr: "hrv",
  hu: "hun",
  hy: "hye",
  id: "ind",
  is: "isl",
  it: "ita",
  ja: "jpn",
  ka: "kat",
  kk: "kaz",
  kl: "kal",
  km: "khm",
  ko: "kor",
  ky: "kir",
  lb: "ltz",
  lo: "lao",
  lt: "lit",
  lv: "lav",
  mk: "mkd",
  mn: "khk",
  ms: "mly_latn",
  mt: "mlt",
  nb: "nob",
  ne: "nep",
  nl: "nld",
  nn: "nno",
  pl: "pol",
  pt: "por_PT",
  rm: "roh",
  ro: "ron_2006",
  ru: "rus",
  rw: "kin",
  si: "sin",
  sk: "slk",
  sl: "slv",
  sq: "als",
  sr: "srp_cyrl",
  "sr-Latn": "srp_latn",
  ss: "ssw",
  st: "sot",
  sv: "swe",
  sw: "swh",
  ta: "tam",
  th: "tha",
  tn: "tsn",
  tr: "tur",
  uk: "ukr",
  ur: "urd",
  uz: "uzn",
  vi: "vie",
  xh: "xho",
  zu: "zul",
  "zh-Hans": "cmn_hans",
  "zh-Hant": "cmn_hant",
  ve: "ven",
  ts: "tso_MZ",
  nr: "nbl",
  nso: "nso",
  ha: "hau",
  yo: "yor",
  ig: "ibo",
  wo: "wol",
  lg: "lug",
  ch: "cha",
  sm: "smo",
  mi: "mri",
  pap: "pap",
  qu: "quz",
  ay: "ayr",
  gn: "gug",
  gv: "glv",
  ny: "nya",
};

/**
 * Wikidata's language codes for each language whose code differs from
 * CLDR's, tried in order.
 */
const WIKIDATA_CODES = {
  "sr-Latn": ["sr-el", "sh"],
  sr: ["sr-ec", "sr"],
  "zh-Hans": ["zh-hans", "zh-cn", "zh"],
  "zh-Hant": ["zh-hant", "zh-tw", "zh-hk"],
  fil: ["tl", "fil"],
  nb: ["nb", "no"],
};

/**
 * Where Wikidata's label is not the word on signs. Each is the word street
 * names and town signs use, as Wikipedia's articles on those countries'
 * street names show.
 */
const SIGN_WORD_FIXES = {
  // The label is "Innerortsstraße", the legal term; signs say "…straße".
  de: { street: "Straße" },
  // The label is "strada urbana"; Italian street names start "Via".
  it: { street: "via" },
  // The label is "nama jalan" (street name); signs say "Jalan" (Jl.).
  id: { street: "jalan" },
  // The label is "lielpilsēta", a large city; the word is "pilsēta".
  lv: { city: "pilsēta" },
  // Bosnian has no label for "street" and its word for "road" is "put";
  // street signs say "ulica", as in Croatian and Serbian.
  bs: { street: "ulica" },
};

/** A letter used by more than this many of the languages gives nothing away. */
const TELLTALE_MAX = 4;
/** Each language keeps at most this many telltale letters. */
const TELLTALE_PER_LANGUAGE = 6;

const STREET_VIEW = await readStreetView();
const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node tools/data/languages.mjs <folder with the unpacked packages>");
  process.exit(1);
}

/** A file of an unpacked package, with or without npm's "package/" folder. */
function pkgFile(pkg, ...path) {
  const plain = join(dir, pkg, ...path);
  return existsSync(plain) ? plain : join(dir, pkg, "package", ...path);
}
const json = async (pkg, ...path) => JSON.parse(await readFile(pkgFile(pkg, ...path), "utf8"));
const optionalJson = (pkg, ...path) => json(pkg, ...path).catch(() => null);
/** CLDR's per-locale files hold one locale under main; this returns its contents. */
const inner = (data) => (data ? Object.values(data.main)[0] : null);

const territoryInfo = (await json("cldr-core", "supplemental", "territoryInfo.json")).supplemental
  .territoryInfo;
const likely = (await json("cldr-core", "supplemental", "likelySubtags.json")).supplemental
  .likelySubtags;
const english = {
  languages: inner(await json("cldr-localenames-full", "main", "en", "languages.json"))
    .localeDisplayNames.languages,
  scripts: inner(await json("cldr-localenames-full", "main", "en", "scripts.json"))
    .localeDisplayNames.scripts,
};

/** English weekday and month names, to spot CLDR's fallbacks. */
const enCalendar = inner(await json("cldr-dates-full", "main", "en", "ca-gregorian.json")).dates
  .calendars.gregorian;
const ENGLISH_WORDS = new Set(
  ["days", "months"].flatMap((k) =>
    ["wide", "abbreviated"].flatMap((w) =>
      ["format", "stand-alone"].flatMap((f) =>
        Object.values(enCalendar[k][f][w]).map((v) => v.toLowerCase()),
      ),
    ),
  ),
);

/** Words for "street" and "city" in every language Wikidata has, or none. */
const signWords = JSON.parse(
  await readFile(new URL("sign-words.json", import.meta.url), "utf8").catch(() => "{}"),
);
/** A label in a language, from Wikidata's labels by language code. */
function labelIn(id, labels = {}) {
  const code = (WIKIDATA_CODES[id] ?? [id.toLowerCase()]).find((c) => labels[c]);
  return code ? labels[code] : "";
}
/** A language's word for "street", "road" or "city", from Wikidata's labels. */
const signWord = (id, word) => labelIn(id, signWords[word]);

/**
 * A language's words of place names and directions, with their English, as
 * [english, word] pairs; English itself has none to learn.
 */
function placeWords(id) {
  if (id.split("-")[0] === "en") return [];
  return (
    Object.entries(signWords.words ?? {})
      // Wiktionary has the plain word ("Kirche"); a Wikidata label can be the
      // name of the concept ("Kirchengebäude"), so it only fills gaps.
      .map(([en, w]) => [en, labelIn(id, w.wiktionary) || labelIn(id, w.wikidata)])
      .filter(([, w]) => w)
  );
}

/** The capitals of these countries, as the language writes them. */
function capitalsIn(id, countries) {
  return countries.flatMap((c) =>
    (signWords.capitals?.[c] ?? []).map((cap) => labelIn(id, cap.labels)).filter(Boolean),
  );
}

/* ------------------------------------------------------------ which languages */

/** locale → the Street View countries where it is official */
const officialIn = new Map();
/** locale → the countries of those where it is a regional language (see REGIONS) */
const regionalIn = new Map();
const add = (map, locale, country) => {
  if (!map.get(locale)?.includes(country)) map.set(locale, [...(map.get(locale) ?? []), country]);
};
for (const country of STREET_VIEW) {
  const pops = territoryInfo[country]?.languagePopulation ?? {};
  for (const [key, p] of Object.entries(pops)) {
    if (!["official", "de_facto_official"].includes(p._officialStatus)) continue;
    const locale = key.replace(/_/g, "-");
    if (!LEFT_OUT[locale]) add(officialIn, locale, country);
  }
  for (const locale of NATIONAL[country]?.languages ?? []) add(officialIn, locale, country);
  for (const locale of Object.keys(REGIONS[country] ?? {})) {
    // Official nationwide already: not regional there.
    if (officialIn.get(locale)?.includes(country)) continue;
    add(officialIn, locale, country);
    add(regionalIn, locale, country);
  }
}

/** Where a language is regional, by country, with the article it comes from. */
function regionsOf(id, countries) {
  const out = {};
  for (const c of countries) {
    const { source, ...where } = REGIONS[c][id];
    out[c] = { ...where, source: SOURCES[source] };
  }
  return out;
}

/** The article saying a language is official nationwide, where CLDR does not. */
function nationalOf(id, countries) {
  const out = {};
  for (const c of countries) {
    if (NATIONAL[c]?.languages.includes(id)) out[c] = SOURCES[NATIONAL[c].source];
  }
  return out;
}

/** The script a locale is written in: its own subtag, or CLDR's likely one. */
function scriptOf(locale) {
  const own = locale.split("-").find((p) => /^[A-Z][a-z]{3}$/.test(p));
  if (own) return own;
  const full = likely[locale] ?? likely[locale.split("-")[0]] ?? "";
  return full.split("-").find((p) => /^[A-Z][a-z]{3}$/.test(p)) ?? "";
}

/**
 * CLDR keeps Chinese as zh (Simplified) and zh-Hant; Taiwan, Hong Kong and
 * Macau list plain "zh" as official, but write Traditional characters.
 */
function localeFor(locale, countries) {
  if (locale === "zh") {
    const hant = countries.filter((c) => ["TW", "HK", "MO"].includes(c));
    return hant.length === countries.length ? "zh-Hant" : "zh-Hans";
  }
  return locale;
}

/* ------------------------------------------------------------ each language */

const languages = [];
const report = [];
const merged = new Map();
for (const [locale, countries] of officialIn) {
  const id = localeFor(locale, countries);
  merged.set(id, [...new Set([...(merged.get(id) ?? []), ...countries])]);
}
// Chinese in Singapore is Simplified; Taiwan, Hong Kong and Macau write Traditional.
if (merged.has("zh-Hant") && merged.get("zh-Hans")) {
  const hans = merged.get("zh-Hans").filter((c) => !["TW", "HK", "MO"].includes(c));
  const hant = [
    ...merged.get("zh-Hant"),
    ...merged.get("zh-Hans").filter((c) => ["TW", "HK", "MO"].includes(c)),
  ];
  merged.set("zh-Hans", hans);
  merged.set("zh-Hant", [...new Set(hant)]);
}

for (const [id, countries] of [...merged].sort()) {
  if (!countries.length) continue;
  const chars = inner(await optionalJson("cldr-misc-full", "main", id, "characters.json"));
  if (!chars?.characters?.exemplarCharacters) {
    report.push(`${id}: left out, CLDR has no letters for it`);
    continue;
  }
  const script = scriptOf(id);
  const base = id.split("-")[0];
  const ownNames = inner(await optionalJson("cldr-localenames-full", "main", id, "languages.json"));
  const ownTerritories = inner(
    await optionalJson("cldr-localenames-full", "main", id, "territories.json"),
  );
  const calendar = inner(await optionalJson("cldr-dates-full", "main", id, "ca-gregorian.json"));

  const name =
    english.languages[id] ??
    `${english.languages[base]} (${english.scripts[`${script}-alt-stand-alone`] ?? english.scripts[script]})`;
  const autonym = ownNames?.localeDisplayNames?.languages?.[base] ?? "";

  // Letters, as the language writes them in lower case.
  const letters = parseUnicodeSet(chars.characters.exemplarCharacters)
    .map((l) => l.toLocaleLowerCase(id))
    .filter((l) => [...l].length === 1);

  // Words seen on signs and billboards: those of place names and directions,
  // the capitals, the language's own name and its names for its countries,
  // and the months (dates on posters).
  const greg = calendar?.dates?.calendars?.gregorian;
  const place = placeWords(id);
  const capitals = [...new Set(capitalsIn(id, countries))];
  const words = [
    ...place.map(([, w]) => w),
    ...capitals,
    ...Object.values(greg?.months?.["stand-alone"]?.wide ?? {}),
    autonym,
    ...countries.map((c) => ownTerritories?.localeDisplayNames?.territories?.[c]),
  ]
    .filter((w) => typeof w === "string" && w.length > 1 && w.length <= 40)
    // Where CLDR has no names of its own for a language it falls back to
    // English ones ("Sun", "Mon"), which would give nothing away.
    .filter((w) => base === "en" || !ENGLISH_WORDS.has(w.toLowerCase()))
    // CLDR's placeholders for names it lacks ("M01").
    .filter((w) => !/\d/.test(w));

  const sentence = await udhrSentence(UDHR[id] ?? UDHR[base]);
  const regional = (regionalIn.get(id) ?? []).filter((c) => countries.includes(c)).sort();
  // A language needs a sentence or a few words to be recognised by.
  if (!sentence && words.length < 3) {
    report.push(`${id}: left out, no sentence and too few words`);
    continue;
  }
  languages.push({
    id,
    name,
    autonym,
    script,
    countries: countries.sort(),
    letters: [...new Set(letters)].join(""),
    street: SIGN_WORD_FIXES[id]?.street ?? (signWord(id, "street") || signWord(id, "road")),
    road: SIGN_WORD_FIXES[id]?.road ?? signWord(id, "road"),
    city: SIGN_WORD_FIXES[id]?.city ?? signWord(id, "city"),
    placeWords: place,
    capitals,
    words: [...new Set(words)],
    sentence,
    ...(regional.length ? { regional, regions: regionsOf(id, regional) } : {}),
    ...(Object.keys(nationalOf(id, countries)).length
      ? { national: nationalOf(id, countries) }
      : {}),
  });
}

// A word several languages share ("domingo") cannot tell them apart.
const wordCount = new Map();
for (const lang of languages) {
  for (const w of lang.words)
    wordCount.set(w.toLowerCase(), (wordCount.get(w.toLowerCase()) ?? 0) + 1);
}
for (const lang of languages)
  lang.words = lang.words.filter((w) => wordCount.get(w.toLowerCase()) === 1);
// Without a sentence, a language is recognised by its words alone.
for (const lang of languages.filter((l) => !l.sentence && l.words.length < 3)) {
  report.push(`${lang.id}: left out, no sentence and too few words of its own`);
  languages.splice(languages.indexOf(lang), 1);
}

/* ------------------------------------------------------ telltale letters */

// Only alphabets: in syllabaries and ideographs every character is
// distinctive, and the script itself is the giveaway (see the script drill).
const ALPHABETS = new Set(["Latn", "Cyrl"]);
const BASIC = new Set("abcdefghijklmnopqrstuvwxyz");
/** letter → ids of the languages that use it */
const usedBy = new Map();
for (const lang of languages) {
  if (!ALPHABETS.has(lang.script)) continue;
  for (const l of lang.letters) {
    // Letters only; modifier letters such as ʼ are punctuation to a reader.
    if (BASIC.has(l) || !/\p{L}/u.test(l) || /\p{Lm}/u.test(l)) continue;
    if (!usedBy.has(l)) usedBy.set(l, []);
    usedBy.get(l).push(lang.id);
  }
}
const candidates = [...usedBy].filter(([, ids]) => ids.length <= TELLTALE_MAX);
// Vietnamese alone has some fifty letters with tone marks, which would
// crowd out every other language. Each language keeps its most telling
// letters: the rarest first, then those with the fewest marks.
const marks = (l) => l.normalize("NFD").length;
const rank = (a, b) =>
  usedBy.get(a).length - usedBy.get(b).length || marks(a) - marks(b) || a.localeCompare(b);
const kept = new Set();
for (const lang of languages) {
  const mine = candidates.map(([l]) => l).filter((l) => usedBy.get(l).includes(lang.id));
  for (const l of mine.sort(rank).slice(0, TELLTALE_PER_LANGUAGE)) kept.add(l);
}
const telltales = candidates
  .filter(([l]) => kept.has(l))
  .map(([letter, ids]) => ({ letter, languages: ids }))
  .sort((a, b) => a.letter.localeCompare(b.letter));

/* --------------------------------------------------------------- scripts */

const scripts = {};
for (const lang of languages) {
  scripts[lang.script] ??=
    SCRIPT_NAMES[lang.script] ??
    english.scripts[`${lang.script}-alt-stand-alone`] ??
    english.scripts[lang.script] ??
    lang.script;
}

/* ---------------------------------------------------------------- output */

for (const l of languages) {
  report.push(
    `${l.id.padEnd(8)} ${l.name} (${l.autonym}) · ${scripts[l.script]} · ${l.countries.join(" ")}` +
      `\n         ${l.words.length} words, e.g. ${l.words.slice(0, 3).join(", ")}` +
      `\n         street: ${l.street || "-"} · road: ${l.road || "-"} · city: ${l.city || "-"}` +
      `\n         capitals: ${l.capitals.join(", ") || "-"} · ${l.placeWords.length} place words, e.g. ${l.placeWords
        .slice(0, 4)
        .map(([en, w]) => `${w} (${en})`)
        .join(", ")}` +
      (l.regional
        ? Object.entries(l.regions)
            .map(
              ([c, r]) =>
                `\n         ${c}: ` +
                ["official", "additional", "signs", "spoken"]
                  .filter((k) => r[k])
                  .map((k) => `${k} ${r[k].join("; ")}`)
                  .join(" | "),
            )
            .join("")
        : "") +
      (l.national
        ? `\n         official nationwide in ${Object.keys(l.national).join(", ")}`
        : "") +
      `\n         ${l.sentence ? l.sentence.slice(0, 90) : "NO SENTENCE"}`,
  );
}
report.push(
  `\nTelltale letters (${telltales.length}): ` +
    telltales.map((t) => `${t.letter} ${t.languages.join("/")}`).join("  "),
);
console.log(report.join("\n"));
console.log(
  `\n${languages.length} languages, ${Object.keys(scripts).length} scripts, ${telltales.length} telltale letters.`,
);

const out = new URL("../../src/data/languages.json", import.meta.url);
await writeFile(
  out,
  JSON.stringify({
    cldr: "48.2.0",
    udhr: "6.0.0",
    scripts,
    languages,
    telltales,
  }) + "\n",
);
console.log(`Wrote ${out.pathname}`);

/**
 * The first sentence of Article 1 of the Universal Declaration of Human
 * Rights in one translation, as plain text.
 * @param {string | undefined} code udhr package file name
 */
async function udhrSentence(code) {
  if (!code) return "";
  const html = await readFile(pkgFile("udhr", "declaration", `${code}.html`), "utf8").catch(
    () => "",
  );
  // Article 1 is the first paragraph of the first article.
  const p = html.match(/<article[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1];
  if (!p) return "";
  const text = p
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
      const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (named[e.toLowerCase()]) return named[e.toLowerCase()];
      return String.fromCodePoint(
        e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
      );
    })
    .replace(/\s+/g, " ")
    .trim();
  const cut = text.search(/[.!?。！？۔।።](\s|$)/);
  return (cut > 15 ? text.slice(0, cut + 1) : text).slice(0, 220);
}
