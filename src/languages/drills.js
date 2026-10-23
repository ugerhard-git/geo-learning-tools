/**
 * Scripts and Languages drills: what each drill asks, which items it draws
 * on, which wrong options it offers and what counts as a right answer.
 * Nothing here touches the page, so it can be tested on its own
 * (test/unit/languages.test.js).
 *
 * Every question shows a specimen of writing, real text in the language:
 * the first sentence of the Universal Declaration of Human Rights, or three
 * of its words (weekdays, months, country names). The learner answers by
 * picking one of four options or by typing.
 *
 * @module languages/drills
 */
import { esc, table } from "../shared/dom.js";
import { judgeTyped, answerKey } from "../shared/text.js";
import { pickOne, shuffle } from "../shared/random.js";
import { plainName } from "./data.js";

/** @typedef {import("./data.js").Language} Language */
/** @typedef {import("./data.js").Telltale} Telltale */
/** @typedef {import("./data.js").LanguageData} LanguageData */

/** The drills, in the order the setup offers them. */
export const DRILLS = table({
  language: {
    label: "Which language?",
    blurb: "Read a sentence or a few words; name the language.",
  },
  letter: { label: "Telltale letters", blurb: "A letter only a few languages use; name one." },
  script: { label: "Which script?", blurb: "Thai or Lao, Cyrillic or Greek: name the writing." },
  country: { label: "Which country?", blurb: "Read a sentence; pick where you would see it." },
});

/** The letter that starts each drill's progress keys. "letter" and "language" both start with l. */
const PREFIX = table({ language: "l", letter: "t", script: "s", country: "c" });

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

/**
 * The items a drill asks about.
 * @param {LanguageData} data
 * @param {string} type
 */
export function poolFor(data, type) {
  if (type === "letter") return data.telltales;
  if (type === "script") {
    return Object.keys(data.scripts).map((code) => ({ code, name: data.scripts[code] }));
  }
  return data.languages;
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
  ["Deva", "Beng", "Tibt", "Sinh", "Taml"],
  ["Thai", "Laoo", "Khmr"],
  ["Hans", "Hant", "Jpan", "Kore"],
  ["Geor", "Grek"],
];
const scriptKin = (code) => new Set(SCRIPT_GROUPS.filter((g) => g.includes(code)).flat());

/**
 * A specimen of a language: its sentence, or three of its words.
 * @param {Language} lang
 * @param {"sentence" | "words" | "any"} [kind]
 * @returns {{ text: string, lang: string, kind: "sentence" | "words" }}
 */
export function specimenOf(lang, kind = "any") {
  const words = lang.words.length >= 3 && kind !== "sentence";
  if (words && (kind === "words" || Math.random() < 0.5)) {
    return {
      text: shuffle(lang.words.slice()).slice(0, 3).join(" · "),
      lang: lang.id,
      kind: "words",
    };
  }
  return { text: lang.sentence, lang: lang.id, kind: "sentence" };
}

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

/** One question. */
export class LanguageQuestion {
  /**
   * @param {string} type a key of {@link DRILLS}
   * @param {any} item a language, telltale letter or script
   * @param {LanguageData} data
   */
  constructor(type, item, data) {
    this.type = type;
    this.item = item;
    this.data = data;
    if (type === "letter") {
      // The language behind the right option, one of the few that use the letter.
      this.lang = data.byId[pickOne(item.languages)];
      this.specimen = { text: item.letter, lang: this.lang.id, kind: "letter" };
    } else if (type === "script") {
      this.lang = pickOne(data.languages.filter((l) => l.script === item.code));
      this.specimen = specimenOf(this.lang);
    } else {
      this.lang = item;
      this.specimen = specimenOf(item, type === "country" ? "sentence" : "any");
    }
    if (type === "country") this.country = pickOne(item.countries);
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
      default:
        return {
          main: "Which language is this?",
          sub: this.specimen.kind === "words" ? "three words" : "a sentence",
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
      const others = data.streetView.filter((c) => !this.lang.countries.includes(c));
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
    const regions = regionsOf(right, data);
    const others = data.languages.filter(
      (l) => !cannot.has(l.id) && !twinsOf(l.id).some((t) => cannot.has(t) && t !== l.id),
    );
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
      this.type === "letter" ? this.item.languages.map((id) => data.byId[id]) : [this.lang];
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
    return `${l.name} (${l.autonym}), written in ${script}. Official in ${l.countries
      .map((c) => this.data.countries[c].name)
      .join(", ")}.`;
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
