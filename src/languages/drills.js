/**
 * Scripts and Languages drills: what each drill asks, which items it draws
 * on, which wrong options it offers and what counts as a right answer.
 * Nothing here touches the page, so it can be tested on its own
 * (test/unit/languages.test.js).
 *
 * Every question shows a specimen of writing, real text in the language:
 * the first sentence of the Universal Declaration of Human Rights, three of
 * its words (place words, capitals, country names, months), or its whole
 * alphabet. The learner answers by picking one of four options, by typing,
 * or on the map.
 *
 * A drill can be limited to a part of the world: then it asks only about
 * languages used there, and takes its wrong options from there while there
 * are enough.
 *
 * @module languages/drills
 */
import { esc, table } from "../shared/dom.js";
import { judgeTyped, answerKey } from "../shared/text.js";
import { pickOne, shuffle } from "../shared/random.js";
import { countryIn } from "../shared/where.js";
import { plainName } from "./data.js";

/** @typedef {import("./data.js").Language} Language */
/** @typedef {import("./data.js").Telltale} Telltale */
/** @typedef {import("./data.js").LanguageData} LanguageData */

/** The drills, in the order the setup offers them. */
export const DRILLS = table({
  language: {
    label: "Which language?",
    blurb: "Read a sentence, a few words or an alphabet; name the language.",
  },
  letter: { label: "Telltale letters", blurb: "A letter only a few languages use; name one." },
  script: { label: "Which script?", blurb: "Thai or Lao, Cyrillic or Greek: name the writing." },
  country: { label: "Which country?", blurb: "Read a sentence; pick where you would see it." },
  map: {
    label: "On the map",
    blurb: "Read some writing; click where you would see it.",
  },
});

/** The letter that starts each drill's progress keys. "letter" and "language" both start with l. */
const PREFIX = table({ language: "l", letter: "t", script: "s", country: "c", map: "m" });

/**
 * An item's progress key: the drill's prefix (see {@link PREFIX}), then the
 * item: a language id, a letter or a script code.
 * @param {string} type
 * @param {any} item
 */
export const keyOf = (type, item) => {
  const id = type === "letter" ? item.letter : type === "script" ? item.code : item.id;
  return `${PREFIX[type]}:${id}`;
};

/** What a question may show: anything, or only sentences, words or alphabets. */
export const SHOWS = table({
  any: "Anything",
  sentence: "Sentences",
  words: "Words",
  letters: "Alphabets",
});

/** The drills that show a language's writing, so the learner can pick what. */
export const SHOWS_WRITING = ["language", "script", "map"];

/**
 * Whether a language is used in a part of the world (see shared/where.js):
 * in one of its countries, or a country where it is used in some regions.
 * @param {Language} lang
 * @param {string} where
 * @param {LanguageData} data
 */
export const languageIn = (lang, where, data) =>
  where === "all" || lang.countries.some((c) => countryIn(data.countries[c], where));

/**
 * The items a drill asks about: languages used in the part of the world
 * picked, and that can show what was picked; their telltale letters; their
 * scripts.
 * @param {LanguageData} data
 * @param {string} type
 * @param {{ where?: string, show?: string }} [options]
 */
export function poolFor(data, type, { where = "all", show = "any" } = {}) {
  const shows = SHOWS_WRITING.includes(type) ? show : "any";
  const langs = data.languages.filter(
    (l) =>
      languageIn(l, where, data) &&
      (shows === "any" || canShow(l, shows)) &&
      // On the map, an alphabet must point to one language's places.
      !(type === "map" && shows === "letters" && !ownAlphabet(l, data)),
  );
  if (type === "letter") {
    const ids = new Set(langs.map((l) => l.id));
    return data.telltales.filter((t) => t.languages.some((id) => ids.has(id)));
  }
  if (type === "script") {
    const used = new Set(langs.map((l) => l.script));
    return Object.keys(data.scripts)
      .filter((code) => used.has(code))
      .map((code) => ({ code, name: data.scripts[code] }));
  }
  return langs;
}

/**
 * Languages close enough that their text cannot fairly be told apart: never
 * offered as each other's wrong option.
 */
const TWINS = [["bs", "hr", "sr-Latn"]];
const twinsOf = (id) => TWINS.find((g) => g.includes(id)) ?? [id];

/**
 * Scripts that look alike, so each is offered as the others' wrong option
 * first: telling them apart is the point of the drill.
 */
