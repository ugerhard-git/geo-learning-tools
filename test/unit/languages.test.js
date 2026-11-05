// Scripts and Languages: the data generator's helpers, the data file, and
// the rules of the drills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseUnicodeSet } from "../../tools/data/unicode-set.mjs";
import { makeLanguageData, plainName } from "../../src/languages/data.js";
import {
  DRILLS,
  LanguageQuestion,
  alphabetOf,
  keyOf,
  languageIn,
  mapAreas,
  poolFor,
  specimenOf,
} from "../../src/languages/drills.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const data = makeLanguageData(
  JSON.parse(read("src/data/languages.json")),
  read("src/data/countries.txt"),
  JSON.parse(read("src/data/subregions.json")),
);
const streetView = read("tools/data/street-view-countries.txt")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

test("parseUnicodeSet reads CLDR's sets: ranges, groups and escapes", () => {
  assert.deepEqual(parseUnicodeSet("[a ą b-d {cs} \\u0142]"), ["a", "ą", "b", "c", "d", "cs", "ł"]);
  assert.throws(() => parseUnicodeSet("[a {cs]"), /unterminated/);
});

test("the Street View list names real places, each once", () => {
  assert.ok(streetView.length > 100);
  assert.equal(new Set(streetView).size, streetView.length);
  for (const code of streetView) assert.ok(data.countries[code], `${code} is not in countries.txt`);
});

test("every language has a script, a country with Street View, and a sentence or words", () => {
  assert.ok(data.languages.length > 60);
  for (const l of data.languages) {
    assert.ok(data.scripts[l.script], `${l.id} script`);
    assert.ok(l.countries.length, `${l.id} countries`);
    assert.ok(
      l.countries.every((c) => streetView.includes(c)),
      `${l.id} outside Street View`,
    );
    // Odia and Assamese have no translation of the Declaration; their words stand in.
    assert.ok(l.sentence.length > 10 || l.words.length >= 3, `${l.id} sentence or words`);
    assert.ok(!l.words.some((w) => /\d/.test(w)), `${l.id} placeholder words`);
  }
  assert.equal(plainName(data.byId["sr-Latn"]), "Serbian");
  assert.equal(plainName(data.byId["zh-Hant"]), "Chinese");
});

