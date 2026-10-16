// The flags' colour codes: reading the measured file, and the checker that
// guards it before the workflow commits it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { flagColours, parseFlagColours } from "../../src/flags/design.js";
import { FLAG_COLOUR_LINE, checkFlagColours } from "../../tools/data/check-flag-colours.mjs";

const SAMPLE = [
  "# a comment",
  "DE\tFlag_of_Germany.svg\t#000000 #DD0000 #FFCE00",
  "FR\tFlag_of_France.svg\t#FFFFFF #002654 #ED2939",
  "XX\tbroken line",
  "",
].join("\n");

test("parseFlagColours reads code and colours, and skips what does not fit", () => {
  const colours = parseFlagColours(SAMPLE);
  assert.deepEqual(colours.get("DE"), ["#000000", "#DD0000", "#FFCE00"]);
  assert.equal(colours.size, 2);
  assert.deepEqual(parseFlagColours("DE\tf.svg\t#dd0000 red <b>"), new Map());
});

test("the French territories show France's colours", () => {
  const colours = parseFlagColours(SAMPLE);
  assert.deepEqual(flagColours("GP", colours), colours.get("FR"));
  assert.deepEqual(flagColours("ZZ", colours), []);
});

test("the checker accepts a measured line and refuses anything else", () => {
  assert.ok(FLAG_COLOUR_LINE.test("GB-SCT\tFlag_of_Scotland.svg\t#005EB8 #FFFFFF"));
  for (const bad of [
    "DE\tFlag_of_Germany.svg\t",
    "DE\tFlag_of_Germany.png\t#000000",
    "DE\tFlag_of_<b>.svg\t#000000",
    "de\tFlag_of_Germany.svg\t#000000",
    "DE\tFlag_of_Germany.svg\t#00000",
    `DE\tFlag_of_Germany.svg\t${Array(9).fill("#000000").join(" ")}`,
  ]) {
    assert.ok(!FLAG_COLOUR_LINE.test(bad), bad);
  }
});

test("the checker finds unknown codes, repeats and a run that measured too little", () => {
  const line = (c) => `${c}\tFlag.svg\t#000000`;
  const codes = new Set(["DE", "FR"]);
  const problems = checkFlagColours([line("DE"), line("DE"), line("QQ")].join("\n"), codes);
  assert.ok(problems.some((p) => p.includes("DE appears twice")));
  assert.ok(problems.some((p) => p.includes("QQ is not in countries.txt")));
  assert.ok(problems.some((p) => p.includes("only 3 flags")));
});
