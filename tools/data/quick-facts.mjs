// Builds src/data/quick-facts.json: each country's and territory's internet
// domain, phone code and currency, from Wikidata (CC0). They show up on
// signs, shopfronts and adverts, and the Countries and Territories app shows
// and drills them.
//
// For every place in src/data/countries.txt, found on Wikidata by its ISO
// code (P297): its country-code top-level domain (P78), its country calling
// code (P474) and its currency (P38) with its ISO 4217 code (P498), leaving
// out values Wikidata marks as ended (P582).
//
// Wikidata cannot be reached from every machine, so this normally runs on
// GitHub: see .github/workflows/quick-facts.yml.
//
//   node tools/data/quick-facts.mjs

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
  // Country-code domains in Latin letters: ".pl", ".uk".
  if (/^\.[a-z]{2}$/.test(tld)) add(b.iso.value, "tld", tld);
}

for (const b of await sparql(
  `SELECT ?iso ?v WHERE { ${values} ?c wdt:P297 ?iso. ${current("P474")} }`,
)) {
  const phone = text(b.v?.value, 20).replace(/\s+/g, " ");
  if (/^\+\d{1,4}( \d{1,4})?$/.test(phone)) add(b.iso.value, "phone", phone);
}

for (const b of await sparql(`SELECT ?iso ?code ?name WHERE { ${values} ?c wdt:P297 ?iso.
    ${current("P38")} ?v wdt:P498 ?code; rdfs:label ?name. FILTER(LANG(?name) = "en") }`)) {
  const code = text(b.code?.value, 3);
  const name = text(b.name?.value);
  if (/^[A-Z]{3}$/.test(code) && name) add(b.iso.value, "currency", { code, name });
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
if (count("tld") < 200 || count("phone") < 200 || count("currency") < 180) {
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
