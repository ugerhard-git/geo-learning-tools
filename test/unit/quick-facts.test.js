// Countries and Territories: the quick facts and the clues the Clues quiz asks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLUES,
  clueItems,
  clueKey,
  currencyWord,
  makeQuickFacts,
  quickRows,
} from "../../src/countries/quick-facts.js";
import { checkQuickFacts } from "../../tools/data/check-quick-facts.mjs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const json = JSON.parse(read("src/data/quick-facts.json"));
const facts = makeQuickFacts(json);
const codes = new Set(
  read("src/data/countries.txt")
    .split("\n")
    .map((l) => l.split("|")[0]),
);

test("the data file is well formed and covers most places", () => {
  assert.deepEqual(checkQuickFacts(json, codes), []);
  assert.deepEqual(facts.PL.tld, [".pl"]);
  assert.deepEqual(facts.PL.phone, ["+48"]);
  assert.equal(facts.PL.currency[0].code, "PLN");
  // The United Kingdom's domain is .uk, not its ISO code.
  assert.deepEqual(facts.GB.tld, [".uk"]);
  // Euro countries have the euro.
  assert.ok(facts.DE.currency.some((c) => c.code === "EUR"));
});

test("checkQuickFacts names what is wrong", () => {
  const bad = { facts: { ZZ: { tld: ["pl"], phone: ["48"], currency: [{ code: "pln" }] } } };
  const problems = checkQuickFacts(bad, codes).join("\n");
  for (const p of [
    "only 1 places",
    "ZZ: not in countries.txt",
    "ZZ: tld",
    "ZZ: phone",
    "ZZ: currency",
  ]) {
    assert.match(problems, new RegExp(p));
  }
});

test("currencyWord leaves the country out of a currency's name", () => {
  assert.equal(currencyWord("Polish zloty"), "zloty");
  assert.equal(currencyWord("Bosnia-Herzegovina convertible mark"), "convertible mark");
  assert.equal(currencyWord("South African rand"), "rand");
  assert.equal(currencyWord("euro"), "euro");
  assert.equal(currencyWord("Euro"), "euro");
});

test("a clue is asked only where one place has it", () => {
  const places = [...codes].filter((c) => facts[c]).map((code) => ({ code }));
  const items = clueItems(places, facts, Object.keys(CLUES));
  const seen = new Set();
  for (const it of items) {
    const k = `${it.kind}|${it.value}`;
    assert.ok(!seen.has(k), `${k} asked twice`);
    seen.add(k);
  }
  // Shared values are never asked, and phone codes not at all.
  assert.ok(!items.some((it) => it.kind === "currency" && it.value === "euro"));
  assert.ok(!items.some((it) => it.kind === "phone"));
  assert.deepEqual(Object.keys(CLUES), ["tld", "currency"]);
  assert.ok(items.some((it) => it.code === "PL" && it.kind === "tld" && it.value === ".pl"));
  assert.ok(items.length > 200);
});

test("clue keys differ from the map quiz's and from each other", () => {
  const keys = Object.keys(CLUES).map((kind) => clueKey({ code: "PL", kind }));
  assert.equal(new Set([...keys, "c:PL"]).size, keys.length + 1);
  assert.ok(CLUES.tld.prompt(".pl").includes(".pl"));
});

test("quickRows lists a place's facts for its details", () => {
  const rows = quickRows(facts.PL);
  assert.deepEqual(
    rows.map(([k]) => k),
    ["Internet domain", "Phone code", "Currency"],
  );
  assert.match(rows[2][1], /PLN/);
  assert.deepEqual(quickRows(undefined), []);
});
