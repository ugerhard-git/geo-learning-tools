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
  keyOf,
  poolFor,
  specimenOf,
} from "../../src/languages/drills.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const data = makeLanguageData(
  JSON.parse(read("src/data/languages.json")),
  read("src/data/countries.txt"),
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
  }
  // Hindi and English are official in all of India.
  assert.equal(data.byId.hi.regional, undefined);
  assert.equal(data.byId.en.regional, undefined);
  // Bengali is official in all of Bangladesh, and in some states of India.
  assert.ok(data.byId.bn.countries.includes("BD"));
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
  assert.deepEqual(one({ ...kn, regions: { IN: ["Karnataka"] } }), []);
  assert.match(one({ ...kn, regions: { BD: ["Dhaka"] } }).join(), /regional/);
  assert.match(one({ ...kn, regional: undefined, regions: {} }).join(), /regions/);
  assert.match(one({ ...kn, sentence: "", words: ["ಉತ್ತರ"] }).join(), /sentence/);
  const words = { street: { pl: "ulica" }, road: { pl: "droga" }, city: { pl: "miasto" } };
  const ok = { IN: { kn: [{ source: "Q1185", name: "Karnataka" }] } };
  assert.deepEqual(checkSignWords({ ...words, regions: ok }), []);
  const bad = { IN: { kn: [{ source: "x", name: "<b>" }] } };
  assert.deepEqual(checkSignWords({ ...words, regions: bad }), ["regions IN"]);
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
