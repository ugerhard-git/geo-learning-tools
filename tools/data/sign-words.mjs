// Builds tools/data/sign-words.json: the words for "street" and "city" in
// every language Wikidata has them in, words that show up on street signs
// and town signs. They are the labels of three Wikidata items (CC0): Q79007
// "street", Q34442 "road" (for languages with no label for "street") and
// Q515 "city".
//
// tools/data/languages.mjs picks out the app's languages and merges the
// words into src/data/languages.json, so run this first, then that. The
// Language data workflow (.github/workflows/language-data.yml) does both on
// GitHub, since Wikidata cannot be reached from every machine.
//
//   node tools/data/sign-words.mjs

import { writeFile } from "node:fs/promises";

const ITEMS = { street: "Q79007", road: "Q34442", city: "Q515" };

const HEADERS = {
  "User-Agent":
    "geo-learning-tools sign word builder (https://github.com/ugerhard-git/geo-learning-tools)",
};

const url =
  "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels" +
  `&ids=${Object.values(ITEMS).join("|")}`;
const res = await fetch(url, { headers: HEADERS });
if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
const entities = (await res.json()).entities;

const out = { source: "Wikidata labels of Q79007 (street), Q34442 (road) and Q515 (city), CC0" };
for (const [word, qid] of Object.entries(ITEMS)) {
  out[word] = {};
  for (const [code, label] of Object.entries(entities?.[qid]?.labels ?? {})) {
    // A label is a word or two; anything longer is not a sign word.
    if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(code) && typeof label?.value === "string") {
      const value = label.value.trim();
      if (value && value.length <= 40) out[word][code] = value;
    }
  }
}

const counts = Object.keys(ITEMS).map((w) => `${Object.keys(out[w]).length} ${w}`);
console.log(`Labels: ${counts.join(", ")}.`);
if (Object.keys(ITEMS).some((w) => Object.keys(out[w]).length < 100)) {
  console.error("Too few labels; not writing the file.");
  process.exit(1);
}
await writeFile(new URL("sign-words.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
