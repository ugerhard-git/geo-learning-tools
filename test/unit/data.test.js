// The data files in src/data/ hang together: every app can decode them, and
// the codes they use refer to each other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { csvRings, unpack, unpackRing } from "../../src/shared/codec.js";
import { flagArticleTitles, parseCountries } from "../../src/shared/countries.js";
import { parseTags, parseFlagColours, NO_OWN_FLAG, NOT_QUIZZABLE } from "../../src/flags/design.js";
import { checkFlagColours } from "../../tools/data/check-flag-colours.mjs";

const read = (name) => readFileSync(new URL(`../../src/data/${name}`, import.meta.url), "utf8");
const countries = parseCountries(read("countries.txt"));
const codes = new Set(countries.map((c) => c.code));

/**
 * Codes the outlines use that the country table deliberately leaves out:
 * XD is an outline without a country of its own (Countries and Territories greys it
 * out), UM the United States Minor Outlying Islands and -1 Natural Earth's
 * mark for disputed areas, both of which only own regions.
 */
const known = (code) => codes.has(code) || ["XD", "UM", "-1"].includes(code);

test("the country table has every place once, with a valid region and status", () => {
  assert.equal(countries.length, 253);
  assert.equal(codes.size, 253);
  for (const c of countries) {
    assert.match(c.code, /^[A-Z]{2}(-[A-Z]{3})?$/, c.code);
    assert.ok("FASEON".includes(c.region), `${c.code} region`);
    assert.ok("uoptc".includes(c.status), `${c.code} status`);
  }
  const cg = countries.find((c) => c.code === "CD");
  assert.ok(cg.aliases.includes("DR Congo"));
});

test("Wikipedia flag titles follow the table's hints", () => {
  const by = (code) => countries.find((c) => c.code === code);
  assert.equal(flagArticleTitles(by("NL"))[0], "Flag of the Netherlands");
  assert.equal(flagArticleTitles(by("GB-NIR"))[0], "Flag of Northern Ireland");
  assert.equal(flagArticleTitles(by("FR"))[0], "Flag of France");
});

test("every flag with a design has a place, and only places with a flag of their own", () => {
  const tags = parseTags(read("flag-tags.txt"));
  for (const code of tags.keys()) assert.ok(codes.has(code), code);
  for (const code of NO_OWN_FLAG) assert.ok(!tags.has(code), code);
  assert.equal(tags.size, countries.length - NO_OWN_FLAG.size);
});

test("world outlines decode, and name only known places", () => {
  const world = JSON.parse(read("world.json"));
  assert.equal(world.f.length, 298);
  for (const f of world.f) {
    for (const ring of csvRings(f.r)) {
      for (let i = 0; i < ring.length; i += 2) {
        assert.ok(Math.abs(ring[i]) <= 180.01 && Math.abs(ring[i + 1]) <= 90.01);
      }
    }
  }
  for (const code of Object.keys(world.i)) assert.ok(known(code), code);
});

test("cities and regions decode, and refer to known countries and regions", () => {
  const data = JSON.parse(read("cities.json"));
  const regions = data.regions.split("\n").map((l) => l.split("\t"));
  const regionCodes = new Set(regions.map((r) => r[0]));
  const cities = data.cities.split("\n").map((l) => l.split("\t"));
  assert.equal(cities.length, 2738);
  assert.equal(regions.length, 4596);
  for (const [, , , iso] of regions) assert.ok(known(iso), iso);
  for (const f of cities) {
    assert.ok(codes.has(f[2]), f[2]);
    if (f[3]) assert.ok(regionCodes.has(f[3]), f[3]);
    const [lon, lat] = unpack(f[4]).map((n) => n / data.scale.city);
    assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90, f[0]);
    assert.ok(["0", "1", "2"].includes(f[6]));
  }
});

test("terrain features decode, each with a known kind and some geometry", () => {
  const data = JSON.parse(read("terrain.json"));
  const features = data.features.split("\n").map((l) => l.split("\t"));
  assert.equal(features.length, 2121);
  for (const f of features) {
    assert.ok(
      ["riv", "lak", "sea", "gul", "str", "rng", "pea", "des", "plt", "isl", "pen", "reg"].includes(
        f[0],
      ),
    );
    assert.ok(["p", "l", "x"].includes(f[8]), f[1]);
    const scale = f[8] === "x" ? data.scale.point : data.scale.line;
    const first = unpackRing(f[9].split("|")[0], scale);
    assert.ok(first.length >= 2, f[1]);
  }
});

test("the shared country outlines name only known places", () => {
  const land = JSON.parse(read("land.json"));
  for (const line of land.shapes.split("\n")) {
    for (const code of line.split("\t")[0].split(",").filter(Boolean)) {
      assert.ok(known(code), code);
    }
  }
});

test("every flag of its own has colour codes, in a well-formed file", () => {
  const text = read("flag-colours.txt");
  assert.deepEqual(checkFlagColours(text, codes), []);
  const colours = parseFlagColours(text);
  // The Cocos Islands are left out on purpose: see tools/data/flag-colours.mjs.
  const missing = countries
    .map((c) => c.code)
    .filter((c) => !NO_OWN_FLAG.has(c) && !NOT_QUIZZABLE.has(c) && c !== "CC")
    .filter((c) => !colours.has(c));
  assert.deepEqual(missing, []);
});
