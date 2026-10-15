import { test } from "node:test";
import assert from "node:assert/strict";
import { answerKey, editDistance, judgeTyped, norm, typoAllowance } from "../../src/shared/text.js";

test("norm strips accents and case", () => {
  assert.equal(norm("Réunion"), "reunion");
  assert.equal(norm("SÃO TOMÉ"), "sao tome");
});

test("answerKey treats common spellings as the same answer", () => {
  const same = [
    ["St. Kitts & Nevis", "Saint Kitts and Nevis"],
    ["The Gambia", "Gambia"],
    ["Côte d'Ivoire", "cote divoire"],
    ["Mt Everest", "Mount Everest"],
    ["  São  Tomé ", "sao tome"],
  ];
  for (const [a, b] of same) assert.equal(answerKey(a), answerKey(b), `${a} ≟ ${b}`);
  assert.notEqual(answerKey("Niger"), answerKey("Nigeria"));
});

test("editDistance counts insertions, deletions and substitutions", () => {
  assert.equal(editDistance("kitten", "sitten"), 1);
  assert.equal(editDistance("kitten", "kitte"), 1);
  assert.equal(editDistance("abc", "abc"), 0);
  // lengths more than two apart are not worth comparing
  assert.equal(editDistance("a", "abcdef"), 3);
});

test("typo allowance grows with the length of the name", () => {
  assert.equal(typoAllowance("chad"), 0);
  assert.equal(typoAllowance("france"), 1);
  assert.equal(typoAllowance("mozambique"), 2);
});

test("judgeTyped: exact, other, typo, wrong and empty", () => {
  const others = new Map([[answerKey("Niger"), "NE"]]);
  const judge = (input) => judgeTyped(input, ["Nigeria"], (k) => others.get(k));
  assert.deepEqual(judge("nigeria"), { ok: true });
  assert.deepEqual(judge("Niger"), { ok: false, other: "NE" });
  assert.deepEqual(judge("Nigera"), { ok: true, typo: true });
  assert.deepEqual(judge("Ghana"), { ok: false });
  assert.equal(judge("   "), null);
});

test("judgeTyped will not stretch a short name to a different word", () => {
  // "Chad" allows no typos, so "Chas" must be wrong rather than a typo
  assert.deepEqual(judgeTyped("Chas", ["Chad"]), { ok: false });
});

test("judgeTyped only reads the first 60 characters", () => {
  assert.deepEqual(judgeTyped("Chad" + " ".repeat(200) + "x", ["Chad"]), { ok: true });
});
