/**
 * Scripts and Languages: the official languages of the countries with
 * Street View coverage, and what gives each away on a sign, with four drills
 * and spaced repetition.
 *
 * - Explore: a card per language with its script, its words for "street"
 *   and "city", its telltale letters and countries; filter by script or
 *   search by name, word, letter or country; a card opens the language's
 *   details (its letters, a sentence, words).
 * - Drill: "Which language?", "Telltale letters", "Which script?" and
 *   "Which country?". Each question shows a specimen of real writing above
 *   the drill bar.
 * - Progress: what is known, what is due, what keeps going wrong.
 *
 * How it runs: `main` loads src/data/languages.json and the country table
 * (data.js) and draws the cards. A drill starts from the setup card:
 * `planSession` (shared/leitner.js) picks what is due and what is new,
 * `DrillSession` (shared/drill.js) runs the question bar, and this file
 * shows each question's specimen. Every answer is saved to the learner's
 * progress.
 *
 * The files:
 * - app.js (this file): the cards, the details, the drill setup and progress.
 * - data.js: reads the data files into languages, scripts and telltale letters.
 * - drills.js: what each drill asks, its wrong options and what counts as
 *   right. No page access, so it is unit-tested.
 *
 * The data is built in advance by tools/data/languages.mjs from Unicode CLDR
 * and the Universal Declaration of Human Rights; this page fetches nothing
 * from outside the site except flag images.
 *
 * @module languages/app
 */
import { $, $$, esc, fmtNum } from "../shared/dom.js";
import { storage } from "../shared/storage.js";
import { norm } from "../shared/text.js";
import { shuffle } from "../shared/random.js";
import { flagMini, hideFailedFlags } from "../shared/flags.js";
import { ProgressStore, planSession } from "../shared/leitner.js";
import { ProgressView } from "../shared/progress-ui.js";
import {
  DrillSession,
  cleanLength,
  difficultySwitch,
  lengthSelect,
  startSection,
  typeButtons,
} from "../shared/drill.js";
import { loadLanguageData, plainName } from "./data.js";
import { DRILLS, LanguageQuestion, keyOf, poolFor } from "./drills.js";

/** Where the drill settings are remembered. */
const SETTINGS = {
  type: "languages.type",
  hard: "languages.hard",
  len: "languages.len",
};

const pageStatus = $("#pageStatus");

try {
  await main();
  pageStatus.remove();
} catch (e) {
  pageStatus.textContent = "The languages could not be loaded. Check your connection and reload.";
  throw e;
}

