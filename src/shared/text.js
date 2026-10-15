/**
 * Matching what a learner types against the names of places.
 * @module shared/text
 */

/** Lower-case and strip accents, so "Réunion" and "reunion" compare equal. */
export const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The key two names are compared by. Case, accents, punctuation and spacing
 * are ignored; "&" reads as "and"; "the" is dropped; and the abbreviations
 * St/Saint and Mt/Mount count as the same word.
 *
 *     answerKey("St. Kitts & Nevis") === answerKey("Saint Kitts and Nevis")
 *     answerKey("The Gambia") === answerKey("Gambia")
 *
 * @param {string} s
 * @returns {string}
 */
export function answerKey(s) {
  return norm(s)
    .replace(/&/g, " and ")
    .replace(/\bsaint\b|\bst\b\.?/g, "st")
    .replace(/\bmount\b|\bmt\b\.?/g, "mount")
    .replace(/\bthe\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Levenshtein distance between two strings.
 *
 * Strings whose lengths differ by more than two are reported as 3 without
 * being compared: no caller accepts more than two edits, so the exact figure
 * would never be used.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, substitution);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * How many typing mistakes a name may carry and still count: none for short
 * names, where one wrong letter often makes a different word.
 *
 * @param {string} key an answerKey()
 */
export const typoAllowance = (key) => (key.length >= 10 ? 2 : key.length >= 5 ? 1 : 0);

/**
 * @typedef {{ ok: true, typo?: true } | { ok: false, other?: unknown }} Verdict
 */

/**
 * Judge a typed answer.
 *
 * In order: an exact match with an accepted name is right; an exact match
 * with the name of something *else* in play is wrong, and says what that was;
 * a near miss on an accepted name is right, but flagged as a typo.
 *
 * @param {string} input what was typed
 * @param {string[]} accepted every name that counts as right
 * @param {(key: string) => unknown} [otherNamed] given an answerKey, return
 *   the other item it exactly names, if any
 * @returns {Verdict | null} null when there was nothing to judge
 */
export function judgeTyped(input, accepted, otherNamed) {
  const key = answerKey(String(input).slice(0, 60));
  if (!key) return null;
  const own = accepted.map(answerKey).filter(Boolean);
  if (own.includes(key)) return { ok: true };
  const other = otherNamed?.(key);
  if (other) return { ok: false, other };
  if (own.some((name) => editDistance(key, name) <= typoAllowance(name))) {
    return { ok: true, typo: true };
  }
  return { ok: false };
}
