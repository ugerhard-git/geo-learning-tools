// Roads: reading sign drawings out of Wikipedia's wikitext, the checks on
// what the workflow fetches, the data file, and the rules of the drills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { captionedFiles, captionText, signScore } from "../../tools/data/road-sign-wikitext.mjs";
import { checkRoadSigns } from "../../tools/data/check-road-signs.mjs";
import { parseCountryList } from "../../tools/data/street-view.mjs";
import { CLUES, hasClue, makeRoadData } from "../../src/roads/data.js";
import {
  DRILLS,
  RoadQuestion,
  cleanClues,
  itemOfKey,
  keyOf,
  poolFor,
} from "../../src/roads/drills.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const roads = JSON.parse(read("src/data/roads.json"));
const countryText = read("src/data/countries.txt");
const streetView = parseCountryList(read("tools/data/street-view-countries.txt"));

/** Made-up drawings, so the drills can be tested without the fetched ones. */
const sign = (code, clue, commons) => ({
  file: `${code.toLowerCase()}-${clue}.svg`,
  commons,
  licence: "Public domain",
  author: "Someone",
  source: "Road signs in Somewhere",
});
const signs = {
  DE: { stop: sign("DE", "stop", "Zeichen_206.svg"), warning: sign("DE", "warning", "Z101.svg") },
  AT: { stop: sign("AT", "stop", "Zeichen_206.svg"), warning: sign("AT", "warning", "AT101.svg") },
  JP: { stop: sign("JP", "stop", "Japan_330.svg"), warning: sign("JP", "warning", "JP215.svg") },
  US: { stop: sign("US", "stop", "MUTCD_R1-1.svg"), warning: sign("US", "warning", "W1.svg") },
  BR: { stop: sign("BR", "stop", "Brasil_R-1.svg") },
  MX: { stop: sign("MX", "stop", "Mexico_alto.svg"), warning: sign("MX", "warning", "MX.svg") },
  FR: { stop: sign("FR", "stop", "France_AB4.svg"), warning: sign("FR", "warning", "A14.svg") },
};
const data = makeRoadData(roads, signs, countryText);

test("captionedFiles finds drawings in galleries and in tables", () => {
  const text = [
    "== Warning signs ==",
    "<gallery>",
    "File:Zeichen 101.svg|Pedestrian crossing",
    "</gallery>",
    "== Regulatory signs ==",
    "=== Priority ===",
    "<gallery>",
    "File:Zeichen 206.svg|Stop and give way",
    "File:Zeichen 350-10.svg|[[Pedestrian crossing]]",
    "Denmark road sign B13.svg|B13 Stop",
    "</gallery>",
    "Not in a gallery.svg|Stop",
    "| [[File:Japan road sign 330-A.svg|80px]] || Stop || 止まれ",
    "[[File:Chevron alignment.svg|thumb|Curve alignment marker]]",
  ].join("\n");
  const files = captionedFiles(text);
  const find = (sign) =>
    files.filter((f) => signScore(sign, f.caption, f.file, f.section)).map((f) => f.file);
  assert.equal(files[1].section, "Regulatory signs / Priority");
  // In a gallery the "File:" may be left out; outside one it may not.
  assert.deepEqual(find("stop"), [
    "Zeichen_206.svg",
    "Denmark_road_sign_B13.svg",
    "Japan_road_sign_330-A.svg",
  ]);
  // The same caption: the warning section's drawing is the warning sign.
  assert.deepEqual(find("pedestrian"), ["Zeichen_101.svg"]);
  assert.deepEqual(find("crossing"), ["Zeichen_350-10.svg"]);
  assert.deepEqual(find("chevron"), ["Chevron_alignment.svg"]);
});

test("signScore takes the sign's number off and ranks the plain name first", () => {
  assert.equal(captionText("R1-1Stop"), "Stop");
  assert.equal(captionText("3.01 Stop"), "Stop");
  assert.equal(captionText("Stop sign ahead"), "Stop sign ahead");
  assert.equal(signScore("stop", "R1-1Stop"), 2);
  assert.equal(signScore("stop", "Stop, children crossing"), 0);
  assert.equal(signScore("stop", "Stop sign ahead"), 0);
  assert.equal(signScore("stop", "R7-107No parking, bus stop"), 0);
  assert.equal(signScore("stop", "No stopping"), 0);
  assert.equal(signScore("stop", "StopAlt. A"), 1);
  assert.equal(signScore("stop", "Stop", "Old_stop.svg"), 1.5);
  assert.equal(signScore("stop", "Stop", "x.svg", "Historic signs / 1955 road signs"), 0);
  assert.equal(signScore("stop", "Ρ-2Stop", "x.svg", "Categorization / Temporary signs"), 0);
  assert.equal(signScore("pedestrian", "State law yield to pedestrians in crosswalk"), 0);
  assert.equal(signScore("chevron", "Sharp curve to the left"), 0);
  assert.equal(signScore("warning", "A32Other dangers"), 2);
});