async function main() {
  const data = await loadLanguageData();
  const { languages, byId, scripts, countries } = data;
  hideFailedFlags();

  /* ======================================================= explore */

  /** Telltale letters per language. */
  const telltalesOf = new Map(languages.map((l) => [l.id, []]));
  for (const t of data.telltales) for (const id of t.languages) telltalesOf.get(id).push(t.letter);

  const filter = { script: "all", query: "" };

  // One chip per script, the most used first.
  const scriptCounts = new Map();
  for (const l of languages) scriptCounts.set(l.script, (scriptCounts.get(l.script) ?? 0) + 1);
  $(".filters").insertAdjacentHTML(
    "beforeend",
    [...scriptCounts]
      .sort((a, b) => b[1] - a[1] || scripts[a[0]].localeCompare(scripts[b[0]]))
      .map(
        ([code, n]) =>
          `<button class="chip" data-script="${esc(code)}" aria-pressed="false">${esc(scripts[code])} <span class="count">${n}</span></button>`,
      )
      .join(""),
  );

  /** Whether a language matches the search: its names, script, a letter or a country. */
  function matches(l, q) {
    if (!q) return true;
    // A single letter finds the languages that write it, and nothing else:
    // "ő" should not match every name with an "o" in it.
    if ([...q].length === 1) return l.letters.includes(q.toLocaleLowerCase(l.id));
    const key = norm(q);
    return [
      l.name,
      l.autonym,
      l.street ?? "",
      l.road ?? "",
      l.city ?? "",
      ...(l.capitals ?? []),
      ...(l.placeWords ?? []).map(([, w]) => w),
      scripts[l.script],
      ...l.countries.flatMap((c) => [countries[c].name, c, ...countries[c].aliases]),
    ].some((s) => norm(s).includes(key));
  }

  function renderCards() {
    const list = languages
      .filter((l) => filter.script === "all" || l.script === filter.script)
      .filter((l) => matches(l, filter.query.trim()))
      .sort((a, b) => a.name.localeCompare(b.name));
    $("#cards").innerHTML = list.length
      ? list.map(card).join("")
      : `<p class="empty">No language matches “${esc(filter.query)}”.</p>`;
  }

  function card(l) {
    const tells = telltalesOf.get(l.id);
    return `<button class="lcard" data-lang="${esc(l.id)}">
      <span class="auto" lang="${esc(l.id)}" dir="auto">${esc(l.autonym || l.name)}</span>
      <span class="lname">${esc(l.name)}</span>
      <span class="lscript">${esc(scripts[l.script])}</span>
      ${signWordsLine(l, "lsign")}
      ${tells.length ? `<span class="tells" lang="${esc(l.id)}">${tells.map((t) => `<b>${esc(t)}</b>`).join("")}</span>` : ""}
      <span class="lflags">${l.countries
        .slice(0, 8)
        .map((c) => flagMini(c, countries[c].name))
        .join(
          "",
        )}${l.countries.length > 8 ? `<span class="more">+${l.countries.length - 8}</span>` : ""}</span>
    </button>`;
  }

  /** "street: ulica · road: droga · city: miasto", where Wikidata has the words. */
  function signWordsLine(l, cls) {
    const parts = ["street", "road", "city"]
      .filter((k) => l[k])
      .map((k) => `${k} <b lang="${esc(l.id)}" dir="auto">${esc(l[k])}</b>`);
    return parts.length ? `<span class="${cls}">${parts.join(" · ")}</span>` : "";
  }

  $(".filters").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-script]");
    if (!chip) return;
    filter.script =
      chip.dataset.script === "all" || scripts[chip.dataset.script] ? chip.dataset.script : "all";
    for (const c of $$(".filters [data-script]")) {
      c.setAttribute("aria-pressed", String(c.dataset.script === filter.script));
    }
    renderCards();
  });
  $("#q").addEventListener("input", (e) => {
    filter.query = e.target.value.slice(0, 60);
    renderCards();
  });
  $("#cards").addEventListener("click", (e) => {
    const c = e.target.closest("[data-lang]");
    if (c) openDetail(c.dataset.lang);
  });

  /* ======================================================= details */

  const detail = $("#detail");
  const detailBody = $(".dlg", detail);

  function openDetail(id) {
    const l = byId[id];
    if (!l) return;
    const tells = telltalesOf.get(l.id);
    detailBody.innerHTML = `
      <button class="close" aria-label="Close" data-close>×</button>
      <h2 id="dName">${esc(l.name)}</h2>
      <p class="dauto" lang="${esc(l.id)}" dir="auto">${esc(l.autonym)}</p>
      <div class="meta"><span class="tag">${esc(scripts[l.script])} script</span>${l.countries
        .map(
          (c) =>
            `<span class="tag">${flagMini(c, countries[c].name)}${esc(countries[c].name)}</span>`,
        )
        .join("")}</div>
      ${
        tells.length
          ? `<h3>Telltale letters</h3><p class="dtells" lang="${esc(l.id)}">${tells
              .map((t) => {
                const others = data.telltales
                  .find((x) => x.letter === t)
                  .languages.filter((x) => x !== l.id);
                return `<span><b>${esc(t)}</b>${others.length ? `also ${esc(others.map((o) => plainName(byId[o])).join(", "))}` : "only this language"}</span>`;
              })
              .join("")}</p>`
          : ""
      }
      ${l.street || l.road || l.city ? `<h3>On signs</h3><p>${signWordsLine(l, "dsign")}</p>` : ""}
      ${
        l.capitals?.length
          ? `<h3>${l.capitals.length > 1 ? "Capitals" : "Capital"}</h3><p class="dcaps" lang="${esc(l.id)}" dir="auto">${esc(l.capitals.join(" · "))}</p>`
          : ""
      }
      ${
        l.placeWords?.length
          ? `<h3>In place names</h3><dl class="dplace">${l.placeWords
              .map(
                ([en, w]) =>
                  `<div><dt lang="${esc(l.id)}" dir="auto">${esc(w)}</dt><dd>${esc(en)}</dd></div>`,
              )
              .join("")}</dl>
             <p class="src">Words seen in town, road, region and landmark names, with their English.</p>`
          : ""
      }
      <h3>A sentence</h3>
      <blockquote class="dsent" lang="${esc(l.id)}" dir="auto">${esc(l.sentence)}</blockquote>
      <p class="src">Article 1 of the Universal Declaration of Human Rights.</p>
      ${
        l.words.length
          ? `<h3>Words</h3><p class="dwords" lang="${esc(l.id)}" dir="auto">${l.words.map((w) => `<span>${esc(w)}</span>`).join("")}</p>
             <p class="src">The words above, the capitals, its own name, its names for its countries, and the months.</p>`
          : ""
      }
      <h3>Letters</h3>
      <p class="dletters" lang="${esc(l.id)}" dir="auto">${[...l.letters]
        .slice(0, 120)
        .map((c) => `<span>${esc(c)}</span>`)
        .join(
          "",
        )}${[...l.letters].length > 120 ? `<span class="more">and ${fmtNum([...l.letters].length - 120)} more</span>` : ""}</p>
      <p class="src">Letters, months and names of countries: <a href="https://cldr.unicode.org/" target="_blank" rel="noopener noreferrer">Unicode CLDR</a>. Sentence: <a href="https://www.unicode.org/udhr/" target="_blank" rel="noopener noreferrer">UDHR in Unicode</a>. Words on signs, words in place names and capitals: <a href="https://www.wikidata.org/" target="_blank" rel="noopener noreferrer">Wikidata</a>, its labels and lexemes in this language, community-edited.</p>`;
    if (!detail.open) detail.showModal();
    detailBody.scrollTop = 0;
    detailBody.focus({ preventScroll: true });
  }

  detail.addEventListener("click", (e) => {
    if (e.target === detail || e.target.closest("[data-close]")) detail.close();
  });

  /* ========================================================= drill */

  const store = new ProgressStore({ storageKey: "languages.progress.v1", app: "languages" });
  const setupEl = $("#setup");
  const drillBar = $("#drillbar");
  const specimenEl = $("#specimen");

  /** The learner's drill settings, as saved. */
  const ds = {
    type: DRILLS[storage.get(SETTINGS.type)] ? storage.get(SETTINGS.type) : "language",
    hard: storage.get(SETTINGS.hard) === "1",
    len: cleanLength(storage.get(SETTINGS.len)),
  };
  const save = (name, value) => storage.set(SETTINGS[name], String(value));
  /** @type {LanguageQuestion | null} */
  let current = null;
  let mode = "explore";

  function renderSetup() {
    session.stop();
    specimenEl.hidden = true;
    const items = poolFor(data, ds.type);
    const due = items.filter((it) => store.isDueReview(keyOf(ds.type, it))).length;
    const fresh = items.filter((it) => store.isNew(keyOf(ds.type, it))).length;
    setupEl.dataset.view = "setup";
    setupEl.innerHTML = `<h2>Drill</h2>
      <p class="lead">Read the writing, name what it is. Wrong answers come back sooner.</p>
      <div class="fieldrow"><span class="flab">What to practise</span>${typeButtons(DRILLS, ds.type)}</div>
      <div class="fieldrow"><span class="flab">How</span>
        <div class="selects">
          ${difficultySwitch(ds.hard, "Easy: four choices", "Hard: type it")}
          ${lengthSelect(ds.len)}
        </div>
      </div>
      ${startSection({ size: items.length, due, fresh, empty: "Nothing to practise here.", back: "Back to the languages" })}`;
    setupEl.hidden = false;
  }

  setupEl.addEventListener("click", (e) => {
    if (setupEl.dataset.view !== "setup") return;
    const t = e.target;
    const type = t.closest("[data-type]")?.dataset.type;
    if (type && DRILLS[type]) {
      ds.type = type;
      save("type", type);
      return renderSetup();
    }
    const hard = t.closest("[data-hard]")?.dataset.hard;
    if (hard) {
      ds.hard = hard === "1";
      save("hard", hard);
      return renderSetup();
    }
    if (t.closest("[data-start]")) return startDrill(false);
    if (t.closest("[data-start-due]")) return startDrill(true);
  });

  setupEl.addEventListener("change", (e) => {
    if (e.target.id !== "dLen") return;
    ds.len = cleanLength(e.target.value);
    save("len", ds.len);
    renderSetup();
  });

  const session = new DrillSession({
    bar: drillBar,
    card: setupEl,
    store,
    isActive: () => mode === "drill",
    onLook: (look) => openDetail(look),
    onSetup: () => renderSetup(),
    onEnd: () => (specimenEl.hidden = true),
    backLabel: "Back to the languages",
  });

  function startDrill(dueOnly) {
    const items = poolFor(data, ds.type);
    if (items.length < 2) return;
    const type = ds.type;
    const queue = planSession(items, (it) => keyOf(type, it), store, { length: ds.len, dueOnly });
    session.start(queue, ds.len, {
      label: DRILLS[type].label,
      keyOf: (it) => keyOf(type, it),
      ask: (it) => ask(type, it),
      reveal: () => reveal(),
      judge: (text) => current.judge(text),
      describe: (it) => describe(type, it),
      more: () => shuffle(items.slice()).slice(0, 20),
    });
  }

  /** What the summary and progress screen call an item, and the language its details show. */
  function describe(type, it) {
    if (type === "letter") return { label: `“${it.letter}”`, look: it.languages[0] };
    if (type === "script") {
      const l = languages.find((x) => x.script === it.code);
      return { label: it.name, look: l?.id ?? "" };
    }
    return { label: it.name, look: it.id };
  }

  /** Show a question's specimen and describe the question to the drill bar. */
  function ask(type, it) {
    current = new LanguageQuestion(type, it, data);
    const { specimen } = current;
    const text = $("#specText");
    text.textContent = specimen.text;
    text.lang = specimen.lang;
    text.dir = "auto";
    text.className = `spec-text ${specimen.kind}`;
    $("#specNote").textContent = "";
    specimenEl.hidden = false;
    const answer = ds.hard ? "type" : "choose";
    return {
      ...current.prompt(),
      answer,
      options: answer === "choose" ? current.options() : undefined,
      answerText: current.answerText(),
    };
  }

  /** Once answered, say under the specimen what it was. */
  function reveal() {
    $("#specNote").textContent = current.reveal();
  }

  /* ====================================================== progress */

  const progressEl = $("#progress");
  const progress = new ProgressView(progressEl, {
    store,
    appName: "Scripts and Languages",
    drills: () =>
      Object.entries(DRILLS).map(([type, d]) => ({
        label: d.label,
        keys: poolFor(data, type).map((it) => keyOf(type, it)),
      })),
    describe: (key) => {
      const hit = itemByKey().get(key);
      return hit ? describe(hit.type, hit.item) : null;
    },
    onLook: (look) => openDetail(look),
    footer: `<button class="btn quiet" data-mode="drill">Back to the drill</button>`,
  });

  let keyIndex = null;
  function itemByKey() {
    if (!keyIndex) {
      keyIndex = new Map();
      for (const type of Object.keys(DRILLS)) {
        for (const item of poolFor(data, type)) keyIndex.set(keyOf(type, item), { type, item });
      }
    }
    return keyIndex;
  }

  /* ========================================================= modes */

  function setMode(m) {
    if (!["explore", "drill", "prog"].includes(m)) return;
    mode = m;
    document.body.className = m;
    for (const b of $$("header [data-mode]")) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    }
    $("#searchWrap").hidden = m !== "explore";
    $("#browse").hidden = m !== "explore";
    progressEl.hidden = m !== "prog";
    if (m === "drill") renderSetup();
    else {
      setupEl.hidden = true;
      specimenEl.hidden = true;
      session.stop();
    }
    if (m === "prog") progress.render();
  }

  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-mode]")?.dataset.mode;
    if (m) setMode(m);
  });

  renderCards();
}