test("India's regional languages are in, each official only in some states", () => {
  for (const id of ["bn", "te", "mr", "ta", "ur", "gu", "kn", "ml", "or", "pa", "as"]) {
    const l = data.byId[id];
    assert.ok(l, id);
    assert.ok(l.countries.includes("IN"), `${id} in India`);
    assert.deepEqual(l.regional, ["IN"], `${id} regional`);
    assert.ok(l.regions.IN.official.length, `${id} states`);
  }
  // Hindi and English are official in all of India.
  assert.equal(data.byId.hi.regional, undefined);
  assert.equal(data.byId.en.regional, undefined);
  // Bengali is official in all of Bangladesh, and in some states of India.
  assert.ok(data.byId.bn.countries.includes("BD"));
  assert.ok(data.byId.kn.regions.IN.official.includes("Karnataka"));
  assert.match(data.byId.kn.regions.IN.source.url, /^https:\/\/en\.wikipedia\.org\//);
});

test("Europe's regional and minority languages say where they are used", () => {
  const where = (id, c) => data.byId[id]?.regions?.[c];
  assert.ok(where("cy", "GB").official.some((r) => r.startsWith("Wales")));
  assert.ok(where("eu", "ES").official.includes("the Basque Country"));
  assert.ok(where("eu", "FR").spoken.length);
  assert.ok(where("ca", "ES").official.includes("Catalonia"));
  assert.ok(where("de", "IT").signs[0].startsWith("South Tyrol"));
  for (const c of ["RS", "SK", "RO", "SI", "AT"]) assert.ok(where("hu", c), `hu ${c}`);
  for (const id of ["gl", "gd", "fy", "br", "co", "rm", "se", "hsb", "ast", "oc", "tt", "ba"]) {
    const l = data.byId[id];
    assert.ok(l?.regional?.length, `${id} regional`);
    for (const c of l.regional) assert.match(l.regions[c].source.url, /^https:\/\/en\.wikipedia/);
  }
  // Catalan is official in all of Andorra, and in some regions of Spain.
  assert.deepEqual(data.byId.ca.regional, ["ES"]);
});

test("South Africa's languages are official there nationwide, as is Albanian in North Macedonia", () => {
  for (const id of ["af", "zu", "xh", "nso", "ts", "ve", "nr", "ss", "st", "tn"]) {
    const l = data.byId[id];
    assert.ok(l?.countries.includes("ZA"), `${id} in South Africa`);
    assert.equal(l.regional, undefined, `${id} not regional`);
    assert.match(l.national.ZA.url, /Languages_of_South_Africa/);
  }
  assert.ok(data.byId.sq.national.MK);
});

test("a language without a sentence is shown by its words", () => {
  const lang = { id: "or", sentence: "", words: ["ଉତ୍ତର", "ଦକ୍ଷିଣ", "ପୂର୍ବ", "ପଶ୍ଚିମ"] };
  for (const kind of ["any", "sentence", "words"]) {
    assert.equal(specimenOf(lang, kind).kind, "words");
  }
});

test("a telltale letter is used by the few languages it names, and no other", () => {
  for (const t of data.telltales) {
    assert.ok(t.languages.length >= 1 && t.languages.length <= 4, t.letter);
    for (const l of data.languages) {
      if (l.script !== data.byId[t.languages[0]].script) continue;
      assert.equal(l.letters.includes(t.letter), t.languages.includes(l.id), `${t.letter} ${l.id}`);
    }
  }
});

test("progress keys are short and stable", () => {
  assert.equal(keyOf("language", data.byId.pl), "l:pl");
  assert.equal(keyOf("letter", { letter: "ł" }), "t:ł");
  assert.equal(keyOf("script", { code: "Thai" }), "s:Thai");
  assert.equal(keyOf("country", data.byId["sr-Latn"]), "c:sr-Latn");
});

for (const type of Object.keys(DRILLS)) {
  test(`"${type}": four different options, exactly one right, many times over`, () => {
    for (const item of poolFor(data, type)) {
      for (let i = 0; i < 3; i++) {
        const q = new LanguageQuestion(type, item, data);
        const options = q.options();
        assert.equal(options.length, 4, `${keyOf(type, item)} options`);
        assert.equal(new Set(options.map((o) => o.label)).size, 4, `${keyOf(type, item)} labels`);
        assert.equal(options.filter((o) => o.correct).length, 1, `${keyOf(type, item)} right`);
        assert.ok(q.specimen.text, `${keyOf(type, item)} specimen`);
        if (type === "letter") {
          // A wrong option never uses the letter: it would be right too.
          for (const o of options.filter((x) => !x.correct)) {
            const l = data.languages.find((x) => x.name === o.label);
            assert.ok(!l.letters.includes(item.letter), `${item.letter} ${l.id}`);
          }
        }
        if (type === "country") {
          for (const o of options.filter((x) => !x.correct)) {
            const code = data.streetView.find((c) => data.countries[c].name === o.label);
            assert.ok(!item.countries.includes(code), `${item.id} ${code}`);
          }
        }
        if (type === "language") {
          // Bosnian, Croatian and Serbian (Latin) are never offered against each other.
          const twins = ["Bosnian", "Croatian", "Serbian (Latin)"];
          if (twins.includes(item.name)) {
            assert.equal(options.filter((o) => twins.includes(o.label)).length, 1);
          }
        }
      }
    }
  });
}

test("typed answers: names, near misses, and other languages named", () => {
  const q = new LanguageQuestion("language", data.byId.pl, data);
  assert.deepEqual(q.judge("Polish"), { ok: true });
  assert.deepEqual(q.judge("polski"), { ok: true });
  assert.equal(q.judge("Polishh").typo, true);
  assert.deepEqual(q.judge("Czech"), { ok: false, other: "Czech", otherLabel: "Czech" });
  const letter = new LanguageQuestion("letter", { letter: "ø", languages: ["da", "nb"] }, data);
  assert.ok(letter.judge("Danish").ok && letter.judge("Norwegian Bokmål").ok);
  const script = new LanguageQuestion("script", { code: "Kore", name: data.scripts.Kore }, data);
  assert.ok(script.judge("Hangul").ok && script.judge("Korean").ok);
  const country = new LanguageQuestion("country", data.byId.nl, data);
  assert.ok(country.judge("Belgium").ok && country.judge("Netherlands").ok);
});

test("the checker accepts the language data and refuses what does not fit", async () => {
  const { checkLanguages, checkSignWords } = await import("../../tools/data/check-languages.mjs");
  const codes = new Set(Object.keys(data.countries));
  const json = JSON.parse(read("src/data/languages.json"));
  assert.deepEqual(checkLanguages(json, codes), []);
  const broken = structuredClone(json);
  broken.languages[0].countries = ["QQ"];
  // Only the countries problem, not its national source too.
  delete broken.languages[0].national;
  delete broken.languages[0].regional;
  delete broken.languages[0].regions;
  broken.languages[1].sentence = "x".repeat(1000);
  broken.languages[2].id = "<b>";
  const problems = checkLanguages(broken, codes);
  assert.equal(problems.length, 3, problems.join("; "));
  assert.deepEqual(
    checkSignWords({ street: { pl: "ulica" }, road: { pl: "droga" }, city: { pl: "miasto" } }),
    [],
  );
  assert.equal(checkSignWords({ street: { pl: "x".repeat(50) } }).length, 3);

  // States: only for a regional language, and only in its regional countries.
  const kn = structuredClone(json.languages.find((l) => l.id === "kn"));
  const one = (l) =>
    checkLanguages(
      { ...json, languages: json.languages.map((x) => (x.id === l.id ? l : x)) },
      codes,
    );
  const source = {
    title: "Languages of India",
    url: "https://en.wikipedia.org/wiki/Languages_of_India",
  };
  assert.deepEqual(
    one({ ...kn, regions: { IN: { official: ["Karnataka"], map: ["IN-KA"], source } } }),
    [],
  );
  assert.deepEqual(
    one({ ...kn, regions: { IN: { signs: ["Bengaluru"], map: ["IN-KA"], source } } }),
    [],
  );
  assert.match(one({ ...kn, regions: { BD: { official: ["Dhaka"], source } } }).join(), /regional/);
  assert.match(one({ ...kn, regions: { IN: { official: [], source } } }).join(), /regional/);
  assert.match(one({ ...kn, regions: { IN: { official: ["Karnataka"] } } }).join(), /regional/);
  const elsewhere = { title: "x", url: "https://example.org/x" };
  assert.match(
    one({ ...kn, regions: { IN: { official: ["Karnataka"], source: elsewhere } } }).join(),
    /regional/,
  );
  assert.match(one({ ...kn, regions: { IN: { capital: ["x"], source } } }).join(), /regional/);
  assert.match(one({ ...kn, regional: undefined, regions: {} }).join(), /regions/);
  assert.match(one({ ...kn, national: { BD: source } }).join(), /national/);
  // The map's regions must have outlines, and lie in that country.
  const where = (map) => ({ ...kn, regions: { IN: { official: ["Karnataka"], map, source } } });
  assert.match(one(where(["IN-ZZ"])).join(), /regional/);
  assert.match(one(where(["ES-B"])).join(), /regional/);
  assert.match(one(where([])).join(), /regional/);
  assert.match(one({ ...kn, sentence: "", words: ["ಉತ್ತರ"] }).join(), /sentence/);
});

test("each language has its words for signs and place names, with their English", () => {
  const pl = data.byId.pl;
  assert.equal(pl.road, "droga");
  assert.ok(pl.capitals.includes("Warszawa"));
  assert.ok(pl.placeWords.some(([en, w]) => en === "north" && w === "północ"));
  // English has nothing to translate.
  assert.deepEqual(data.byId.en.placeWords, []);
  // Most languages have most of the words.
  const counts = data.languages.map((l) => l.placeWords.length).sort((a, b) => a - b);
  assert.ok(counts[counts.length >> 1] >= 20, `median ${counts[counts.length >> 1]}`);
  // No dictionary marks: Russian stress, Arabic vowel marks.
  for (const id of ["ru", "ar"]) {
    for (const [, w] of data.byId[id]?.placeWords ?? []) {
      assert.ok(!/[\u0301\u064B-\u0652]/.test(w.normalize("NFD")), `${id}: ${w}`);
    }
  }
});

test("the map drill accepts a language's countries, and its regions where it is regional", () => {
  // Kannada: only Karnataka.
  assert.deepEqual(mapAreas(data.byId.kn), { countries: [], regions: ["IN-KA"] });
  // Bengali: all of Bangladesh, and some states of India.
  const bn = mapAreas(data.byId.bn);
  assert.deepEqual(bn.countries, ["BD"]);
  assert.ok(bn.regions.includes("IN-WB") && !bn.countries.includes("IN"));
  // Every region the map shades has an outline.
  for (const l of data.languages) {
    for (const code of mapAreas(l).regions) {
      assert.ok(data.regionShapes.ringsOf(code).length, `${l.id} ${code}`);
    }
  }
  const q = new LanguageQuestion("map", data.byId.kn, data);
  assert.equal(keyOf("map", data.byId.kn), "m:kn");
  assert.match(q.prompt().sub, /region/);
  assert.equal(q.prompt().hint, "Kannada");
});

test("a language's alphabet: its letters without combining marks, none for Chinese", () => {
  const pl = alphabetOf(data.byId.pl);
  assert.ok(pl.includes("ą") && pl.includes("ł") && pl.includes("a"));
  assert.equal(alphabetOf(data.byId["zh-Hans"]), null);
  assert.equal(alphabetOf(data.byId.ko), null);
  // Hindi's vowel signs combine with a letter, so they are left out.
  assert.ok(alphabetOf(data.byId.hi).every((ch) => !/\p{M}/u.test(ch)));
  const spec = specimenOf(data.byId.pl, "letters");
  assert.equal(spec.kind, "letters");
  assert.equal(spec.text, pl.join(" "));
  // A kind a language does not have gives one it has.
  assert.notEqual(specimenOf(data.byId.ja, "letters").kind, "letters");
});

test("an alphabet question never offers another language with the same letters", () => {
  for (const id of ["en", "id", "ms", "pl", "es"]) {
    const lang = data.byId[id];
    const twins = data.languages.filter(
      (l) => l !== lang && alphabetOf(l)?.join("") === alphabetOf(lang).join(""),
    );
    for (let i = 0; i < 20; i++) {
      const q = new LanguageQuestion("language", lang, data, { show: "letters" });
      assert.equal(q.specimen.kind, "letters");
      assert.equal(q.prompt().sub, "its alphabet");
      const labels = q.options().map((o) => o.label);
      for (const t of twins) assert.ok(!labels.includes(t.name), `${id}: ${t.name} offered`);
      // Typed, any language with those letters is right.
      for (const t of twins) assert.ok(q.judge(t.name)?.ok, `${id}: ${t.name} typed`);
    }
  }
});

test("the drills and the list can be limited to a part of the world", () => {
  // Southern Europe (039): Italian and Catalan, not Japanese.
  const south = poolFor(data, "language", { where: "039" }).map((l) => l.id);
  assert.ok(south.includes("it") && south.includes("ca") && !south.includes("ja"));
  // A regional language counts where it is used: Welsh in Northern Europe (154).
  assert.ok(languageIn(data.byId.cy, "154", data));
  assert.ok(!languageIn(data.byId.cy, "039", data));
  // Asia (S): Thai script in, Greek out; Europe (E): telltale letters only of its languages.
  const asian = poolFor(data, "script", { where: "S" }).map((s) => s.code);
  assert.ok(asian.includes("Thai") && !asian.includes("Grek"));
  const euro = new Set(poolFor(data, "language", { where: "E" }).map((l) => l.id));
  for (const t of poolFor(data, "letter", { where: "E" })) {
    assert.ok(
      t.languages.some((id) => euro.has(id)),
      t.letter,
    );
  }
  // Alphabets only: no Chinese, Japanese or Korean script.
  const scripts = poolFor(data, "script", { show: "letters" }).map((s) => s.code);
  assert.ok(!scripts.includes("Hans") && !scripts.includes("Kore") && scripts.includes("Latn"));
  // Which country: the answer and the wrong options are in the part picked.
  for (let i = 0; i < 20; i++) {
    const q = new LanguageQuestion("country", data.byId.fr, data, { where: "F" });
    assert.equal(data.countries[q.country].region, "F");
    for (const o of q.options()) {
      const c = Object.values(data.countries).find((x) => x.name === o.label);
      assert.equal(c.region, "F", o.label);
    }
  }
  // Which language: wrong options from the part picked while there are enough.
  for (let i = 0; i < 20; i++) {
    const q = new LanguageQuestion("language", data.byId.it, data, { where: "039" });
    for (const o of q.options()) {
      const l = data.languages.find((x) => x.name === o.label);
      assert.ok(languageIn(l, "039", data), o.label);
    }
  }
});

test("on the map, an alphabet is shown only where it points to one language", () => {
  const pool = poolFor(data, "map", { show: "letters" });
  assert.ok(pool.length > 10);
  for (const l of pool) {
    const same = data.languages.filter((x) => alphabetOf(x)?.join("") === alphabetOf(l).join(""));
    assert.equal(same.length, 1, l.id);
  }
  // English shares its letters: shown another way.
  for (let i = 0; i < 10; i++) {
    const q = new LanguageQuestion("map", data.byId.en, data, { show: "letters" });
    assert.notEqual(q.specimen.kind, "letters");
  }
});

test("on the map, Bosnian, Croatian and Serbian (Latin) share an answer", () => {
  const q = new LanguageQuestion("map", data.byId.hr, data);
  assert.deepEqual(q.answers.map((l) => l.id).sort(), ["bs", "hr", "sr-Latn"]);
  for (const c of ["BA", "HR", "RS"]) assert.ok(q.areas.countries.includes(c), c);
  assert.deepEqual(new LanguageQuestion("map", data.byId.pl, data).answers, [data.byId.pl]);
});
