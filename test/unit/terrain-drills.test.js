import { test, before } from "node:test";
import assert from "node:assert/strict";
import { serveDataFromDisk } from "./load-data.js";
import { loadFeatures } from "../../src/terrain-atlas/data.js";
import {
  SCOPES,
  TerrainQuestion,
  featureDistance,
  inScope,
  keyOf,
  nearestFeature,
  poolFor,
} from "../../src/terrain-atlas/drills.js";

let features;
const feature = (name, kind) => features.find((f) => f.name === name && (!kind || f.kind === kind));

before(async () => {
  serveDataFromDisk();
  features = await loadFeatures();
});

test("every feature decodes, with a box around its geometry", () => {
  assert.equal(features.length, 2121);
  const danube = feature("Danube");
  assert.equal(danube.geom, "l");
  const [x, y, w, h] = danube.box;
  assert.ok(x > 8 && x + w < 30 && y > 42 && y + h < 50, "the Danube runs through central Europe");
});

test("progress keys keep the scheme saved progress is made of", () => {
  assert.equal(keyOf("locate", feature("Danube")), "l:riv/Danube");
  assert.equal(keyOf("clue", feature("Danube")), "c:riv/Danube");
});

test("distance to an area is zero inside it and grows outside", () => {
  const caspian = feature("Caspian Sea");
  assert.equal(featureDistance(caspian, 51, 42), 0);
  const far = featureDistance(caspian, 30, 42);
  assert.ok(far > 1000 && far < 2000, `${far}`);
});

test("distance to a river is measured to its nearest stretch", () => {
  const danube = feature("Danube");
  // Vienna stands on the Danube.
  assert.ok(featureDistance(danube, 16.37, 48.21) < 15);
});

test("the nearest feature wins, and of two equally near the smaller", () => {
  const caspian = feature("Caspian Sea");
  assert.equal(nearestFeature(features, 51, 42, 50), caspian);
  // Far out in the South Pacific there is nothing but the ocean itself.
  assert.equal(nearestFeature(features, -150, -45, 50).name, "South Pacific Ocean");
  const rivers = features.filter((f) => f.kind === "riv");
  assert.equal(nearestFeature(rivers, -150, -45, 50), null);
});

test("the scope keeps the whole world and the open ocean apart", () => {
  assert.equal(SCOPES.W, "Whole world");
  assert.equal(SCOPES.ocean, "Open ocean");
  const atSea = features.filter((f) => f.cont === "W");
  assert.ok(atSea.length > 0);
  assert.ok(atSea.every((f) => inScope(f, "ocean") && inScope(f, "W")));
  assert.ok(!inScope(feature("Danube"), "ocean"));
});

test("a clue that fits several features accepts all of them", () => {
  const pool = poolFor(features, { type: "clue", kinds: new Set(["riv"]), level: "9", scope: "W" });
  // Find a river whose first four countries another river also flows through.
  const shared = pool.find((f) => new TerrainQuestion("clue", f, pool).accepted().length > 1);
  assert.ok(shared, "some clue has more than one answer");
  const q = new TerrainQuestion("clue", shared, pool);
  const other = q.accepted().find((o) => o !== shared);
  assert.deepEqual(q.judge(other.name), { ok: true });
  assert.match(q.rightNote(), /^ \d+ others? would also have counted\.$/);
});

test("naming it from four: one right option, the rest of the same kind nearby", () => {
  const pool = poolFor(features, { type: "name", kinds: new Set(["rng"]), level: "4", scope: "W" });
  const alps = feature("Alps", "rng") ?? pool[0];
  const q = new TerrainQuestion("name", alps, pool);
  const options = q.options();
  assert.equal(options.length, 4);
  assert.equal(options.filter((o) => o.correct).length, 1);
  assert.equal(q.prompt().main, "Which mountain range is highlighted?");
});
