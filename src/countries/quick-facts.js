/**
 * Quick facts: each place's internet domain, phone code and currency, from
 * src/data/quick-facts.json (built from Wikidata and Unicode CLDR by
 * tools/data/quick-facts.mjs),
 * and the "Clues" quiz that asks for the place a fact belongs to. Nothing
 * here touches the page, so it is unit-tested (test/unit/quick-facts.test.js).
 *
 * @module countries/quick-facts
 */
import { table } from "../shared/dom.js";

/**
 * @typedef {object} QuickFacts
 * @property {string[]} tld internet domains, e.g. ".pl"
 * @property {string[]} phone phone codes, e.g. "+48"
 * @property {{ code: string, name: string, symbol?: string }[]} currency
 *   e.g. { code: "PLN", name: "Polish zloty", symbol: "zł" }
 */

/** The kinds of clue, in the order the quiz offers them. */
export const CLUES = table({
  tld: {
    label: "Internet domain",
    prompt: (v) => `Find the place whose internet domain is ${v}`,
    answer: (v) => `its internet domain is ${v}`,
  },
  phone: {
    label: "Phone code",
    prompt: (v) => `Find the place whose phone code is ${v}`,
    answer: (v) => `its phone code is ${v}`,
  },
  currency: {
    label: "Currency",
    prompt: (v) => `Find the place that pays in the ${v}`,
    answer: (v) => `it pays in the ${v}`,
  },
});

/** The letter that starts each clue's progress keys ("c:" is the map quiz's). */
const PREFIX = table({ tld: "d", phone: "p", currency: "m" });

/**
 * The quick facts by place code, keeping only well-formed values.
 * @param {any} json quick-facts.json, parsed (or null when it could not load)
 * @returns {Record<string, QuickFacts>}
 */
export function makeQuickFacts(json) {
  const out = table({});
  for (const [code, f] of Object.entries(json?.facts ?? {})) {
    if (!/^[A-Z]{2}$/.test(code)) continue;
    out[code] = {
      tld: (f.tld ?? []).filter((t) => /^\.[a-z]{2}$/.test(t)),
      phone: (f.phone ?? []).filter((p) => /^\+\d{1,4}( \d{1,4})?$/.test(p)),
      currency: (f.currency ?? []).filter(
        (c) =>
          /^[A-Z]{3}$/.test(c?.code) &&
          typeof c.name === "string" &&
          c.name.length <= 60 &&
          (c.symbol === undefined || (typeof c.symbol === "string" && c.symbol.length <= 6)),
      ),
    };
  }
  return out;
}

/**
 * A currency's name without the country in it, so a clue does not give the
 * answer away: "Polish złoty" is "złoty", "Bosnia and Herzegovina
 * convertible mark" is "convertible mark". A name that is only the country's
 * word ("Euro", "Renminbi") stays as it is.
 * @param {string} name
 */
export function currencyWord(name) {
  const words = name.split(/\s+/);
  let i = 0;
  while (i < words.length - 1 && (/^\p{Lu}/u.test(words[i]) || /^(and|of|the)$/.test(words[i]))) {
    i++;
  }
  return words.slice(i).join(" ").toLowerCase();
}

/** How a clue of each kind shows a fact. */
const shown = {
  tld: (v) => v,
  phone: (v) => v,
  currency: (c) => currencyWord(c.name),
};

/**
 * The clues the quiz can ask: per place, one fact of each kind picked that
 * no other place shares, so every clue has one answer. "+1", the euro and
 * the dollar are shared, so they are never asked.
 * @param {{ code: string }[]} places the places in play
 * @param {Record<string, QuickFacts>} facts every place's facts
 * @param {string[]} kinds keys of {@link CLUES}
 * @returns {{ code: string, kind: string, value: string }[]}
 */
export function clueItems(places, facts, kinds) {
  // Each value, as shown, against every place that has it, across all places.
  const owners = new Map();
  for (const [code, f] of Object.entries(facts)) {
    for (const kind of Object.keys(CLUES)) {
      for (const v of f[kind]) {
        const k = `${kind}|${shown[kind](v)}`;
        owners.set(k, new Set([...(owners.get(k) ?? []), code]));
      }
    }
  }
  const items = [];
  for (const p of places) {
    const f = facts[p.code];
    if (!f) continue;
    for (const kind of kinds) {
      const value = f[kind].map(shown[kind]).find((v) => owners.get(`${kind}|${v}`)?.size === 1);
      if (value) items.push({ code: p.code, kind, value });
    }
  }
  return items;
}

/**
 * A clue's progress key: the kind's prefix, then the place, e.g. "p:PL".
 * @param {{ code: string, kind: string }} item
 */
export const clueKey = (item) => `${PREFIX[item.kind]}:${item.code}`;

/**
 * A place's facts as rows for its details: [label, text].
 * @param {QuickFacts | undefined} f
 * @returns {[string, string][]}
 */
export function quickRows(f) {
  if (!f) return [];
  return [
    ["Internet domain", f.tld.join(", ")],
    ["Phone code", f.phone.join(", ")],
    [
      "Currency",
      f.currency
        .map((c) => `${c.name} (${[c.code, c.symbol].filter(Boolean).join(", ")})`)
        .join("; "),
    ],
  ].filter(([, v]) => v);
}
