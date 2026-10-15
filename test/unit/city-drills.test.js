import { test, before } from "node:test";
import assert from "node:assert/strict";
import { serveDataFromDisk } from "./load-data.js";
import { RegionShapes, loadCityData } from "../../src/cities/data.js";
import { CityQuestion, keyOf, poolFor, scopeOptions } from "../../src/cities/drills.js";

let data;
let shapes;
const city = (name, iso) => data.cities.find((c) => c.name === name && (!iso || c.iso === iso));

before(async () => {
  serveDataFromDisk();
  data = await loadCityData();
  shapes = new RegionShapes(data.packedShapes, data.regionScale);
});

test("progress keys keep the scheme saved progress is made of", () => {
  assert.equal(keyOf("locate", city("Paris", "FR")), "l:FR/Paris");
  assert.equal(keyOf("capital", city("Paris", "FR")), "c:FR/Paris");
  assert.equal(keyOf("rlocate", data.regionBy.get("FR-59")), "rl:FR-59");
  assert.equal(keyOf("region", data.regionBy.get("FR-59")), "r:FR-59");
});

test("capitals are worked out for countries and regions", () => {
  assert.deepEqual(
    data.nationalCapitals
      .get("ZA")
      .map((c) => c.name)
      .sort(),
    ["Bloemfontein", "Cape Town", "Pretoria"],
  );
  assert.equal(data.capitalOfRegion.get(city("Lyon").reg), city("Lyon"));
  // A city-state's capital is its region's capital too.
  assert.equal(data.capitalOfRegion.get(city("Berlin", "DE").reg), city("Berlin", "DE"));
});

test("pools follow the category and scope", () => {
  const caps = poolFor(data, { type: "locate", cat: "cap", scope: "W" });
  assert.ok(caps.length > 180 && caps.every((c) => c.t === 2));
  const french = poolFor(data, { type: "rlocate", cat: "cap", scope: "FR" });
  assert.ok(french.length > 50 && french.every((r) => r.iso === "FR"));
  const europe = poolFor(data, { type: "locate", cat: "big", scope: "E" });
  assert.ok(europe.every((c) => c.pop >= 1e6 && data.countryBy[c.iso].region === "E"));
  assert.deepEqual(scopeOptions(data, "city").slice(0, 2), [
    ["W", "Whole world"],
    ["F", "Africa"],
  ]);
});

test("asking for a capital accepts every capital a country has", () => {
  const pretoria = city("Pretoria");
  const q = new CityQuestion(data, shapes, "capital", pretoria, 0);
  assert.equal(q.prompt().main, "What is the capital of South Africa?");
  assert.deepEqual(q.judge("Cape Town", []), { ok: true });
  assert.deepEqual(q.judge("bloemfontien", []), { ok: true, typo: true });
  // Feedback names all three.
  assert.deepEqual(q.answerText().split(", ").sort(), ["Bloemfontein", "Cape Town", "Pretoria"]);
});

test("the other direction asks what a capital is the capital of", () => {
  const q = new CityQuestion(data, shapes, "capital", city("Paris", "FR"), 1);
  assert.equal(q.prompt().main, "Paris is the capital of what?");
  assert.deepEqual(q.judge("france", []), { ok: true });
  assert.equal(q.answerText(), "France");
});

test("naming another place in the drill says which place that was", () => {
  const pool = poolFor(data, { type: "name", cat: "cap", scope: "E" });
  const q = new CityQuestion(data, shapes, "name", city("Vienna", "AT"), 0);
  assert.deepEqual(q.judge("Budapest", pool), { ok: false, otherLabel: "Budapest" });
  assert.deepEqual(q.judge("Wien", pool), { ok: true }); // another name for Vienna
  assert.equal(q.judge("  ", pool), null);
});

test("multiple choice offers four distinct neighbours, exactly one of them right", () => {
  const pool = poolFor(data, { type: "name", cat: "cap", scope: "W" });
  const q = new CityQuestion(data, shapes, "name", city("Vienna", "AT"), 0);
  for (let i = 0; i < 20; i++) {
    const options = q.options(pool);
    assert.equal(options.length, 4);
    assert.equal(new Set(options.map((o) => o.label)).size, 4);
    assert.deepEqual(
      options.filter((o) => o.correct).map((o) => o.label),
      ["Vienna"],
    );
  }
});

test("the hint names the country, and a regional capital's region", () => {
  const q = new CityQuestion(data, shapes, "locate", city("Lyon"), 0);
  assert.equal(q.prompt().hint, "France · Rhône");
});

test("region extents cover the region's outline", () => {
  const { box, middle } = shapes.extent("FR-59");
  const [x, y, w, h] = box;
  assert.ok(middle[0] >= x && middle[0] <= x + w && middle[1] >= y && middle[1] <= y + h);
  assert.ok(w > 0.5 && w < 3 && h > 0.5 && h < 3);
});
