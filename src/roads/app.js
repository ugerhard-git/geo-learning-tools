/**
 * Roads: what the roads of the Street View countries give away, with two
 * drills and spaced repetition.
 *
 * - Explore: by country (a card each, with its driving side, centre line
 *   colour and sign drawings) or by clue (the countries grouped by side or
 *   line colour, or the drawings side by side). A country opens its details,
 *   with the sources and the credits for each drawing.
 * - Drill: "Clue by clue" and "Which country?", limited to the clues the
 *   learner picks. Each question shows a road scene or a sign above the bar.
 * - Progress: what is known, what is due, what keeps going wrong, per clue.
 *
 * How it runs: `main` loads src/data/roads.json, signs.json and the country
 * table (data.js) and draws the cards. A drill starts from the setup card:
 * `planSession` (shared/leitner.js) picks what is due and what is new,
 * `DrillSession` (shared/drill.js) runs the question bar, and this file
 * draws each question's scene.
 *
 * The files:
 * - app.js (this file): the cards, the details, the scene, setup and progress.
 * - data.js: reads the data files.
 * - drills.js: what each drill asks and its options. No page access, so it is
 *   unit-tested.
 *
 * The drawings are copies of files on Wikimedia Commons, kept in
 * src/data/signs/; the page fetches nothing from outside the site except
 * flag images.
 *
 * @module roads/app
 */
import { $, $$, esc } from "../shared/dom.js";
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
import {
  CLUES,
  COLOURS,
  SIGN_CLUES,
  articleUrl,
  commonsUrl,
  loadRoadData,
  signUrl,
} from "./data.js";
import { DRILLS, RoadQuestion, cleanClues, itemOfKey, keyOf, poolFor, sideText } from "./drills.js";

/** Where the drill settings are remembered. */
const SETTINGS = {
  type: "roads.type",
  clues: "roads.clues",
  hard: "roads.hard",
  len: "roads.len",
};

const pageStatus = $("#pageStatus");

try {
  await main();
  pageStatus.remove();
} catch (e) {
  pageStatus.textContent = "The roads could not be loaded. Check your connection and reload.";
  throw e;
}

/* ============================================================ drawing */

/**
 * A road seen from the driver's seat: the centre line in its colour, and a
 * car ahead on the side the country drives on, with one coming the other way.
 * @param {{ drive?: "left" | "right", colour?: string }} what leave one out to not show it
 */
function roadSvg({ drive, colour }) {
  const centre = {
    white: `<path class="ln-white dash" d="M160 180 L160 30"/>`,
    yellow: `<path class="ln-yellow" d="M160 180 L160 30"/>`,
    both: `<path class="ln-yellow" d="M156 180 L159 30"/><path class="ln-white dash" d="M164 180 L161 30"/>`,
  };
  // Cars are drawn from behind (ours, going away) and from the front (the
  // other, coming towards us), each in its lane.
  const car = (x, y, s, cls) =>
    `<g class="${cls}" transform="translate(${x} ${y}) scale(${s})"><rect x="-22" y="-16" width="44" height="22" rx="6"/><rect class="glass" x="-15" y="-13" width="30" height="8" rx="3"/><rect class="tyre" x="-20" y="6" width="9" height="6" rx="2"/><rect class="tyre" x="11" y="6" width="9" height="6" rx="2"/></g>`;
  const ours = drive === "left" ? 108 : 212;
  const theirs = drive === "left" ? 172 : 148;
  return `<svg viewBox="0 0 320 180" role="img" aria-label="${esc(sceneLabel({ drive, colour }))}">
    <rect class="sky" width="320" height="34"/>
    <rect class="verge" y="30" width="320" height="150"/>
    <path class="road" d="M20 180 L150 30 L170 30 L300 180 Z"/>
    <path class="ln-white" d="M34 180 L151 32"/><path class="ln-white" d="M286 180 L169 32"/>
    ${colour ? centre[colour] : ""}
    ${drive ? car(theirs, 64, 0.55, "car them") + car(ours, 150, 1.3, "car us") : ""}
  </svg>`;
}

