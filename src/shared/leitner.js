/**
 * Spaced repetition: a five-box Leitner system.
 *
 * Every item a learner is asked about has a record of four integers:
 *
 *     [box, dueDay, tries, wrong]
 *
 * A right answer moves the item up one box; a wrong one sends it back to
 * box 1. The box decides how many days pass before it comes round again
 * ({@link BOXES}). Box 1 waits zero days, so something just missed is due
 * at once — in this session and the next.
 *
 * Records live in localStorage under one key per app, keyed by a string
 * that each app derives from the item (see each app's `keyOf`). Those keys
 * and the record format are what users' saved progress is made of, so they
 * must not change.
 *
 * @module shared/leitner
 */
import { storage } from "./storage.js";
import { randomInt, shuffle } from "./random.js";

/** Days until an item is due again, indexed by box − 1. */
export const BOXES = [0, 2, 5, 12, 30];

/** Items in this box or higher count as "known well". */
export const KNOWN_BOX = 4;

/** Days since 1970-01-01 (UTC). Due dates are whole days, not timestamps. */
export const dayNumber = (ms = Date.now()) => Math.floor(ms / 864e5);

/**
 * A record read from storage or an import, or null if it is malformed.
 * @param {unknown} value
 * @returns {[number, number, number, number] | null}
 */
export function cleanRecord(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const rec = value.map((x) => (Number.isInteger(x) ? x : 0));
  if (rec[0] < 1 || rec[0] > BOXES.length) return null;
  // Bring the numbers into a range real answers can produce, so a doctored
  // record cannot push an item out of reach for centuries or skew the
  // totals. Day 100000 is in the year 2243.
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  rec[1] = clamp(rec[1], 0, 100000);
  rec[2] = clamp(rec[2], 0, 1e6);
  rec[3] = clamp(rec[3], 0, rec[2]);
  return rec;
}

/**
 * Read and validate a stored set of records without loading it into a
 * store, for pages that only summarise progress (the landing page).
 * @param {object} raw a parsed storage object
 * @param {number} maxKeyLength
 * @returns {Map<string, number[]>}
 */
export function cleanRecords(raw, maxKeyLength = 90) {
  const out = new Map();
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    if (key.length > maxKeyLength) continue;
    const rec = cleanRecord(value);
    if (rec) out.set(key, rec);
  }
  return out;
}

/**
 * One app's progress records, kept in memory and written back to
 * localStorage shortly after each change.
 */
export class ProgressStore {
  /**
   * @param {object} options
   * @param {string} options.storageKey localStorage key, e.g. "cityatlas.progress.v1"
   * @param {string} options.app identifies exports, so one app refuses another's
   * @param {number} [options.maxKeyLength] longer keys are ignored as junk
   * @param {() => number} [options.today] current day number; tests replace it
   * @param {typeof storage} [options.store] tests pass an in-memory stand-in
   */
  constructor({ storageKey, app, maxKeyLength = 90, today = () => dayNumber(), store = storage }) {
    this.storageKey = storageKey;
    this.app = app;
    this.maxKeyLength = maxKeyLength;
    this.today = today;
    this.store = store;
    /** @type {Map<string, number[]>} */
    this.records = cleanRecords(store.object(storageKey), maxKeyLength);
    this.timer = 0;
    this.dirty = false;
    /** The last save failed (storage full or blocked); the progress screen says so. */
    this.saveFailed = false;

    // Write any pending change before the page goes away. `pagehide` and a
    // hidden tab cover mobile browsers, which may never fire `beforeunload`.
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => this.flush());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.flush();
      });
    }
  }

  /** @returns {number[] | undefined} */
  get(key) {
    return this.records.get(key);
  }

  /** Never answered. */
  isNew(key) {
    return !this.records.has(key);
  }

  /** New, or reached its due day. */
  isDue(key) {
    const rec = this.records.get(key);
    return !rec || rec[1] <= this.today();
  }

  /** Answered before and due again: the items a review should cover. */
  isDueReview(key) {
    const rec = this.records.get(key);
    return Boolean(rec) && rec[1] <= this.today();
  }

  /** The item's box, or 0 if it has never been answered. */
  box(key) {
    return this.records.get(key)?.[0] ?? 0;
  }

  /** Apply one answer. */
  record(key, ok) {
    const rec = this.records.get(key) ?? [1, 0, 0, 0];
    rec[0] = ok ? Math.min(BOXES.length, rec[0] + 1) : 1;
    rec[1] = this.today() + BOXES[rec[0] - 1];
    rec[2] += 1;
    if (!ok) rec[3] += 1;
    this.records.set(key, rec);
    this.scheduleSave();
  }

  /** Save soon, batching a burst of answers into one write. */
  scheduleSave() {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  /**
   * Save now if anything changed. If the write fails, the changes stay
   * marked as unsaved, so the next answer or leaving the page tries again.
   */
  flush() {
    clearTimeout(this.timer);
    if (!this.dirty) return;
    const saved = this.store.set(this.storageKey, JSON.stringify(Object.fromEntries(this.records)));
    this.saveFailed = !saved;
    if (saved) this.dirty = false;
  }

  /** Forget everything. */
  erase() {
    clearTimeout(this.timer);
    this.records.clear();
    this.dirty = false;
    this.store.remove(this.storageKey);
  }

  /**
   * Totals over a set of item keys.
   * @param {Iterable<string>} keys
   */
  stats(keys) {
    const s = { total: 0, seen: 0, learned: 0, due: 0, tries: 0, wrong: 0 };
    const today = this.today();
    for (const key of keys) {
      s.total++;
      const rec = this.records.get(key);
      if (!rec) continue;
      s.seen++;
      s.tries += rec[2];
      s.wrong += rec[3];
      if (rec[0] >= KNOWN_BOX) s.learned++;
      if (rec[1] <= today) s.due++;
    }
    return s;
  }

  /**
   * How many of these items sit in each box, as [box1, …, box5].
   * @param {Iterable<string>} keys
   */
  perBox(keys) {
    const counts = BOXES.map(() => 0);
    for (const key of keys) {
      const box = this.box(key);
      if (box) counts[box - 1]++;
    }
    return counts;
  }

  /**
   * Items answered wrongly at least twice and at least a third of the time,
   * worst first.
   * @param {Iterable<string>} keys
   * @returns {{ key: string, wrong: number, tries: number }[]}
   */
  troublesome(keys) {
    const out = [];
    for (const key of keys) {
      const rec = this.records.get(key);
      if (rec && rec[3] >= 2 && rec[3] / Math.max(1, rec[2]) >= 0.34) {
        out.push({ key, wrong: rec[3], tries: rec[2] });
      }
    }
    return out.sort((a, b) => b.wrong / b.tries - a.wrong / a.tries || b.wrong - a.wrong);
  }

  /** Everything, as text the learner can copy to another device. */
  exportText() {
    return JSON.stringify({
      app: this.app,
      v: 1,
      at: new Date().toISOString().slice(0, 10),
      p: Object.fromEntries(this.records),
    });
  }

  /**
   * Merge an export into the current records. Where both sides know an
   * item, the record further along wins: higher box, then later due day.
   * @param {string} text
   * @returns {{ ok: true, added: number, updated: number } | { ok: false, error: "json" | "app" }}
   */
  importText(text) {
    let data;
    try {
      data = JSON.parse(String(text).slice(0, 4e6));
    } catch {
      return { ok: false, error: "json" };
    }
    if (
      !data ||
      data.app !== this.app ||
      !data.p ||
      typeof data.p !== "object" ||
      Array.isArray(data.p)
    ) {
      return { ok: false, error: "app" };
    }
    let added = 0;
    let updated = 0;
    for (const [key, rec] of cleanRecords(data.p, this.maxKeyLength)) {
      const cur = this.records.get(key);
      if (!cur) {
        this.records.set(key, rec);
        added++;
      } else if (rec[0] > cur[0] || (rec[0] === cur[0] && rec[1] > cur[1])) {
        this.records.set(key, rec);
        updated++;
      }
    }
    this.dirty = true;
    this.flush();
    return { ok: true, added, updated };
  }
}

