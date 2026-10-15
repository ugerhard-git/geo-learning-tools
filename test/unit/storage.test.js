import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { isFreshTime, shortString, storage, ttlCache } from "../../src/shared/storage.js";

/** A minimal localStorage, installed fresh for each test. */
beforeEach(() => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
});

test("storage never throws, even when localStorage does", () => {
  globalThis.localStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("full");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(storage.get("k"), null);
  assert.equal(storage.set("k", "v"), false);
  storage.remove("k");
  assert.equal(storage.object("k"), null);
});

test("storage.object reads objects only", () => {
  storage.set("a", '{"x":1}');
  storage.set("b", "[1,2]");
  storage.set("c", "not json");
  assert.deepEqual(storage.object("a"), { x: 1 });
  assert.equal(storage.object("b"), null);
  assert.equal(storage.object("c"), null);
});

test("ttlCache returns fresh entries and validates what it reads back", () => {
  const isValid = (v) => typeof v?.n === "number";
  const cache = ttlCache("cache", 1000, 10, isValid);
  cache.put("a", { n: 1 });
  assert.deepEqual(cache.get("a"), { n: 1 });

  // Something else on the origin rewrites the stored cache.
  storage.set("cache", JSON.stringify({ b: { t: Date.now(), v: { n: "evil" } } }));
  const reread = ttlCache("cache", 1000, 10, isValid);
  assert.equal(reread.get("b"), null);
});

test("ttlCache forgets stale entries and keeps at most `max`", () => {
  const cache = ttlCache("cache", 1000, 3, () => true);
  storage.set("cache", JSON.stringify({ old: { t: Date.now() - 5000, v: 1 } }));
  for (const k of ["a", "b", "c", "d"]) cache.put(k, k);
  const stored = storage.object("cache");
  assert.deepEqual(Object.keys(stored).sort(), ["b", "c", "d"]);
  cache.clear();
  assert.equal(storage.get("cache"), null);
});

test("ttlCache ignores entries dated in the future, which would never expire", () => {
  storage.set("cache", JSON.stringify({ a: { t: Date.now() + 864e5 * 365, v: 1 } }));
  assert.equal(ttlCache("cache", 1000, 10, () => true).get("a"), null);
  assert.ok(isFreshTime(Date.now() - 10, Date.now(), 1000));
  assert.ok(!isFreshTime(Date.now() + 10_000, Date.now(), 1000));
  assert.ok(!isFreshTime("0", Date.now(), 1000));
});

test("shortString caps the length of cached text", () => {
  assert.ok(shortString("abc", 3));
  assert.ok(!shortString("abcd", 3));
  assert.ok(!shortString(7, 3));
});