/** What a road scene shows, said in words. */
function sceneLabel({ drive, colour }) {
  return [
    drive ? `Traffic drives ${sideText(drive).toLowerCase()}` : "",
    colour ? `${COLOURS[colour]} centre line` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** A drawing. `alt` is left empty where the text beside it already says what it is. */
const signImg = (sign, alt = "", cls = "") =>
  `<img class="${cls}" src="${esc(signUrl(sign))}" alt="${esc(alt)}" loading="lazy" decoding="async">`;

/** "Drawing: author, licence" with links to the file on Commons. */
function credit(sign) {
  return `<a href="${esc(commonsUrl(sign))}" target="_blank" rel="noopener noreferrer">${esc(sign.commons.replaceAll("_", " "))}</a>, ${esc(sign.author || "unknown author")}, ${esc(sign.licence)}`;
}

/* =============================================================== main */

async function main() {
  const data = await loadRoadData();
  const { countries, byCode, sources } = data;
  hideFailedFlags();

  /* ======================================================= explore */

  const filter = { view: "country", query: "" };

  $(".filters").insertAdjacentHTML(
    "beforeend",
    Object.entries(CLUES)
      .map(
        ([k, c]) =>
          `<button class="chip" data-view="${k}" aria-pressed="false">${esc(c.label)}</button>`,
      )
      .join(""),
  );

  const matches = (c) => {
    const q = norm(filter.query.trim());
    return !q || [c.name, c.code, ...c.aliases].some((s) => norm(s).includes(q));
  };

  const sourceLink = (key) => {
    const s = sources[key];
    return s
      ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a> (${esc(s.publisher)})`
      : "";
  };

  /** A country as a small button: flag and name. */
  const countryChip = (c, cls = "") =>
    `<button class="cchip ${cls}" data-code="${esc(c.code)}">${flagMini(c.code, c.name)}${esc(c.name)}</button>`;

  function renderCards() {
    const list = countries.filter(matches);
    const el = $("#cards");
    if (!list.length) {
      el.className = "";
      el.innerHTML = `<p class="empty">No country matches “${esc(filter.query)}”.</p>`;
      return;
    }
    if (filter.view === "country") {
      el.className = "cards";
      el.innerHTML = list.map(countryCard).join("");
    } else if (filter.view === "side") {
      el.className = "groups";
      el.innerHTML = ["left", "right"]
        .map((d) =>
          group(
            sideText(d),
            list.filter((c) => c.drive === d),
            roadSvg({ drive: d }),
          ),
        )
        .join("");
    } else if (filter.view === "lines") {
      el.className = "groups";
      el.innerHTML =
        Object.keys(COLOURS)
          .map((k) =>
            group(
              `${COLOURS[k]} centre lines`,
              list.filter((c) => c.centre?.colour === k),
              roadSvg({ colour: k }),
            ),
          )
          .join("") +
        group(
          "No solid source yet",
          list.filter((c) => !c.centre),
        ) +
        `<p class="src">In italics: only the rule for that part of the world is sourced, not the country's own.</p>`;
    } else {
      el.className = "signs";
      el.innerHTML = signGrid(filter.view, list);
    }
  }

  function countryCard(c) {
    const lines = c.centre
      ? `${COLOURS[c.centre.colour]} centre line`
      : "Centre line: no source yet";
    return `<button class="rcard" data-code="${esc(c.code)}">
      <span class="rname">${flagMini(c.code, c.name)}${esc(c.name)}</span>
      <span class="rfacts">Drives ${esc(sideText(c.drive).toLowerCase())} · ${esc(lines)}</span>
      <span class="rsigns">${SIGN_CLUES.map((k) => (c.signs[k] ? signImg(c.signs[k], CLUES[k].label) : "")).join("")}</span>
    </button>`;
  }

  function group(title, list, art = "") {
    return `<section class="group"><div class="ghead">${art ? `<span class="gart">${art}</span>` : ""}<h2>${esc(title)} <span class="count">${list.length}</span></h2></div>
      <div class="cchips">${list.map((c) => countryChip(c, c.centre?.regional ? "regional" : "")).join("") || `<span class="empty">None</span>`}</div></section>`;
  }

  /** One tile per drawing, with every country that uses it. */
  function signGrid(clue, list) {
    const byFile = new Map();
    for (const c of list) {
      const s = c.signs[clue];
      if (!s) continue;
      if (!byFile.has(s.commons)) byFile.set(s.commons, { sign: s, countries: [] });
      byFile.get(s.commons).countries.push(c);
    }
    const missing = list.filter((c) => !c.signs[clue]);
    return `<div class="tiles">${[...byFile.values()]
      .map(
        ({ sign, countries: cs }) =>
          `<figure class="tile">${signImg(sign)}<figcaption>${cs.map((c) => countryChip(c)).join("")}</figcaption></figure>`,
      )
      .join("")}</div>
      ${missing.length ? `<section class="group"><h2>No drawing yet <span class="count">${missing.length}</span></h2><div class="cchips">${missing.map((c) => countryChip(c)).join("")}</div></section>` : ""}`;
  }

  $(".filters").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-view]");
    if (!chip) return;
    filter.view = CLUES[chip.dataset.view] ? chip.dataset.view : "country";
    for (const c of $$(".filters [data-view]")) {
      c.setAttribute("aria-pressed", String(c.dataset.view === filter.view));
    }
    renderCards();
  });
  $("#q").addEventListener("input", (e) => {
    filter.query = e.target.value.slice(0, 60);
    renderCards();
  });
  $("#browse").addEventListener("click", (e) => {
    const c = e.target.closest("[data-code]");
    if (c) return openDetail(c.dataset.code);
    if (e.target.closest("[data-credits]")) openCredits();
  });

  /* ======================================================= details */

  const detail = $("#detail");
  const detailBody = $(".dlg", detail);

  function showDialog(html) {
    detailBody.innerHTML = `<button class="close" aria-label="Close" data-close>×</button>${html}`;
    if (!detail.open) detail.showModal();
    detailBody.scrollTop = 0;
    detailBody.focus({ preventScroll: true });
  }

  function openDetail(code) {
    const c = byCode[code];
    if (!c) return;
    const centre = c.centre
      ? `<p>${esc(COLOURS[c.centre.colour])}. ${esc(c.centre.note)}</p>
         <p class="src">${c.centre.regional ? "The rule for this part of the world; the country's own is not sourced. " : ""}Source: ${sourceLink(c.centre.source)}.</p>`
      : `<p class="empty">No solid source yet.</p>`;
    showDialog(`
      <h2 id="dName">${flagMini(c.code, c.name)}${esc(c.name)}</h2>
      <div class="dscene">${roadSvg({ drive: c.drive, colour: c.centre?.colour })}</div>
      <h3>Driving side</h3>
      <p>${esc(sideText(c.drive))}.</p>
      <p class="src">Source: ${sourceLink(c.driveSource)}.</p>
      <h3>Centre line</h3>
      ${centre}
      <h3>Signs</h3>
      <div class="dsigns">${SIGN_CLUES.map((k) => {
        const s = c.signs[k];
        return `<figure>${s ? signImg(s, `${CLUES[k].label}, ${c.name}`) : `<span class="nosign">No drawing yet</span>`}<figcaption>${esc(CLUES[k].label)}</figcaption></figure>`;
      }).join("")}</div>
      ${
        SIGN_CLUES.some((k) => c.signs[k])
          ? `<p class="src">Drawings from Wikimedia Commons, found in the Wikipedia article ${esc(
              [...new Set(SIGN_CLUES.map((k) => c.signs[k]?.source).filter(Boolean))].join(", "),
            )}:</p>
             <ul class="credits">${SIGN_CLUES.filter((k) => c.signs[k])
               .map((k) => `<li>${esc(CLUES[k].label)}: ${credit(c.signs[k])}</li>`)
               .join("")}</ul>`
          : ""
      }`);
  }

  function openCredits() {
    const drawn = countries.flatMap((c) =>
      SIGN_CLUES.filter((k) => c.signs[k]).map((k) => ({ c, k, s: c.signs[k] })),
    );
    showDialog(`
      <h2 id="dName">Sources and credits</h2>
      <h3>Driving side and centre lines</h3>
      <ul class="credits">${Object.keys(sources)
        .map((k) => `<li>${sourceLink(k)}</li>`)
        .join("")}</ul>
      <h3>Sign drawings</h3>
      <p class="src">Copies of files on Wikimedia Commons, each under the licence named, found in Wikipedia's articles on each country's road signs.</p>
      <ul class="credits">${drawn
        .map(
          ({ c, k, s }) =>
            `<li>${esc(c.name)}, ${esc(CLUES[k].label.toLowerCase())}: ${credit(s)}</li>`,
        )
        .join("")}</ul>
      <p class="src">Licences: <a href="https://creativecommons.org/licenses/" target="_blank" rel="noopener noreferrer">Creative Commons</a>. Article texts: <a href="${esc(articleUrl("Wikipedia:Copyrights"))}" target="_blank" rel="noopener noreferrer">Wikipedia</a>, CC BY-SA.</p>`);
  }

  detail.addEventListener("click", (e) => {
    if (e.target === detail || e.target.closest("[data-close]")) detail.close();
    const c = e.target.closest("[data-code]");
    if (c) openDetail(c.dataset.code);
  });

  /* ========================================================= drill */

  const store = new ProgressStore({ storageKey: "roads.progress.v1", app: "roads" });
  const setupEl = $("#setup");
  const drillBar = $("#drillbar");
  const sceneEl = $("#scene");

  /** The learner's drill settings, as saved. */
  const ds = {
    type: DRILLS[storage.get(SETTINGS.type)] ? storage.get(SETTINGS.type) : "clue",
    clues: cleanClues(String(storage.get(SETTINGS.clues) ?? "").split(",")),
    hard: storage.get(SETTINGS.hard) === "1",
    len: cleanLength(storage.get(SETTINGS.len)),
  };
  const save = (name, value) => storage.set(SETTINGS[name], String(value));
  /** @type {RoadQuestion | null} */
  let current = null;
  let mode = "explore";

  function clueButtons() {
    return `<div class="chips" role="group" aria-label="Clues">${Object.entries(CLUES)
      .map(
        ([k, c]) =>
          `<button class="chip" data-clue="${k}" aria-pressed="${ds.clues.includes(k)}">${esc(c.label)}</button>`,
      )
      .join("")}</div>`;
  }

  function renderSetup() {
    session.stop();
    sceneEl.hidden = true;
    const items = poolFor(data, ds.type, ds.clues);
    const due = items.filter((it) => store.isDueReview(keyOf(it))).length;
    const fresh = items.filter((it) => store.isNew(keyOf(it))).length;
    setupEl.dataset.view = "setup";
    setupEl.innerHTML = `<h2>Drill</h2>
      <p class="lead">Name the country, or its clue. Wrong answers come back sooner.</p>
      <div class="fieldrow"><span class="flab">What to practise</span>${typeButtons(DRILLS, ds.type)}</div>
      <div class="fieldrow"><span class="flab">Clues</span>${clueButtons()}</div>
      <div class="fieldrow"><span class="flab">How</span>
        <div class="selects">
          ${difficultySwitch(ds.hard, "Easy: far-apart options", "Hard: neighbours")}
          ${lengthSelect(ds.len)}
        </div>
      </div>
      ${startSection({
        size: items.length,
        due,
        fresh,
        empty:
          ds.type === "scene"
            ? "Pick at least two clues, one of them not the driving side."
            : "Nothing to practise here.",
        back: "Back to the roads",
      })}`;
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
    const clue = t.closest("[data-clue]")?.dataset.clue;
    if (clue && CLUES[clue]) {
      const on = ds.clues.includes(clue);
      // One clue always stays picked.
      if (on && ds.clues.length === 1) return;
      ds.clues = cleanClues(on ? ds.clues.filter((c) => c !== clue) : [...ds.clues, clue]);
      save("clues", ds.clues.join(","));
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
    onEnd: () => (sceneEl.hidden = true),
    backLabel: "Back to the roads",
  });

  function startDrill(dueOnly) {
    const items = poolFor(data, ds.type, ds.clues);
    if (items.length < 2) return;
    const settings = { hard: ds.hard, clues: ds.clues.slice() };
    const queue = planSession(items, keyOf, store, { length: ds.len, dueOnly });
    session.start(queue, ds.len, {
      label: DRILLS[ds.type].label,
      keyOf,
      ask: (it) => ask(it, settings),
      reveal: () => ($("#sceneNote").textContent = current.reveal()),
      describe,
      more: () => shuffle(items.slice()).slice(0, 20),
    });
  }

  /** What the summary and progress screen call an item, and the country its details show. */
  function describe(it) {
    const c = byCode[it.code];
    const name = c?.name ?? it.code;
    return {
      label: it.clue === "scene" ? name : `${name}: ${CLUES[it.clue].short}`,
      look: it.code,
    };
  }

  /** Draw a question's scene and describe the question to the drill bar. */
  function ask(it, settings) {
    current = new RoadQuestion(it, data, settings);
    const c = current.country;
    const art = $("#sceneArt");
    if (it.clue === "scene") {
      const shows = current.shows;
      const road = roadSvg({
        drive: shows.includes("side") ? c.drive : undefined,
        colour: shows.includes("lines") ? c.centre.colour : undefined,
      });
      const signs = SIGN_CLUES.filter((k) => shows.includes(k));
      art.innerHTML = `${shows.includes("side") || shows.includes("lines") ? `<div class="sroad">${road}</div>` : ""}
        ${signs.length ? `<div class="ssigns">${signs.map((k) => `<figure>${signImg(c.signs[k], CLUES[k].label)}<figcaption>${esc(CLUES[k].label)}</figcaption></figure>`).join("")}</div>` : ""}`;
    } else if (SIGN_CLUES.includes(it.clue)) {
      art.innerHTML = `<div class="ssigns big"><figure>${signImg(c.signs[it.clue], CLUES[it.clue].label)}</figure></div>`;
    } else {
      art.innerHTML = `<p class="sname">${flagMini(c.code, c.name)}${esc(c.name)}</p>`;
    }
    $("#sceneNote").textContent = "";
    sceneEl.hidden = false;
    return {
      ...current.prompt(),
      answer: "choose",
      options: current.options(),
      answerText: current.answerText(),
    };
  }

  /* ====================================================== progress */

  const progressEl = $("#progress");
  const progress = new ProgressView(progressEl, {
    store,
    appName: "Roads",
    drills: () => [
      ...Object.keys(CLUES).map((clue) => ({
        label: CLUES[clue].label,
        keys: poolFor(data, "clue", [clue]).map(keyOf),
      })),
      {
        label: DRILLS.scene.label,
        keys: countries.map((c) => keyOf({ clue: "scene", code: c.code })),
      },
    ],
    describe: (key) => {
      const it = itemOfKey(key);
      return it && byCode[it.code] ? describe(it) : null;
    },
    onLook: (look) => openDetail(look),
    footer: `<button class="btn quiet" data-mode="drill">Back to the drill</button>`,
  });

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
      sceneEl.hidden = true;
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
