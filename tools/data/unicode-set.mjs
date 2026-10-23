// Reading CLDR's exemplar character sets, the lists of letters each language
// uses. Adapted from the Alphabets app in the Geo Clue Apps project
// (apps/alphabets/unicode.js), which has the same owner.
//
// Used by tools/data/languages.mjs; tested in test/unit/languages.test.js.

/** A ceiling on one set: CJK sets are written as huge ranges. */
const MAX_SET = 8000;

/**
 * Read one character, or one backslash escape, of a set.
 * @param {string} s
 * @param {number} i
 * @returns {{ ch: string, next: number }}
 */
function readAtom(s, i) {
  if (s[i] === "\\") {
    const n = s[i + 1];
    if (n === "u" && /^[0-9a-f]{4}$/i.test(s.slice(i + 2, i + 6))) {
      return { ch: String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)), next: i + 6 };
    }
    if (n === "U" && /^[0-9a-f]{8}$/i.test(s.slice(i + 2, i + 10))) {
      return { ch: String.fromCodePoint(parseInt(s.slice(i + 2, i + 10), 16)), next: i + 10 };
    }
    return { ch: n === undefined ? "\\" : n, next: i + 2 };
  }
  const ch = String.fromCodePoint(/** @type {number} */ (s.codePointAt(i)));
  return { ch, next: i + ch.length };
}

/**
 * Parse a CLDR exemplar set.
 *
 * CLDR writes them as "[a á b c-f {ch} \-]": space separated, with ranges,
 * brace-wrapped letters of more than one character, backslash escapes and
 * \uXXXX literals. Getting this wrong silently drops or invents letters, so
 * it is parsed explicitly rather than by regex.
 *
 * @param {unknown} raw
 * @returns {string[]} the letters, in order, without duplicates
 * @throws on an unterminated `{…}` group
 */
export function parseUnicodeSet(raw) {
  let s = String(raw || "").trim();
  if (s.startsWith("[")) s = s.slice(1);
  if (s.endsWith("]")) s = s.slice(0, -1);
  const out = [];
  const seen = new Set();
  const push = (v) => {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  let i = 0;
  while (i < s.length && out.length < MAX_SET) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === "{") {
      // A letter of more than one character, such as Hungarian "cs".
      const end = s.indexOf("}", i);
      if (end === -1) throw new Error("malformed character set: unterminated group");
      const inner = s.slice(i + 1, end);
      let built = "";
      for (let j = 0; j < inner.length;) {
        const a = readAtom(inner, j);
        built += a.ch;
        j = a.next;
      }
      push(built);
      i = end + 1;
      continue;
    }
    const first = readAtom(s, i);
    i = first.next;
    if (s[i] === "-" && i + 1 < s.length && s[i + 1] !== " ") {
      const last = readAtom(s, i + 1);
      i = last.next;
      const a = /** @type {number} */ (first.ch.codePointAt(0));
      const b = /** @type {number} */ (last.ch.codePointAt(0));
      if (b >= a) {
        for (let cp = a; cp <= b && out.length < MAX_SET; cp++) push(String.fromCodePoint(cp));
      } else {
        push(first.ch);
        push(last.ch);
      }
      continue;
    }
    push(first.ch);
  }
  return out;
}
