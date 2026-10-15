import { test } from "node:test";
import assert from "node:assert/strict";
import { factsQuery, isCountryWikidata, parseFacts } from "../../src/countries/wikidata-facts.js";

const item = (q) => ({ type: "uri", value: `http://www.wikidata.org/entity/${q}` });
const prop = (p) => ({ type: "uri", value: `http://www.wikidata.org/entity/${p}` });
const row = (q, p, label, extra = {}) => ({
  c: item(q),
  pid: prop(p),
  v: { type: "uri", value: "http://www.wikidata.org/entity/Q1" },
  vLabel: { type: "literal", value: label },
  ...extra,
});

test("the query takes only real country codes", () => {
  assert.match(factsQuery("DE"), /wdt:P297 "DE"/);
  assert.match(factsQuery("GB-SCT"), /wdt:P300 "GB-SCT"/);
  assert.throws(() => factsQuery('DE" } DELETE {'));
  assert.throws(() => factsQuery("de"));
});

test("results become labelled sections, from the item with most statements", () => {
  const facts = parseFacts([
    row("Q183", "P36", "Berlin"),
    row("Q183", "P122", "federal republic"),
    row("Q183", "P1082", "", {
      v: { type: "literal", value: "83000000" },
      time: { value: "2023-01-01T00:00:00Z" },
    }),
    row("Q183", "P1082", "", {
      v: { type: "literal", value: "80000000" },
      time: { value: "2011-01-01T00:00:00Z" },
    }),
    row("Q183", "P140", "Christianity", { share: { value: "0.5" } }),
    row("Q183", "P140", "Islam", { share: { value: "0.06" } }),
    row("Q999", "P36", "Elsewhere"), // a former state that kept the code
  ]);
  assert.equal(facts.qid, "Q183");
  assert.deepEqual(facts.basic, [
    ["Capital", "Berlin"],
    ["Population", "83,000,000 (2023)"],
  ]);
  assert.deepEqual(facts.politics, [["Form of government", "federal republic"]]);
  assert.deepEqual(facts.people, [["Religions", "Christianity (50%), Islam (6.0%)"]]);
  assert.ok(isCountryWikidata(facts));
  // Planted entries: too many rows, or text far longer than a query yields.
  assert.ok(!isCountryWikidata({ ...facts, basic: Array(500).fill(["a", "b"]) }));
  assert.ok(!isCountryWikidata({ ...facts, basic: [["a", "x".repeat(1e5)]] }));
});

test("unlabelled values and foreign item addresses are dropped", () => {
  const facts = parseFacts([
    row("Q183", "P36", "Q64"),
    { ...row("Q183", "P36", ""), c: { value: "https://evil.example/entity/Q183" } },
  ]);
  assert.deepEqual(facts.basic, []);
});

test("cached facts must have the right shape", () => {
  assert.ok(isCountryWikidata({ qid: null, basic: [], politics: [], people: [], more: [] }));
  assert.ok(!isCountryWikidata({ qid: "x", basic: [], politics: [], people: [], more: [] }));
  assert.ok(
    !isCountryWikidata({ qid: null, basic: [["a", 1]], politics: [], people: [], more: [] }),
  );
});
