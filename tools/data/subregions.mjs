// Builds src/data/subregions.json: the UN M49 sub-region of every country
// and territory in src/data/countries.txt ("Southern Europe", "Caribbean"…),
// as Unicode CLDR records it (territoryContainment, Unicode License v3), with
// the sub-regions' English names. The Roads drill offers them as a filter.
//
// It reads the CLDR packages from a folder, as the languages script does:
//
//   mkdir -p /tmp/cldr && cd /tmp/cldr
//   for p in cldr-core cldr-localenames-full; do
//     npm pack $p@48.2.0 && mkdir $p && tar xzf $p-48.2.0.tgz -C $p --strip-components 1
//   done
//   node tools/data/subregions.mjs /tmp/cldr

import { readFile, writeFile } from "node:fs/promises";
import { parseCountries } from "../../src/shared/countries.js";

const cldr = process.argv[2];
if (!cldr) throw new Error("Give the folder CLDR is unpacked in (see the header).");
const json = async (...p) => JSON.parse(await readFile([cldr, ...p].join("/"), "utf8"));
const contain = (await json("cldr-core", "supplemental", "territoryContainment.json")).supplemental
  .territoryContainment;
const names = (await json("cldr-localenames-full", "main", "en", "territories.json")).main.en
  .localeDisplayNames.territories;

// The smallest regions: numeric codes that contain countries, not other regions.
const leaves = Object.entries(contain).filter(
  ([k, v]) =>
    /^\d{3}$/.test(k) &&
    !v._grouping &&
    (v._contains ?? []).length &&
    v._contains.every((c) => /^[A-Z]{2}$/.test(c)),
);
const of = new Map();
for (const [k, v] of leaves) for (const c of v._contains) of.set(c, k);

const ROOT = new URL("../../", import.meta.url);
const places = parseCountries(await readFile(new URL("src/data/countries.txt", ROOT), "utf8"));
const out = { source: "Unicode CLDR 48.2, territoryContainment (UN M49)", names: {}, of: {} };
const missing = [];
for (const p of places) {
  const r = of.get(p.code);
  if (!r) {
    missing.push(p.code);
    continue;
  }
  out.of[p.code] = r;
  out.names[r] = names[r];
}
console.log(
  `${Object.keys(out.of).length} places in ${Object.keys(out.names).length} sub-regions.`,
);
if (missing.length) console.log(`No sub-region: ${missing.join(" ")}`);
await writeFile(new URL("src/data/subregions.json", ROOT), JSON.stringify(out) + "\n");
