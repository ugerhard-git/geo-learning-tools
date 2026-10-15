/**
 * Random choices, drawn from the platform's cryptographic generator so that
 * question order cannot be predicted from earlier questions.
 * @module shared/random
 */

/** A random integer from 0 to n - 1. */
export function randomInt(n) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

/** Shuffle an array in place (Fisher–Yates) and return it. */
export function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** One element of a non-empty array, chosen at random. */
export const pickOne = (list) => list[randomInt(list.length)];
