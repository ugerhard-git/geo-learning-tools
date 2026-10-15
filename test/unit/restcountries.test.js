import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEY_PATTERN,
  errorText,
  factRows,
  isCountryFacts,
  summarise,
} from "../../src/shared/restcountries.js";
import { HttpError } from "../../src/shared/net.js";

const RECORD = {
  names: { official: "Federal Republic of Germany" },
  capitals: [{ name: "Berlin" }],
  subregion: "Western Europe",
  population: 83_000_000,
  area: { kilometers: 357_022 },
  languages: { de: { name: "German" } },
  currencies: { EUR: { name: "Euro", symbol: "€" } },
  flag: { description: "Three horizontal bands of black, red and gold." },
};

test("summarise reduces an API record to a few short fields", () => {
  assert.deepEqual(summarise(RECORD), {
    official: "Federal Republic of Germany",
    capital: "Berlin",
    subregion: "Western Europe",
    population: 83_000_000,
    area: 357_022,
    languages: "German",
    currency: "Euro (€)",
    flagDesc: "Three horizontal bands of black, red and gold.",
  });
});

test("summarise drops anything that is not the expected type and cuts long text", () => {
  const facts = summarise({
    names: { official: "x".repeat(1000) },
    capitals: "not a list",
    population: "83 million",
    area: { kilometers: Infinity },
    languages: [42, { name: "<b>Bold</b>" }],
  });
  assert.equal(facts.official.length, 200);
  assert.equal(facts.capital, "");
  assert.equal(facts.population, null);
  assert.equal(facts.area, null);
  // Markup is kept as text here; the pages escape it when they show it.
  assert.equal(facts.languages, "<b>Bold</b>");
  assert.equal(summarise(null), null);
});

test("cached facts are checked; flagDesc is optional, as older entries lack it", () => {
  const facts = summarise(RECORD);
  assert.ok(isCountryFacts(facts));
  const older = { ...facts };
  delete older.flagDesc;
  assert.ok(isCountryFacts(older));
  assert.ok(!isCountryFacts({ ...facts, capital: 7 }));
  assert.ok(!isCountryFacts({ ...facts, population: "many" }));
  assert.ok(!isCountryFacts({ ...facts, flagDesc: {} }));
  assert.ok(!isCountryFacts(null));
});

test("factRows leaves out empty facts and formats numbers", () => {
  const rows = factRows({ ...summarise(RECORD), subregion: "" });
  assert.deepEqual(
    rows.map(([k]) => k),
    ["Official name", "Capital", "Population", "Area", "Languages", "Currency"],
  );
  assert.deepEqual(rows[2], ["Population", "83,000,000"]);
  assert.deepEqual(rows[3], ["Area", "357,022 km²"]);
});

test("API keys must look like keys", () => {
  assert.ok(KEY_PATTERN.test("abcDEF123._~+/=-"));
  assert.ok(!KEY_PATTERN.test("short"));
  assert.ok(!KEY_PATTERN.test("has spaces in it"));
  assert.ok(!KEY_PATTERN.test('quote"inside'));
});

test("error messages say what went wrong", () => {
  assert.match(errorText(new HttpError(401)), /rejected the key/);
  assert.match(errorText(new HttpError(429)), /Wait ten seconds/);
  assert.match(errorText(new HttpError(500)), /error 500/);
});
