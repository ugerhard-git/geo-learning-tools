import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanLength, nearbyDistractors } from "../../src/shared/drill.js";

test("a stored session length is used only if it is one on offer", () => {
  assert.equal(cleanLength("10"), 10);
  assert.equal(cleanLength("0"), 0); // keep going
  assert.equal(cleanLength(null), 20); // nothing stored is not "keep going"
  assert.equal(cleanLength("15"), 20);
  assert.equal(cleanLength("__proto__"), 20);
});

test("distractors are the nearest items, each label once, and never a taken label", () => {
  const items = [
    { name: "A", d: 1 },
    { name: "A", d: 2 }, // a duplicate label
    { name: "B", d: 3 },
    { name: "C", d: 4 },
    { name: "Right", d: 5 },
    { name: "D", d: 50 },
  ];
  const picked = nearbyDistractors(
    items,
    (o) => o.d,
    (o) => o.name,
    new Set(["Right"]),
    2,
  );
  assert.equal(picked.length, 2);
  const names = picked.map((o) => o.name);
  assert.equal(new Set(names).size, 2);
  assert.ok(!names.includes("Right"));
  // Drawn from the nearest 2 × 3 distinct labels: A, B, C, D.
  assert.ok(names.every((n) => ["A", "B", "C", "D"].includes(n)));
});
