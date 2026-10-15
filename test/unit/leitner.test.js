import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOXES,
  ProgressStore,
  cleanRecord,
  createPicker,
  dueCount,
  planSession,
} from "../../src/shared/leitner.js";

/** An in-memory stand-in for the storage module. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => (data.set(k, v), true),
    remove: (k) => data.delete(k),
    object(k) {
      try {
        const v = JSON.parse(data.get(k));
        return v && typeof v === "object" && !Array.isArray(v) ? v : null;
      } catch {
        return null;
      }
    },
  };
}

function makeStore({ day = 100, records = {} } = {}) {
  const store = memoryStorage({ "test.progress": records });
  const clock = { day };
  const progress = new ProgressStore({
    storageKey: "test.progress",
    app: "test",
    today: () => clock.day,
    store,
  });
  return { progress, store, clock };
}

test("a right answer climbs one box and is due after that box's interval", () => {
  const { progress } = makeStore();
  progress.record("a", true);
  assert.deepEqual(progress.get("a"), [2, 100 + BOXES[1], 1, 0]);
  progress.record("a", true);
  progress.record("a", true);
  progress.record("a", true);
  progress.record("a", true); // box 5 is the top
  assert.equal(progress.box("a"), 5);
  assert.deepEqual(progress.get("a"), [5, 100 + BOXES[4], 5, 0]);
});

test("a wrong answer drops to box 1, due straight away", () => {
  const { progress } = makeStore();
  progress.record("a", true);
  progress.record("a", true);
  progress.record("a", false);
  assert.deepEqual(progress.get("a"), [1, 100, 3, 1]);
  assert.equal(progress.isDueReview("a"), true);
});

test("new, due and not-yet-due are told apart", () => {
  const { progress, clock } = makeStore();
  progress.record("seen", true); // box 2, due on day 102
  assert.equal(progress.isNew("never"), true);
  assert.equal(progress.isDue("never"), true);
  assert.equal(progress.isDueReview("never"), false);
  assert.equal(progress.isDueReview("seen"), false);
  clock.day = 102;
  assert.equal(progress.isDueReview("seen"), true);
});

test("records are saved, and junk in storage is ignored on load", () => {
  const { progress, store } = makeStore({
    records: {
      good: [3, 90, 4, 1],
      wrongLength: [1, 2, 3],
      badBox: [9, 0, 0, 0],
      notArray: "x",
      ["k".repeat(200)]: [1, 0, 0, 0],
      floats: [2, 1.5, "x", null],
    },
  });
  assert.deepEqual([...progress.records.keys()].sort(), ["floats", "good"]);
  assert.deepEqual(progress.get("floats"), [2, 0, 0, 0]);
  progress.record("good", true);
  progress.flush();
  assert.deepEqual(JSON.parse(store.data.get("test.progress")).good, [4, 112, 5, 1]);
});

test("cleanRecord rejects anything that is not four integers with a valid box", () => {
  assert.deepEqual(cleanRecord([1, 0, 0, 0]), [1, 0, 0, 0]);
  assert.equal(cleanRecord([0, 0, 0, 0]), null);
  assert.equal(cleanRecord([6, 0, 0, 0]), null);
  assert.equal(cleanRecord({ 0: 1, 1: 0, 2: 0, 3: 0, length: 4 }), null);
});

test("cleanRecord brings doctored numbers into range", () => {
  assert.deepEqual(cleanRecord([2, 1e12, -5, 3]), [2, 100000, 0, 0]);
  assert.deepEqual(cleanRecord([2, 10, 4, 9]), [2, 10, 4, 4]);
  assert.deepEqual(cleanRecord([2, 10, 1e9, 2]), [2, 10, 1e6, 2]);
});

test("a failed save keeps the changes pending and is reported", () => {
  const { progress, store } = makeStore();
  store.set = () => false;
  progress.record("x", true);
  progress.flush();
  assert.equal(progress.saveFailed, true);
  assert.equal(progress.dirty, true);

  store.set = (k, v) => (store.data.set(k, v), true);
  progress.flush();
  assert.equal(progress.saveFailed, false);
  assert.ok(store.object("test.progress").x);
});

test("stats, perBox and troublesome summarise a set of items", () => {
  const { progress } = makeStore({
    records: { a: [4, 50, 6, 1], b: [1, 100, 5, 4], c: [2, 200, 1, 0] },
  });
  assert.deepEqual(progress.stats(["a", "b", "c", "d"]), {
    total: 4,
    seen: 3,
    learned: 1,
    due: 2,
    tries: 12,
    wrong: 5,
  });
  assert.deepEqual(progress.perBox(["a", "b", "c", "d"]), [1, 1, 0, 1, 0]);
  assert.deepEqual(progress.troublesome(["a", "b", "c"]), [{ key: "b", wrong: 4, tries: 5 }]);
});

test("export and import round-trip, and the record further along wins", () => {
  const { progress: from } = makeStore({ records: { a: [3, 90, 3, 0], b: [1, 80, 2, 2] } });
  const { progress: to } = makeStore({ records: { a: [2, 99, 2, 0], b: [4, 70, 9, 1] } });
  const result = to.importText(from.exportText());
  assert.deepEqual(result, { ok: true, added: 0, updated: 1 });
  assert.deepEqual(to.get("a"), [3, 90, 3, 0]); // higher box wins
  assert.deepEqual(to.get("b"), [4, 70, 9, 1]); // kept: already further along
});

test("import refuses bad JSON and other apps' exports", () => {
  const { progress } = makeStore();
  assert.deepEqual(progress.importText("not json"), { ok: false, error: "json" });
  assert.deepEqual(progress.importText(JSON.stringify({ app: "other", p: {} })), {
    ok: false,
    error: "app",
  });
  assert.deepEqual(progress.importText(JSON.stringify({ app: "test", p: [] })), {
    ok: false,
    error: "app",
  });
});

test("erase forgets everything, in memory and in storage", () => {
  const { progress, store } = makeStore({ records: { a: [3, 90, 3, 0] } });
  progress.erase();
  assert.equal(progress.records.size, 0);
  assert.equal(store.data.has("test.progress"), false);
});

const items = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const id = (x) => x;

test("planSession mixes roughly 70% reviews with new items", () => {
  const due = items("due", 30);
  const fresh = items("new", 30);
  const records = Object.fromEntries(due.map((k) => [k, [1, 90, 1, 1]]));
  const { progress } = makeStore({ records });
  const queue = planSession([...due, ...fresh], id, progress, { length: 20 });
  assert.equal(queue.length, 20);
  assert.equal(queue.filter((k) => k.startsWith("due")).length, 14);
  assert.equal(queue.filter((k) => k.startsWith("new")).length, 6);
});

test("planSession prefers more reviews over items that are not due", () => {
  // Plenty due, nothing new, plenty not due yet. The queue must fill with
  // what is due before reaching for anything that is not.
  const due = items("due", 30);
  const later = items("later", 30);
  const records = {
    ...Object.fromEntries(due.map((k) => [k, [1, 90, 1, 1]])),
    ...Object.fromEntries(later.map((k) => [k, [3, 200, 2, 0]])),
  };
  const { progress } = makeStore({ records });
  const queue = planSession([...due, ...later], id, progress, { length: 20 });
  assert.equal(queue.length, 20);
  assert.equal(queue.filter((k) => k.startsWith("due")).length, 20);
});

test("planSession can review only what is due", () => {
  const records = { a: [1, 90, 1, 1], b: [2, 95, 1, 0], c: [3, 300, 2, 0] };
  const { progress } = makeStore({ records });
  const queue = planSession(["a", "b", "c", "d"], id, progress, { length: 10, dueOnly: true });
  assert.deepEqual(queue.sort(), ["a", "b"]);
});

test("planSession with length 0 plans up to 100 questions", () => {
  const { progress } = makeStore();
  assert.equal(planSession(items("x", 250), id, progress, { length: 0 }).length, 100);
  assert.equal(planSession(items("x", 40), id, progress, { length: 0 }).length, 40);
});

test("the picker avoids repeating what it just asked", () => {
  const { progress } = makeStore();
  const picker = createPicker(progress, id);
  const pool = items("x", 30);
  const asked = Array.from({ length: 12 }, () => picker.next(pool));
  assert.equal(new Set(asked).size, 12);
});

test("dueCount counts reviews only, not new items", () => {
  const { progress } = makeStore({ records: { a: [1, 90, 1, 1], b: [2, 300, 1, 0] } });
  assert.equal(dueCount(["a", "b", "c"], id, progress), 1);
});
