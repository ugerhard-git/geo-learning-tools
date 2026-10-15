/**
 * localStorage that never throws.
 *
 * Storage can be missing altogether (some private-browsing modes, blocked
 * site data) or full. The apps then simply forget between visits instead of
 * failing to start.
 *
 * Treat everything read back as untrusted. On GitHub Pages every project
 * site of the same account shares one origin, `<account>.github.io`, and so
 * one localStorage: any of those sites can read and write these keys.
 * Callers validate what they load.
 *
 * @module shared/storage
 */

export const storage = {
  /** @returns {string | null} */
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  /** @returns {boolean} whether the value was stored */
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing stored, nothing to remove.
    }
  },

  /**
   * A stored JSON object. Anything else — missing, unparseable, an array or
   * a primitive — reads as null.
   * @returns {Record<string, unknown> | null}
   */
  object(key) {
    try {
      const value = JSON.parse(this.get(key));
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  },
};

/**
 * A small time-limited cache in localStorage, for answers fetched from other
 * services that are slow to change. Entries older than `ttl` are ignored and
 * pruned; past `max` entries the oldest are dropped.
 *
 * @param {string} key storage key the whole cache lives under
 * @param {number} ttl lifetime of an entry, in milliseconds
 * @param {number} max most entries kept
 * @param {(value: unknown) => boolean} isValid shape check for an entry read
 *   back from storage, which anything on the same origin can have rewritten
 */
export function ttlCache(key, ttl, max, isValid) {
  const memory = new Map();
  const fresh = (entry, now) =>
    entry && typeof entry.t === "number" && now - entry.t < ttl && isValid(entry.v);

  return {
    get(id) {
      if (memory.has(id)) return memory.get(id);
      const entry = storage.object(key)?.[id];
      if (!fresh(entry, Date.now())) return null;
      memory.set(id, entry.v);
      return entry.v;
    },

    put(id, value) {
      memory.set(id, value);
      const now = Date.now();
      const all = storage.object(key) ?? {};
      for (const [k, entry] of Object.entries(all)) if (!fresh(entry, now)) delete all[k];
      all[id] = { t: now, v: value };
      const byAge = Object.keys(all).sort((a, b) => all[a].t - all[b].t);
      while (byAge.length > max) delete all[byAge.shift()];
      storage.set(key, JSON.stringify(all));
    },

    clear() {
      memory.clear();
      storage.remove(key);
    },
  };
}