/**
 * Plan a drill session.
 *
 * About seven in ten questions are reviews of what is due and the rest are
 * new, so consolidation and progress happen together. If there are not
 * enough new items, the rest of what is due goes in next, and only then
 * items that are not due yet.
 *
 * @template T
 * @param {T[]} items everything the session may draw on
 * @param {(item: T) => string} keyOf the item's progress key
 * @param {ProgressStore} store
 * @param {object} options
 * @param {number} options.length questions wanted; 0 means "keep going" (up to 100 planned)
 * @param {boolean} [options.dueOnly] review only what is due
 * @returns {T[]}
 */
export function planSession(items, keyOf, store, { length, dueOnly = false }) {
  const due = shuffle(items.filter((it) => store.isDueReview(keyOf(it))));
  const fresh = shuffle(items.filter((it) => store.isNew(keyOf(it))));
  const rest = shuffle(items.filter((it) => !store.isNew(keyOf(it)) && !store.isDue(keyOf(it))));
  const n = length || Math.min(items.length, 100);

  let queue;
  if (dueOnly) {
    queue = due.slice(0, length || due.length);
  } else {
    const dueShare = Math.min(due.length, Math.round(n * 0.7));
    queue = [...due.slice(0, dueShare), ...fresh.slice(0, n - dueShare)];
    if (queue.length < n) queue.push(...due.slice(dueShare), ...rest);
    queue = shuffle(queue.slice(0, n));
  }
  return queue.length ? queue : shuffle(items.slice()).slice(0, n);
}

/**
 * A picker for open-ended quizzes that ask one question at a time: mostly
 * what is due, otherwise something new, otherwise anything. It remembers the
 * last few items so the same one does not come straight back.
 *
 * @template T
 * @param {ProgressStore} store
 * @param {(item: T) => string} keyOf
 */
export function createPicker(store, keyOf) {
  const recent = [];
  return {
    /** @param {T[]} items a non-empty pool */
    next(items) {
      const unseen = (it) => !recent.includes(keyOf(it));
      const fresh = items.filter((it) => unseen(it) && store.isNew(keyOf(it)));
      const due = items.filter((it) => unseen(it) && store.isDueReview(keyOf(it)));
      const rest = items.filter(unseen);
      let from;
      if (due.length && fresh.length) from = randomInt(10) < 7 ? due : fresh;
      else from = due.length ? due : fresh.length ? fresh : rest.length ? rest : items;
      const item = from[randomInt(from.length)];
      recent.unshift(keyOf(item));
      recent.length = Math.min(
        recent.length,
        Math.max(1, Math.min(12, Math.floor(items.length / 2))),
      );
      return item;
    },
    /** Forget the recent memory, e.g. after progress is erased. */
    reset() {
      recent.length = 0;
    },
  };
}

/** How many of these items are due for review. */
export const dueCount = (items, keyOf, store) =>
  items.reduce((n, it) => n + (store.isDueReview(keyOf(it)) ? 1 : 0), 0);