const SCRIPT_GROUPS = [
  ["Latn", "Cyrl", "Grek"],
  ["Arab", "Hebr"],
  // North Indian scripts hang from a line; South Indian ones are rounder.
  ["Deva", "Beng", "Guru", "Gujr", "Orya", "Tibt"],
  ["Taml", "Telu", "Knda", "Mlym", "Sinh", "Orya"],
  ["Thai", "Laoo", "Khmr"],
  ["Hans", "Hant", "Jpan", "Kore"],
  ["Geor", "Grek"],
];
const scriptKin = (code) => new Set(SCRIPT_GROUPS.filter((g) => g.includes(code)).flat());

/**
 * A language's alphabet as a specimen: its letters, without the marks that
 * only combine with them (vowel signs, accents written apart). Null for a
 * writing of thousands of characters (Chinese, Japanese, Korean), which no
 * one reads as an alphabet.
 * @param {Language} lang
 * @returns {string[] | null}
 */
export function alphabetOf(lang) {
  const letters = [...(lang.letters ?? "")].filter((ch) => !/\p{M}/u.test(ch));
  return letters.length >= 10 && letters.length <= 100 ? letters : null;
}

/** Whether a language has a specimen of this kind. */
export function canShow(lang, kind) {
  if (kind === "sentence") return Boolean(lang.sentence);
  if (kind === "words") return lang.words.length >= 3;
  if (kind === "letters") return alphabetOf(lang) !== null;
  return true;
}

/**
 * A specimen of a language: its sentence, three of its words, or its
 * alphabet; the kind asked for where the language has one, else any it has.
 * @param {Language} lang
 * @param {"sentence" | "words" | "letters" | "any"} [kind]
 * @returns {{ text: string, lang: string, kind: "sentence" | "words" | "letters" }}
 */
export function specimenOf(lang, kind = "any") {
  const kinds = ["sentence", "words", "letters"].filter((k) => canShow(lang, k));
  // A language with no sentence (Odia, Assamese) is shown by its words.
  const pick = kinds.includes(kind) ? kind : pickOne(kinds.length ? kinds : ["words"]);
  if (pick === "words") {
    return {
      text: shuffle(lang.words.slice()).slice(0, 3).join(" · "),
      lang: lang.id,
      kind: "words",
    };
  }
  if (pick === "letters")
    return { text: alphabetOf(lang).join(" "), lang: lang.id, kind: "letters" };
  return { text: lang.sentence, lang: lang.id, kind: "sentence" };
}

/** Languages written with the same letters: an alphabet cannot tell them apart. */
const sameAlphabet = (a, b) => alphabetOf(a)?.join("") === alphabetOf(b)?.join("");

/** Whether no other language is written with exactly this language's letters. */
const ownAlphabet = (lang, data) =>
  alphabetOf(lang) !== null && !data.languages.some((l) => l !== lang && sameAlphabet(l, lang));

/**
 * Up to `n` items from `candidates`, the preferred ones first, then the rest,
 * each group shuffled.
 * @template T
 * @param {T[]} candidates
 * @param {(item: T) => boolean} preferred
 * @param {number} n
 */
function pickPreferring(candidates, preferred, n) {
  const first = shuffle(candidates.filter(preferred));
  const rest = shuffle(candidates.filter((c) => !preferred(c)));
  return [...first, ...rest].slice(0, n);
}

/** The regions (from the country table) a language is official in. */
const regionsOf = (lang, data) => new Set(lang.countries.map((c) => data.countries[c]?.region));

/**
 * Where a language is used, as the map shades it and the map drill accepts
 * a click: the countries where it is official throughout, and the regions
 * (their codes) of the countries where it is a regional language.
 * @param {Language} lang
 * @returns {{ countries: string[], regions: string[] }}
 */
export function mapAreas(lang) {
  const regional = new Set(lang.regional ?? []);
  return {
    countries: lang.countries.filter((c) => !regional.has(c)),
    regions: [...regional].flatMap((c) => lang.regions?.[c]?.map ?? []),
  };
}