test("checkRoadSigns accepts a good set and names what is wrong with a bad one", () => {
  const codes = new Set(streetView);
  const good = { DE: { stop: sign("DE", "stop", "Zeichen_206.svg") } };
  const files = new Map([["de-stop.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>']]);
  assert.deepEqual(checkRoadSigns(good, files, codes), []);

  const bad = { DE: { stop: { ...good.DE.stop, file: "../x.svg" }, flag: good.DE.stop } };
  const evil = new Map([
    ["de-stop.svg", "<svg onload='alert(1)'/>"],
    ["zz-extra.svg", "<svg/>"],
  ]);
  const problems = checkRoadSigns(bad, evil, codes).join("\n");
  assert.match(problems, /DE stop: file name/);
  assert.match(problems, /DE flag: unknown sign/);
  assert.match(problems, /event handler/);
  assert.match(problems, /zz-extra.svg: not in signs.json/);
});

test("roads.json covers every Street View country, with sources", () => {
  assert.deepEqual(Object.keys(roads.countries).sort(), [...streetView].sort());
  for (const [code, r] of Object.entries(roads.countries)) {
    assert.ok(["left", "right"].includes(r.drive), code);
    assert.ok(roads.sources[r.driveSource], `${code}: driving side source`);
    if (r.centre) {
      assert.ok(["white", "yellow", "both"].includes(r.centre.colour), code);
      assert.ok(roads.sources[r.centre.source], `${code}: line source`);
      assert.ok(r.centre.note.length > 10, code);
    }
  }
  for (const s of Object.values(roads.sources)) assert.match(s.url, /^https:\/\//);
  assert.equal(data.countries.length, streetView.length);
  assert.equal(data.byCode.JP.drive, "left");
  assert.equal(data.byCode.US.centre.colour, "yellow");
});

test("makeRoadData drops drawings with an unexpected file name", () => {
  const odd = { DE: { stop: { ...signs.DE.stop, file: "../../index.html" } } };
  assert.equal(hasClue(makeRoadData(roads, odd, countryText).byCode.DE, "stop"), false);
});

test("progress keys are distinct per clue and read back", () => {
  const keys = Object.keys(CLUES).map((clue) => keyOf({ clue, code: "JP" }));
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(itemOfKey("s:JP"), { clue: "stop", code: "JP" });
  assert.deepEqual(itemOfKey("x:DE"), { clue: "scene", code: "DE" });
  assert.equal(itemOfKey("q:DE"), null);
});

test("cleanClues keeps known clues in order, and falls back to all", () => {
  assert.deepEqual(cleanClues(["stop", "side", "nonsense"]), ["side", "stop"]);
  assert.deepEqual(cleanClues([]), Object.keys(CLUES));
});

test("a drill asks only about the clues picked", () => {
  const pool = poolFor(data, "clue", ["stop"]);
  assert.ok(pool.every((it) => it.clue === "stop"));
  assert.equal(pool.length, Object.keys(signs).length);
  assert.equal(poolFor(data, "clue", ["side"]).length, streetView.length);
  // A scene needs a clue besides the driving side.
  assert.equal(poolFor(data, "scene", ["side"]).length, 0);
  assert.ok(poolFor(data, "scene", ["side", "stop"]).every((it) => signs[it.code]));
  assert.ok(DRILLS.scene && DRILLS.clue);
});

test("driving side and line questions offer the right choices", () => {
  const side = new RoadQuestion({ clue: "side", code: "JP" }, data);
  assert.deepEqual(
    side.options().map((o) => [o.label, o.correct]),
    [
      ["On the left", true],
      ["On the right", false],
    ],
  );
  const lines = new RoadQuestion({ clue: "lines", code: "US" }, data);
  assert.equal(lines.options().find((o) => o.correct).label, "Yellow");
});

test("a sign's wrong options never share its drawing or each other's", () => {
  for (let i = 0; i < 30; i++) {
    const q = new RoadQuestion({ clue: "stop", code: "DE" }, data, { hard: i % 2 === 0 });
    const options = q.options();
    assert.equal(options.filter((o) => o.correct).length, 1);
    // Austria uses the same drawing as Germany, so it is never a wrong option.
    assert.ok(!options.some((o) => o.label === "Austria"));
    const files = options.map(
      (o) => data.countries.find((c) => c.name === o.label).signs.stop.commons,
    );
    assert.equal(new Set(files).size, files.length);
  }
});

test("a scene's wrong options differ in something it shows", () => {
  const clues = ["side", "stop", "warning"];
  for (let i = 0; i < 30; i++) {
    const q = new RoadQuestion({ clue: "scene", code: "JP" }, data, { clues });
    assert.deepEqual(q.shows, clues);
    for (const o of q.options().filter((x) => !x.correct)) {
      const c = data.countries.find((x) => x.name === o.label);
      assert.ok(
        clues.every((k) => hasClue(c, k)),
        o.label,
      );
    }
  }
});
