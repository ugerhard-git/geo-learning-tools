// Builds src/data/quick-facts.json: each country's and territory's internet
// domain and phone code, from Wikidata (CC0), and currency, from CLDR. They show up on
// signs, shopfronts and adverts, and the Countries and Territories app shows
// and drills them.
//
// For every place in src/data/countries.txt, found on Wikidata by its ISO
// code (P297): its country-code top-level domain (P78), its country calling
// code (P474), leaving out values Wikidata marks as ended (P582); and from
// Unicode CLDR (Unicode License v3), the currencies it uses now, with their
// English names and symbols.
//
// Wikidata cannot be reached from every machine, so this normally runs on
// GitHub: see .github/workflows/quick-facts.yml.
//
//   mkdir -p /tmp/cldr && cd /tmp/cldr
//   for p in cldr-core cldr-numbers-full; do
//     npm pack $p@48.2.0 && mkdir $p && tar xzf $p-48.2.0.tgz -C $p --strip-components 1
//   done
//   node tools/data/quick-facts.mjs /tmp/cldr

import { readFile, writeFile } from "node:fs/promises";
import { parseCountries } from "../../src/shared/countries.js";

const ROOT = new URL("../../", import.meta.url);
const places = parseCountries(await readFile(new URL("src/data/countries.txt", ROOT), "utf8"));
const codes = places.map((p) => p.code).filter((c) => /^[A-Z]{2}$/.test(c));

const HEADERS = {
  "User-Agent":
    "geo-learning-tools quick facts builder (https://github.com/ugerhard-git/geo-learning-tools)",
  Accept: "application/sparql-results+json",
};

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return (await res.json()).results?.bindings ?? [];
    if (![429, 500, 502, 503].includes(res.status) || attempt === 5) {
      throw new Error(`Wikidata answered ${res.status}`);
    }
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
  }
}

const values = `VALUES ?iso { ${codes.map((c) => `"${c}"`).join(" ")} }`;
const current = (p) => `?c p:${p} ?st. ?st ps:${p} ?v. FILTER NOT EXISTS { ?st pq:P582 ?end }`;
/** Keep a short, plain string. */
const text = (v, max = 60) => (typeof v === "string" && v.trim().length <= max ? v.trim() : "");

const out = {};
const add = (iso, key, value) => {
  if (!value) return;
  const list = ((out[iso] ??= { tld: [], phone: [], currency: [] })[key] ??= []);
  if (!list.some((x) => JSON.stringify(x) === JSON.stringify(value))) list.push(value);
};

for (const b of await sparql(`SELECT ?iso ?name WHERE { ${values} ?c wdt:P297 ?iso.
    ${current("P78")} ?v rdfs:label ?name. FILTER(LANG(?name) = "en") }`)) {
  const tld = text(b.name?.value, 30).toLowerCase();
  const iso = b.iso.value;
  // A place's own country-code domain, as IANA assigns them: its ISO code,
  // except the United Kingdom's ".uk". Wikidata also lists domains a place
  // uses or once used (France's ".re", the EU's ".eu", ".su"), which belong
  // to somewhere else.
  const own = iso === "GB" ? ".uk" : `.${iso.toLowerCase()}`;
  if (tld === own) add(iso, "tld", tld);
}

for (const b of await sparql(
  `SELECT ?iso ?v WHERE { ${values} ?c wdt:P297 ?iso. ${current("P474")} }`,
)) {
  const phone = text(b.v?.value, 20).replace(/\s+/g, " ");
  if (/^\+\d{1,4}( \d{1,4})?$/.test(phone)) add(b.iso.value, "phone", phone);
}

// Currencies from CLDR: those each place uses now (no end date, legal tender),
// with the English name and the narrow symbol.
const cldr = process.argv[2];
if (!cldr) throw new Error("Give the folder CLDR is unpacked in (see the header).");
const readJson = async (...parts) => JSON.parse(await readFile([cldr, ...parts].join("/"), "utf8"));
const regions = (await readJson("cldr-core", "supplemental", "currencyData.json")).supplemental
  .currencyData.region;
const names = (await readJson("cldr-numbers-full", "main", "en", "currencies.json")).main.en.numbers
  .currencies;
for (const c of codes) {
  for (const entry of regions[c] ?? []) {
    for (const [code, when] of Object.entries(entry)) {
      if (when._to || when._tender === "false" || !/^[A-Z]{3}$/.test(code)) continue;
      const n = names[code] ?? {};
      const name = text(n["displayName-count-one"] ?? n.displayName);
      const symbol = text(n["symbol-alt-narrow"] ?? "", 6);
      if (name)
        add(c, "currency", symbol && symbol !== code ? { code, name, symbol } : { code, name });
    }
  }
}

const facts = {};
const report = [];
for (const c of codes) {
  const f = out[c];
  if (!f) {
    report.push(`${c}: nothing on Wikidata`);
    continue;
  }
  for (const k of ["tld", "phone", "currency"])
    f[k].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  facts[c] = f;
}
const count = (k) => Object.values(facts).filter((f) => f[k].length).length;
console.log(
  [
    ...report,
    `${Object.keys(facts).length} places: ${count("tld")} with a domain, ${count("phone")} with a phone code, ${count("currency")} with a currency.`,
  ].join("\n"),
);
if (count("tld") < 200 || count("phone") < 200 || count("currency") < 200) {
  console.error("Too few facts; not writing the file.");
  process.exit(1);
}
if (process.env.GITHUB_ACTIONS) {
  console.log(
    `::notice title=Quick facts::${count("tld")} domains, ${count("phone")} phone codes, ${count("currency")} currencies.${report.length ? `%0A${report.join("%0A")}` : ""}`,
  );
}
await writeFile(
  new URL("src/data/quick-facts.json", ROOT),
  JSON.stringify({
    source:
      "Wikidata (CC0): P78 top-level domain, P474 country calling code, P38 currency with P498 ISO 4217 code",
    facts,
  }) + "\n",
);