/** One question. */
export class LanguageQuestion {
  /**
   * @param {string} type a key of {@link DRILLS}
   * @param {any} item a language, telltale letter or script
   * @param {LanguageData} data
   * @param {{ where?: string, show?: string }} [options] the part of the world the drill
   *   is limited to, and what its questions show (a key of {@link SHOWS})
   */
  constructor(type, item, data, { where = "all", show = "any" } = {}) {
    this.type = type;
    this.item = item;
    this.data = data;
    this.where = where;
    /** Whether a language is used in the part of the world picked. */
    const inside = (l) => languageIn(l, where, data);
    /** The items of a list in the part of the world picked, or all if none are. */
    const preferInside = (list) => (list.some(inside) ? list.filter(inside) : list);
    if (type === "letter") {
      // The language behind the right option, one of the few that use the letter.
      const users = item.languages.map((id) => data.byId[id]);
      this.lang = pickOne(preferInside(users));
      this.specimen = { text: item.letter, lang: this.lang.id, kind: "letter" };
    } else if (type === "script") {
      const writers = data.languages.filter((l) => l.script === item.code);
      const fit = writers.filter((l) => show === "any" || canShow(l, show));
      this.lang = pickOne(preferInside(fit.length ? fit : writers));
      this.specimen = specimenOf(this.lang, show);
    } else {
      this.lang = item;
      this.specimen = specimenOf(item, type === "country" ? "sentence" : show);
      // An alphabet other languages share would point to their places too.
      if (type === "map" && this.specimen.kind === "letters" && !ownAlphabet(item, data)) {
        this.specimen = specimenOf(item, item.sentence ? "sentence" : "words");
      }
      if (type === "map") {
        // Languages whose writing cannot be told apart (Bosnian, Croatian,
        // Serbian in Latin) share an answer: a click in any of their places counts.
        /** @type {Language[]} */
        this.answers = twinsOf(item.id)
          .map((id) => data.byId[id])
          .filter(Boolean);
        const all = this.answers.map(mapAreas);
        this.areas = {
          countries: all.flatMap((a) => a.countries),
          regions: all.flatMap((a) => a.regions),
        };
      }
    }
    if (type === "country") {
      const here = item.countries.filter((c) => countryIn(data.countries[c], where));
      this.country = pickOne(here.length ? here : item.countries);
    }
  }

  /** The question's text for the drill bar (HTML). */
  prompt() {
    switch (this.type) {
      case "letter":
        return {
          main: "Which language uses this letter?",
          sub: `${esc(this.data.scripts[this.lang.script])} script`,
        };
      case "script":
        return { main: "Which script is this?", sub: "" };
      case "country":
        return {
          main: "Where would you read this?",
          sub: "one of the countries where it is an official language",
          hint: esc(this.lang.name),
          hintLabel: "Hint: which language?",
        };
      case "map":
        return {
          main: "Where would you read this?",
          sub: this.areas.regions.length
            ? "a country where it is official, or a region where it is used"
            : "a country where it is official",
          hint: esc(this.lang.name),
          hintLabel: "Hint: which language?",
        };
      default:
        return {
          main: "Which language is this?",
          sub:
            { words: "three words", letters: "its alphabet" }[this.specimen.kind] ?? "a sentence",
        };
    }
  }

  /** Four options, one right, in random order. */
  options() {
    const { data } = this;
    if (this.type === "script") {
      const kin = scriptKin(this.item.code);
      const others = Object.keys(data.scripts).filter((c) => c !== this.item.code);
      return shuffle([
        { label: data.scripts[this.item.code], correct: true },
        ...pickPreferring(others, (c) => kin.has(c), 3).map((c) => ({
          label: data.scripts[c],
          correct: false,
        })),
      ]);
    }
    if (this.type === "country") {
      const right = this.country;
      const region = data.countries[right].region;
      // Wrong options from the part of the world picked, while there are enough.
      const all = data.streetView.filter((c) => !this.lang.countries.includes(c));
      const here = all.filter((c) => countryIn(data.countries[c], this.where));
      const others = here.length >= 3 ? here : all;
      return shuffle([
        { label: data.countries[right].name, correct: true },
        ...pickPreferring(others, (c) => data.countries[c].region === region, 3).map((c) => ({
          label: data.countries[c].name,
          correct: false,
        })),
      ]);
    }
    // Which language, and telltale letters: wrong options are languages in
    // the same script, ideally spoken in the same part of the world, that
    // cannot also be right.
    const right = this.lang;
    const cannot = new Set(this.type === "letter" ? this.item.languages : twinsOf(right.id));
    // An alphabet cannot tell apart languages written with the same letters.
    if (this.specimen.kind === "letters") {
      for (const l of data.languages) if (sameAlphabet(l, right)) cannot.add(l.id);
    }
    const regions = regionsOf(right, data);
    const allOthers = data.languages.filter(
      (l) => !cannot.has(l.id) && !twinsOf(l.id).some((t) => cannot.has(t) && t !== l.id),
    );
    // Wrong options from the part of the world picked, while there are enough.
    const here = allOthers.filter((l) => languageIn(l, this.where, data));
    const others = here.length >= 3 ? here : allOthers;
    const sameScript = others.filter((l) => l.script === right.script);
    const pool = sameScript.length >= 3 ? sameScript : others;
    const wrong = pickPreferring(
      pool,
      (l) => [...regionsOf(l, data)].some((r) => regions.has(r)),
      3,
    );
    return shuffle([
      { label: right.name, correct: true },
      ...wrong.map((l) => ({ label: l.name, correct: false })),
    ]);
  }

  /** Every typed answer that counts as right. */
  accepted() {
    const { data } = this;
    if (this.type === "script") {
      const name = data.scripts[this.item.code];
      return [name, name.replace(/\s*\(.*\)$/, ""), name.replace(/^.*\((.*)\)$/, "$1")];
    }
    if (this.type === "country") {
      return this.lang.countries.flatMap((c) => [
        data.countries[c].name,
        ...data.countries[c].aliases,
      ]);
    }
    const langs =
      this.type === "letter"
        ? this.item.languages.map((id) => data.byId[id])
        : this.specimen.kind === "letters"
          ? // Any language written with exactly these letters is right.
            data.languages.filter((l) => l === this.lang || sameAlphabet(l, this.lang))
          : [this.lang];
    return langs.flatMap((l) => [l.name, plainName(l), l.autonym]);
  }

  /**
   * Judge a typed answer.
   * @param {string} text
   * @returns {(import("../shared/text.js").Verdict & { otherLabel?: string }) | null}
   */
  judge(text) {
    const others = otherNames(this.data, this.type);
    const verdict = judgeTyped(text, this.accepted(), (key) => others.get(key));
    if (verdict && !verdict.ok && verdict.other) return { ...verdict, otherLabel: verdict.other };
    return verdict;
  }

  /** The right answer as feedback states it (HTML). */
  answerText() {
    if (this.type === "script") return esc(this.data.scripts[this.item.code]);
    if (this.type === "country") {
      const names = this.lang.countries.map((c) => this.data.countries[c].name);
      return names.length === 1
        ? esc(names[0])
        : `${esc(this.data.countries[this.country].name)} (also ${esc(
            names
              .filter((n) => n !== this.data.countries[this.country].name)
              .slice(0, 4)
              .join(", "),
          )})`;
    }
    if (this.type === "letter") {
      return esc(this.item.languages.map((id) => this.data.byId[id].name).join(", "));
    }
    return esc(this.lang.name);
  }

  /** A line under the specimen once answered (plain text). */
  reveal() {
    const l = this.lang;
    const script = this.data.scripts[l.script];
    if (this.type === "letter") {
      return `“${this.item.letter}” is used in ${this.item.languages
        .map((id) => this.data.byId[id].name)
        .join(", ")}.`;
    }
    const where = l.countries.map(
      (c) => `${this.data.countries[c].name}${l.regional?.includes(c) ? " (some regions)" : ""}`,
    );
    return `${l.name}${l.autonym ? ` (${l.autonym})` : ""}, written in ${script}. Used in ${where.join(", ")}.`;
  }
}

/** Per drill, every name of something else a typed answer might mean. */
const otherIndex = new WeakMap();

/**
 * answerKey of every name in play → the label of what it names, so a wrong
 * typed answer can be told what it named instead.
 * @param {LanguageData} data
 * @param {string} type
 */
function otherNames(data, type) {
  let byType = otherIndex.get(data);
  if (!byType) otherIndex.set(data, (byType = new Map()));
  if (byType.has(type)) return byType.get(type);
  const index = new Map();
  const add = (name, label) => {
    const key = answerKey(name);
    if (key && !index.has(key)) index.set(key, label);
  };
  if (type === "script") {
    for (const name of Object.values(data.scripts)) add(name.replace(/\s*\(.*\)$/, ""), name);
  } else if (type === "country") {
    for (const c of data.streetView) add(data.countries[c].name, data.countries[c].name);
  } else {
    for (const l of data.languages) {
      add(l.name, l.name);
      add(plainName(l), l.name);
    }
  }
  byType.set(type, index);
  return index;
}
