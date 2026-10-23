/**
 * Countries and Territories: every country and territory with a flag of its own, on a
 * zoomable world map.
 *
 * - Explore: hover and click countries; the panel shows the flag, an outline
 *   map, facts from REST Countries (with a key), Wikidata, and the
 *   geography sections of the CIA World Factbook.
 * - Quiz: "Name it" (the map points at a country), "Find it" (the quiz
 *   names a country) or "Clues" (the quiz gives an internet domain or
 *   currency and the learner finds its place). Find it and Clues
 *   have three levels: a shortlist of four, free hand, and no borders at
 *   all, where a miss is measured but never named.
 *
 * How it runs: `main` loads the world outlines and the country table, draws
 * the map, and starts loading the Factbook in the background (a panel needs
 * it, the map does not). Clicking a country opens the panel, which fills in
 * as REST Countries (with a key) and Wikidata answer. In the quiz, the
 * Leitner picker (shared/leitner.js) chooses the next place from the region
 * chosen, countries only or with territories. "Name it" offers nearby countries as wrong options. "Find
 * it" judges the click against the country's outline, and every answer is
 * saved to the learner's progress.
 *
 * The files:
 * - app.js (this file): the map, the panel, the quiz and progress.
 * - quick-facts.js: the quick facts (domain, phone code, currency) and the
 *   clues the Clues quiz asks. Unit-tested.
 * - wikidata-facts.js: the one Wikidata query behind a panel's politics,
 *   people and symbols, with its cache. Its parsing is unit-tested.
 * - Shared code does the rest: the map view, outlines, distances, spaced
 *   repetition and the progress screen.
 *
 * @module countries/app
 */
import { $, $$, esc } from "../shared/dom.js";
import { HttpError, loadData } from "../shared/net.js";
import { storage } from "../shared/storage.js";
import { answerKey, judgeTyped, norm } from "../shared/text.js";
import { shuffle } from "../shared/random.js";
import { PROJECTIONS, savedProjection } from "../shared/projection.js";
import { bearing, distKm, formatKm, nearestOnRings } from "../shared/geo.js";
import { MapView } from "../shared/mapview.js";
import { MarkerLayer } from "../shared/overlay.js";
import { Tooltip, projectionSwitch } from "../shared/map-ui.js";
import { DetailPanel } from "../shared/panel.js";
import { CLUES, clueItems, clueKey, makeQuickFacts, quickRows } from "./quick-facts.js";
import { flagSvgUrl, hideFailedFlags } from "../shared/flags.js";
import { REGIONS, STATUS, byCode, parseCountries } from "../shared/countries.js";
import { RestCountries, createSettingsDialog, factRows } from "../shared/restcountries.js";
import { ProgressStore, createPicker, dueCount } from "../shared/leitner.js";
import { ProgressView } from "../shared/progress-ui.js";
import { wikidataUrl, wikipediaSearchUrl } from "../shared/wikidata.js";
import { drawWorld, largestPieces, loadWorld, projectPlace } from "../shared/world.js";
import { countryFacts } from "./wikidata-facts.js";

/** Below this size, in map units, a place gets a dot: its shape is too small to see or hit. */
const DOT_BELOW = 160;
/** Above this size a country needs no ring to be found. */
const RING_BELOW = 700;
/**
 * The no-borders level asks only about countries with a piece of land at
 * least this big (about the size of Cyprus): below it there is nothing to aim at.
 */
const AIM_MIN_KM2 = 5000;
/** The quiz direction, remembered between visits. */
const DIRECTION_KEY = "flagatlasmap.quizDir";
/** Which kind of clue the "Clues" quiz asks: one of CLUES, or "any". */
const CLUE_KEY = "flagatlasmap.quizClue";

const pageStatus = $("#pageStatus");
try {
  await main();
  pageStatus.remove();
} catch (e) {
  pageStatus.textContent = "The map data could not be loaded. Check your connection and reload.";
  throw e;
}

async function main() {
  const [world, countryText, quickJson] = await Promise.all([
    loadWorld(),
    loadData("countries.txt", "text"),
    // Small, and only the panels and the Clues quiz need it, so a failure is not fatal.
    loadData("quick-facts.json").catch(() => null),
  ]);
  const quick = makeQuickFacts(quickJson);
  // The factbook is only needed once a panel opens, so the map does not wait for it.
  let factbook = null;
  const factbookLoad = loadData("factbook.json").then((fb) => (factbook = fb));

  const DATA = parseCountries(countryText);
  const BY = byCode(DATA);
  hideFailedFlags();

  /**
   * The country an outline stands for when clicked. Where an outline is
   * shared (the United Kingdom and England), the sovereign state wins.
   */
  const shapeCode = world.shapes.map(({ codes }) => {
    const known = codes.filter((c) => BY[c]);
    return known.find((c) => BY[c].status !== "c") ?? known[0] ?? null;
  });
  /** country code → every ring drawn for it, for measuring how far off a click was */
  const ringsOf = new Map();
  for (const { codes, rings } of world.shapes) {
    for (const c of codes) ringsOf.set(c, [...(ringsOf.get(c) ?? []), ...rings]);
  }

  /* ================================================================ map */

  const svg = $("#map");
  const gWorld = $("#world");
  const gMarks = $("#marks");
  const panelEl = $("#panel");
  const quizBar = $("#quizbar");

  let projKey = savedProjection();
  const proj = () => PROJECTIONS[projKey];
  const markers = new MarkerLayer($("#overlay"), proj);
  const tip = new Tooltip($("#tip"), $("#stage"));

  const view = new MapView(svg, {
    projection: proj,
    minWidth: 40,
    // Leave room for the panel (beside the map on a wide screen, below it on a
    // narrow one) and for the quiz bar.
    padding: () => {
      const wide = innerWidth > 760;
      const open = !panelEl.hidden;
      return {
        side: open && wide ? panelEl.offsetWidth + 24 : 0,
        bottom:
          (open && !wide ? panelEl.offsetHeight : 0) +
          (quizBar.hidden ? 0 : quizBar.offsetHeight + 24),
      };
    },
    onChange: () => onViewChange(),
    onTap: (target, x, y) => pick(target, x, y),
    onHover: (e) => hover(e),
    onGestureStart: () => hideTip(),
  });
  view.bindZoomButtons($('[data-zoom="in"]'), $('[data-zoom="out"]'), $('[data-zoom="home"]'));

  /** country code → its outlines */
  let pathsOf = new Map();
  /** country code → its dot, for places too small to see */
  const dotOf = new Map();
  /** country code → its main landmass in the current projection */
  let placeOf = new Map();

  function drawMap() {
    const p = proj();
    pathsOf = drawWorld(gWorld, world.shapes, p, (i) => shapeCode[i] != null);
    placeOf = new Map();
    for (const d of DATA) {
      const info = world.info.get(d.code);
      if (info) placeOf.set(d.code, projectPlace(p, info));
    }
    gMarks.innerHTML = DATA.filter((d) => placeOf.has(d.code) && d.status !== "c")
      .filter((d) => Math.max(...placeOf.get(d.code).box.slice(2)) < DOT_BELOW)
      .map((d) => {
        const [x, y] = placeOf.get(d.code).middle;
        return `<circle class="mk" data-c="${esc(d.code)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0"/>`;
      })
      .join("");
    dotOf.clear();
    for (const c of $$("circle", gMarks)) dotOf.set(c.dataset.c, c);
  }

  /** After every move: dots show while their place is too small to see, markers keep their size. */
  function onViewChange() {
    const k = view.unitsPerPixel();
    for (const [code, dot] of dotOf) {
      const [, , w, h] = placeOf.get(code).box;
      // A dot that marks an answer stays, however far in the map is zoomed.
      const show =
        Math.max(w, h) / k < 14 ||
        ["target", "sel", "found", "miss"].some((c) => dot.classList.contains(c));
      dot.setAttribute("r", show ? (7 * k).toFixed(2) : "0");
    }
    markers.fit(k);
  }

  /** Mark a country, outline and dot, with a class. */
  function markCls(code, cls, on) {
    for (const p of pathsOf.get(code) ?? []) p.classList.toggle(cls, on);
    dotOf.get(code)?.classList.toggle(cls, on);
  }

  /** A ring around a country too small to spot, or nothing for a big one. */
  function ringAround(code, tone) {
    const info = world.info.get(code);
    const place = placeOf.get(code);
    if (!info || !place || Math.max(place.box[2], place.box[3]) >= RING_BELOW) return [];
    return [{ kind: "ring", lon: info.middle[0], lat: info.middle[1], size: 18, tone }];
  }

  const frameCode = (code, factor = 1.8, minSpan = 260) => {
    const place = placeOf.get(code);
    if (place) view.frame(place.box, factor, minSpan);
  };

  /** The smallest box, in map units, holding all these countries. */
  function hullOf(codes) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of codes) {
      const b = placeOf.get(c)?.box;
      if (!b) continue;
      x0 = Math.min(x0, b[0]);
      y0 = Math.min(y0, b[1]);
      x1 = Math.max(x1, b[0] + b[2]);
      y1 = Math.max(y1, b[1] + b[3]);
    }
    return x0 < x1 ? [x0, y0, x1 - x0, y1 - y0] : null;
  }

  const projSwitch = projectionSwitch($(".projsw"), {
    current: () => projKey,
    onSwitch(key) {
      const [lon, lat] = view.centreLonLat();
      projKey = key;
      hideTip();
      drawMap();
      repaint();
      view.centreAt(lon, lat);
      const outline = panel.part("[data-outline]");
      if (outline && selCode) outline.innerHTML = outlineSVG(BY[selCode]);
    },
  });

  /* ================================================== search and hover */

  $("#names").innerHTML = DATA.slice()
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((d) => `<option value="${esc(d.name)}">`)
    .join("");
  const search = new Map();
  for (const d of DATA) {
    for (const n of [d.name, ...d.aliases, d.code, d.a3].filter(Boolean)) {
      if (!search.has(norm(n))) search.set(norm(n), d.code);
    }
  }

  function findCode(query) {
    const k = norm(query.trim());
    if (!k) return null;
    if (search.has(k)) return search.get(k);
    const hit =
      DATA.find((d) => norm(d.name).startsWith(k)) ?? DATA.find((d) => norm(d.name).includes(k));
    return hit ? hit.code : null;
  }

  function goSearch(input) {
    const code = findCode(input.value.slice(0, 60));
    if (!code) return;
    select(code, true);
    input.blur();
  }
  $("#q").addEventListener("change", (e) => goSearch(e.target));
  $("#q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") goSearch(e.target);
  });

  /** The country under the pointer: a dot names it, an outline is looked up. */
  function codeFromTarget(t) {
    if (!t?.dataset) return null;
    if (t.dataset.c && BY[t.dataset.c]) return t.dataset.c;
    if (t.dataset.i != null) return shapeCode[Number(t.dataset.i)] ?? null;
    return null;
  }

  let hovCode = null;
  function hover(e) {
    if (mode !== "explore" || view.isGesturing() || e.pointerType === "touch") return;
    const c = codeFromTarget(e.target);
    if (c !== hovCode) {
      if (hovCode) markCls(hovCode, "hov", false);
      hovCode = c;
      if (c) markCls(c, "hov", true);
    }
    if (c) tip.show(BY[c].name, e.clientX, e.clientY);
    else hideTip();
  }
  function hideTip() {
    tip.hide();
    if (hovCode) markCls(hovCode, "hov", false);
    hovCode = null;
  }
  svg.addEventListener("pointerleave", hideTip);

  function pick(target, x, y) {
    $("#hint").hidden = true;
    const c = codeFromTarget(target);
    if (mode === "quiz") {
      if (qs.answered) {
        if (c) select(c, false);
      } else if (finding()) findPick(c, x, y);
      return;
    }
    if (c) select(c, false);
    else panel.close();
  }

  /* ====================================================== detail panel */

  const rc = new RestCountries();
  let selCode = null;
  /** What the panel's facts section shows: the place, and the state of each source. */
  let facts = null;
  let wdTimer = 0;

  const panel = new DetailPanel(panelEl, {
    onHide() {
      rc.cancel();
      clearTimeout(wdTimer);
      if (selCode) markCls(selCode, "sel", false);
      selCode = null;
      facts = null;
    },
    onDismiss() {
      if (mode === "explore") markers.clear();
    },
  });

  function select(code, fly) {
    if (!BY[code]) return;
    if (selCode) markCls(selCode, "sel", false);
    selCode = code;
    markCls(code, "sel", true);
    if (mode === "explore") markers.set(ringAround(code));
    openPanel(BY[code]);
    if (fly) frameCode(code, 2.4, 300);
  }

  /**
   * Details opened from the quiz must not cost the question, so the view is
   * remembered and the quiz's marks are put back when the panel closes.
   */
  function showDetails(code) {
    const back = view.snapshot();
    select(code, true);
    panel.showOver(() => {
      view.restore(back);
      repaint();
    });
  }

  /** The country and its neighbours, drawn from the map itself. */
  function outlineSVG(d) {
    const place = placeOf.get(d.code);
    if (!place) return "";
    const [bx, by, bw, bh] = place.box;
    const [mx, my] = place.middle;
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const w = Math.max(bw * 1.3, (bh * 1.3 * 4) / 3, 320);
    const h = (w * 3) / 4;
    const tiny = Math.max(bw, bh) < w * 0.06;
    return `<div class="outline"><svg viewBox="${cx - w / 2} ${cy - h / 2} ${w} ${h}" role="img" aria-label="Outline of ${esc(d.name)} and its neighbours"><rect class="sea" x="${cx - w}" y="${cy - h}" width="${w * 2}" height="${h * 2}"/><use href="#world"/>${
      tiny ? `<circle class="ring" cx="${mx}" cy="${my}" r="${w * 0.05}"/>` : ""
    }</svg></div>`;
  }

  function openPanel(d) {
    // The United Kingdom and its four constituent countries link to each other.
    const parts =
      d.code === "GB"
        ? ["GB-ENG", "GB-SCT", "GB-WLS", "GB-NIR"]
        : d.code.startsWith("GB-")
          ? ["GB"]
          : [];
    panel.show(`
      <div class="pflag flagbox"><img data-flag src="${flagSvgUrl(d.code)}" alt="Flag of ${esc(d.name)}"></div>
      <h2>${esc(d.name)}</h2>
      <div class="meta"><span class="tag code">${esc(d.code)}</span>${
        d.a3 ? `<span class="tag code">${esc(d.a3)}</span>` : ""
      }<span class="tag">${esc(REGIONS[d.region] ?? "")}</span><span class="tag">${esc(STATUS[d.status] ?? "")}</span></div>
      <div data-outline>${outlineSVG(d)}</div>
      <div class="prow"><button class="btn" data-zoom-to>Zoom map to ${esc(d.name)}</button>${parts
        .map((p) => `<button class="btn" data-go="${esc(p)}">${esc(BY[p].name)}</button>`)
        .join("")}</div>
      <div data-facts></div>`);
    facts = { code: d.code, rc: { state: "loading" }, wd: { state: "loading" } };
    renderFacts();
    loadRestCountries(d);
    loadWikidata(d);
    if (!factbook)
      factbookLoad.then(
        () => renderFacts(),
        () => {},
      );
  }

  panelEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-zoom-to]") && selCode) return frameCode(selCode, 2.4, 300);
    if (e.target.closest("[data-settings]")) return settings.open();
    const go = e.target.closest("[data-go]")?.dataset.go;
    if (go && BY[go]) select(go, true);
  });

  const dl = (rows) =>
    `<dl class="facts">${rows
      .filter((r) => r[1])
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join("")}</dl>`;

  /** Draw the facts section from whatever has arrived so far. */
  function renderFacts() {
    const el = panel.part("[data-facts]");
    if (!el || !facts) return;
    const d = BY[facts.code];
    const { rc: r, wd } = facts;
    let h = "<h3>At a glance</h3>";
    if (r.state === "ok") {
      h += dl(factRows(r.facts));
      if (r.facts.flagDesc) {
        h += `<p class="flagdesc"><strong>The flag.</strong> ${esc(r.facts.flagDesc)}</p>`;
      }
    } else {
      // Without REST Countries, Wikidata's basics stand in.
      if (wd.state === "ok" && wd.v.basic.length) h += dl(wd.v.basic);
      else if (wd.state === "loading") h += `<p class="loading">Loading…</p>`;
      const note =
        r.state === "nokey"
          ? `More detail is available with a REST Countries key. <button class="linkbtn" data-settings>Add a key</button>`
          : r.state === "loading"
            ? "Loading REST Countries…"
            : esc(r.message);
      h += `<p class="err spaced-s">${note}</p>`;
    }
    const quickFacts = quickRows(quick[d.code]);
    if (quickFacts.length) h += `<h3>Quick facts</h3>${dl(quickFacts)}`;
    if (wd.state === "ok") {
      const v = wd.v;
      if (v.politics.length) h += `<h3>Politics</h3>${dl(v.politics)}`;
      if (v.people.length) h += `<h3>People</h3>${dl(v.people)}`;
      if (v.more.length) h += `<h3>Symbols and more</h3>${dl(v.more)}`;
    } else if (wd.state === "err") {
      h += `<p class="err spaced">${esc(wd.message)}</p>`;
    } else if (r.state === "ok") {
      h += `<p class="loading">Loading Wikidata…</p>`;
    }
    h += "<h3>Geography</h3>";
    const fb = factbook?.[d.code];
    if (!factbook) h += `<p class="loading">Loading…</p>`;
    else if (fb) for (const sec of fb) h += (sec.l ? `<h4>${esc(sec.l)}</h4>` : "") + dl(sec.r);
    else {
      const covered =
        d.status === "t" || d.status === "c" ? "; it is covered under its parent country" : "";
      h += `<p class="err">The CIA World Factbook has no separate entry for ${esc(d.name)}${covered}.</p>`;
    }
    const qid = wd.state === "ok" ? wd.v.qid : "";
    h += `<p class="src">Geography: CIA World Factbook, final edition (discontinued February 2026, public domain). Politics and people, internet domain and phone code: <a href="${wikidataUrl(qid ?? "")}" target="_blank" rel="noopener noreferrer">Wikidata</a>, community-edited and sometimes incomplete. Currency: <a href="https://cldr.unicode.org/" target="_blank" rel="noopener noreferrer">Unicode CLDR</a>. ${
      r.state === "ok" ? "At a glance: REST Countries. " : ""
    }Flag: flagcdn.com. Map: Natural Earth. <a href="${wikipediaSearchUrl(d.name)}" target="_blank" rel="noopener noreferrer">Read about ${esc(d.name)} on Wikipedia</a>.</p>`;
    el.innerHTML = h;
  }

  function loadRestCountries(d, now = false) {
    const report = (state) => {
      if (facts?.code !== d.code) return;
      facts.rc = state;
      renderFacts();
    };
    if (d.code.includes("-")) {
      rc.cancel();
      report({
        state: "err",
        message: `REST Countries covers ISO countries and territories only, not ${d.name}.`,
      });
      return;
    }
    rc.load(d.code, report, { now });
  }

  function loadWikidata(d) {
    clearTimeout(wdTimer);
    const report = (state) => {
      if (facts?.code !== d.code) return;
      facts.wd = state;
      renderFacts();
    };
    wdTimer = setTimeout(async () => {
      try {
        const v = await countryFacts(d.code);
        if (!v.qid)
          report({ state: "err", message: "Wikidata has no current item for this place." });
        else report({ state: "ok", v });
      } catch (e) {
        report({
          state: "err",
          message:
            e instanceof HttpError && e.status === 429
              ? "Wikidata is rate-limiting requests. Wait a minute and reopen the place."
              : "Wikidata couldn't be reached. Check your connection and reopen the place.",
        });
      }
    }, 350);
  }

  const settings = createSettingsDialog(rc, {
    intro:
      "The key is optional. With it, each country's detail panel adds the official name, capital, population, area, languages and currency from REST Countries.",
    onChange: () => facts && loadRestCountries(BY[facts.code], true),
  });
  $("#setBtn").addEventListener("click", () => settings.open());

  /* ========================================================= progress */

  const store = new ProgressStore({ storageKey: "flagatlasmap.progress.v1", app: "flagatlasmap" });
  const keyOf = (d) => `c:${d.code}`;
  const picker = createPicker(store, keyOf);
  const cluePicker = createPicker(store, clueKey);
  /** A question's progress key: the place's, or the clue's. */
  const keyFor = (t) => (t.clue ? clueKey(t.clue) : keyOf(t));

  const progressDlg = $("#progress");
  const progress = new ProgressView($(".dlg", progressDlg), {
    store,
    appName: "Countries and Territories",
    lead: "One record per country or territory you are asked to find, and one per clue. Items you get wrong come back sooner.",
    closeButton: true,
    drills: () => [
      { label: "Countries and territories", keys: pool().map(keyOf) },
      ...Object.entries(CLUES).map(([kind, c]) => ({
        label: c.label,
        keys: clueItems(pool(), quick, [kind]).map(clueKey),
      })),
    ],
    describe: (key) => {
      const d = BY[key.slice(2)];
      // "p:" records are from the phone code clue, no longer asked.
      const what = { d: "internet domain", p: "phone code", m: "currency" }[key[0]];
      if (!d) return null;
      return { label: what ? `${d.name}: ${what}` : d.name, look: d.code };
    },
    onLook: (code) => {
      progressDlg.close();
      showDetails(code);
    },
    onErase: () => picker.reset(),
  });
  progressDlg.addEventListener("click", (e) => {
    if (e.target === progressDlg || e.target.closest("[data-close]")) progressDlg.close();
  });
  $("#progBtn").addEventListener("click", () => {
    progress.render();
    if (!progressDlg.open) progressDlg.showModal();
  });

  /* ============================================================= quiz */

  let mode = "explore";
  /** The quiz's state. */
  const qs = {
    level: "easy",
    dirn: ["find", "clue"].includes(storage.get(DIRECTION_KEY))
      ? storage.get(DIRECTION_KEY)
      : "name",
    clue: CLUES[storage.get(CLUE_KEY)] ? storage.get(CLUE_KEY) : "any",
    region: "all",
    scope: "countries",
    target: null,
    answered: false,
    right: 0,
    total: 0,
    streak: 0,
    due: 0,
    opts: [],
    /** the wrong country picked in "Find it" */
    picked: null,
    /** the spot clicked in "No borders", [lon, lat] */
    guess: null,
  };

  $("#qRegion").innerHTML =
    `<option value="all">All regions</option>` +
    Object.entries(REGIONS)
      .filter(([k]) => k !== "N")
      .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`)
      .join("");

  /**
   * The level the quiz actually runs at. "No borders" belongs to "Find it"
   * only, but the choice is kept as the learner left it, so switching
   * direction and back does not lose it.
   */
  const lvl = () => (qs.dirn === "name" && qs.level === "blind" ? "hard" : qs.level);
  /** Find it and Clues are both answered on the map. */
  const finding = () => qs.dirn !== "name";

  function setMode(m) {
    mode = m;
    document.body.classList.toggle("quiz", m === "quiz");
    document.body.classList.toggle("explore", m === "explore");
    syncFind();
    for (const b of $$("header [data-mode]")) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    }
    quizBar.hidden = m !== "quiz";
    $("#searchWrap").hidden = m === "quiz";
    hideTip();
    panel.close();
    clearTarget();
    if (m === "quiz") nextQ();
    else view.home();
  }

  for (const b of $$("header [data-mode]")) {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  }

  function setLevel(level, quiet) {
    const was = lvl();
    qs.level = ["easy", "hard", "blind"].includes(level) ? level : "easy";
    const find = finding();
    const [easy, hard, blind] = $$("[data-level]", quizBar);
    easy.textContent = find ? "Shortlist" : "Easy";
    hard.textContent = find ? "Free hand" : "Hard";
    blind.hidden = !find;
    for (const b of [easy, hard, blind]) {
      b.setAttribute("aria-pressed", String(b.dataset.level === lvl()));
    }
    syncFind();
    if (quiet || qs.answered) return;
    // The no-borders level draws from a smaller set, so a question from the other set is redrawn.
    if (find && qs.target && (was === "blind") !== (lvl() === "blind")) return nextQ();
    if (find && qs.target) stageFind();
    renderQ();
  }

  /**
   * Three ways: name the country the map points at, find the country the
   * quiz names, or find the country a clue (an internet domain or a
   * currency) belongs to.
   */
  function setDirn(d) {
    qs.dirn = ["find", "clue"].includes(d) ? d : "name";
    storage.set(DIRECTION_KEY, qs.dirn);
    for (const b of $$("[data-dirn]", quizBar)) {
      b.setAttribute("aria-pressed", String(b.dataset.dirn === qs.dirn));
    }
    $("#qClue").hidden = qs.dirn !== "clue";
    setLevel(qs.level, true); // the level buttons mean something different in each direction
    if (mode === "quiz") nextQ();
  }

  function syncFind() {
    const find = mode === "quiz" && finding();
    document.body.classList.toggle("findq", find);
    document.body.classList.toggle("blind", find && lvl() === "blind");
  }

  quizBar.addEventListener("click", (e) => {
    const dirn = e.target.closest("[data-dirn]")?.dataset.dirn;
    if (dirn) return setDirn(dirn);
    const level = e.target.closest("[data-level]")?.dataset.level;
    if (level) return setLevel(level);
    onQuizClick(e);
  });
  setDirn(qs.dirn); // labels and pressed state follow whatever was remembered
  $("#qRegion").addEventListener("change", (e) => {
    qs.region = REGIONS[e.target.value] ? e.target.value : "all";
    nextQ();
  });
  $("#qClue").innerHTML =
    `<option value="any">Any clue</option>` +
    Object.entries(CLUES)
      .map(([k, c]) => `<option value="${esc(k)}">${esc(c.label)}</option>`)
      .join("");
  $("#qClue").value = qs.clue;
  $("#qClue").addEventListener("change", (e) => {
    qs.clue = CLUES[e.target.value] ? e.target.value : "any";
    storage.set(CLUE_KEY, qs.clue);
    nextQ();
  });
  /** The clues the Clues quiz can ask, as its selects say. */
  const clues = () => clueItems(pool(), quick, qs.clue === "any" ? Object.keys(CLUES) : [qs.clue]);
  $("#qScope").addEventListener("change", (e) => {
    qs.scope = e.target.value === "all" ? "all" : "countries";
    nextQ();
  });

  /** Places the quiz may ask about, as the region and scope selects say. */
  const pool = () =>
    DATA.filter(
      (d) =>
        placeOf.has(d.code) &&
        d.status !== "c" &&
        d.region !== "N" &&
        (qs.scope === "all" || "uop".includes(d.status)) &&
        (qs.region === "all" || d.region === qs.region),
    );

  let landSizes = null;
  /**
   * Places a question may be drawn from. Only the no-borders level narrows
   * the pool, to countries with enough land to hit, unless that would leave
   * too few to practise.
   */
  function questionPool() {
    const p = pool();
    if (!(finding() && lvl() === "blind")) return p;
    landSizes ??= largestPieces(world.shapes);
    const big = p.filter((d) => (landSizes.get(d.code) ?? 0) >= AIM_MIN_KM2);
    return big.length >= 4 ? big : p;
  }

  function clearTarget() {
    if (qs.target) {
      markCls(qs.target.code, "target", false);
      markCls(qs.target.code, "found", false);
    }
    clearCandidates();
    if (qs.picked) markCls(qs.picked, "miss", false);
    qs.picked = null;
    qs.target = null;
    qs.guess = null;
    markers.clear();
  }

  const clearCandidates = () => qs.opts.forEach((o) => markCls(o.code, "cand", false));

  /**
   * Paint the quiz's marks on the map again: after a projection switch, or
   * when details opened from the quiz close. In "Find it" the map gives
   * nothing away until the question is answered.
   */
  function repaint() {
    if (selCode) markCls(selCode, "sel", true);
    const t = qs.target;
    if (mode !== "quiz" || !t) {
      markers.set(mode === "explore" && selCode ? ringAround(selCode) : []);
      return;
    }
    if (!finding()) {
      markCls(t.code, "target", true);
      markers.set(ringAround(t.code));
      return;
    }
    if (!qs.answered) {
      if (lvl() === "easy") qs.opts.forEach((o) => markCls(o.code, "cand", true));
      markers.clear();
      return;
    }
    markCls(t.code, "found", true);
    if (qs.picked) markCls(qs.picked, "miss", true);
    markers.set([...ringAround(t.code, "ok"), ...guessMarkers()]);
  }

  /** The no-borders miss: the spot clicked, and a line to the nearest edge of the answer. */
  function guessMarkers() {
    if (!qs.guess) return [];
    const [lon, lat] = qs.guess;
    const [lon2, lat2] =
      nearestOnRings(ringsOf.get(qs.target.code) ?? [], lon, lat) ??
      world.info.get(qs.target.code).middle;
    return [
      { kind: "line", lon, lat, lon2, lat2 },
      { kind: "guess", lon, lat, size: 6 },
    ];
  }

  /**
   * "Find it" must give nothing away: no highlight, no ring. The shortlist
   * level outlines four candidates and frames them; the others show the
   * whole set being practised.
   */
  function stageFind() {
    clearCandidates();
    markers.clear();
    if (lvl() === "easy") {
      qs.opts.forEach((o) => markCls(o.code, "cand", true));
      view.frame(hullOf(qs.opts.map((o) => o.code)), 1.9, 300);
    } else {
      view.frame(hullOf(questionPool().map((d) => d.code)), 1.04, 300);
    }
    onViewChange();
  }

  function nextQ() {
    clearTarget();
    if (selCode) panel.close();
    let p = questionPool();
    let t;
    if (qs.dirn === "clue") {
      // Only places with a clue to ask; the question is the clue, and the
      // place it belongs to is the answer.
      const items = clues().filter((it) => p.some((d) => d.code === it.code));
      if (!items.length) {
        $("#qPrompt").textContent = "No clues to ask here. Choose another region or clue.";
        $("#qBody").innerHTML = "";
        $("#qFoot").innerHTML = "";
        return;
      }
      const item = cluePicker.next(items);
      t = { ...BY[item.code], clue: item };
      qs.due = dueCount(items, clueKey, store);
    } else {
      t = picker.next(p);
      qs.due = dueCount(p, keyOf, store);
    }
    qs.target = t;
    qs.answered = false;
    // Wrong options are nearby places, so the choice tests real knowledge of the area.
    const [tx, ty] = placeOf.get(t.code).middle;
    const near = p
      .filter((d) => d.code !== t.code)
      .map((d) => ({
        d,
        k: Math.hypot(placeOf.get(d.code).middle[0] - tx, placeOf.get(d.code).middle[1] - ty),
      }))
      .sort((a, b) => a.k - b.k)
      .slice(0, 8)
      .map((x) => x.d);
    qs.opts = shuffle([t, ...shuffle(near).slice(0, 3)]);
    if (finding()) {
      stageFind();
      renderQ();
      return;
    }
    markCls(t.code, "target", true);
    markers.set(ringAround(t.code));
    const [, , w, h] = placeOf.get(t.code).box;
    renderQ();
    frameCode(t.code, Math.max(w, h) < 300 ? 14 : 5, 1600);
  }

  function scoreLine() {
    $("#qScore").textContent = [
      qs.total ? `${qs.right} of ${qs.total}${qs.streak > 1 ? `, ${qs.streak} in a row` : ""}` : "",
      qs.due ? `${qs.due} due for review` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const SKIP = `<button class="btn quiet" data-skip>Show answer</button>`;

  function renderQ() {
    const t = qs.target;
    if (!t) return;
    scoreLine();
    if (finding()) {
      const kind = t.status === "t" ? "territory" : "country";
      // A clue names the fact, never the place.
      const it = t.clue ? "the right place" : esc(t.name);
      $("#qPrompt").textContent = t.clue
        ? CLUES[t.clue.kind].prompt(t.clue.value)
        : `Find ${t.name} on the map`;
      $("#qBody").innerHTML = `<p class="aimnote">${
        lvl() === "easy"
          ? `Four shapes are outlined. Click the one that is ${it}.`
          : lvl() === "blind"
            ? `No borders on this map. Click the spot where you think ${it} is — anywhere inside it counts.`
            : `Click the ${t.clue ? "place" : kind} itself. Drag and zoom first if you need to; small places show as a dot.`
      }</p>`;
      $("#qFoot").innerHTML = SKIP;
      return;
    }
    $("#qPrompt").textContent =
      t.status === "t" ? "Which territory is highlighted?" : "Which country is highlighted?";
    $("#qBody").innerHTML =
      lvl() === "easy"
        ? `<div class="opts">${qs.opts
            .map(
              (o, i) =>
                `<button data-a="${esc(o.code)}"><kbd>${i + 1}</kbd>${esc(o.name)}</button>`,
            )
            .join("")}</div>`
        : `<div class="typed"><input id="qIn" maxlength="60" autocomplete="off" spellcheck="false" aria-label="Type the name"><button class="btn primary" data-check>Check</button></div>`;
    if (lvl() !== "easy") setTimeout(() => $("#qIn")?.focus({ preventScroll: true }), 50);
    $("#qFoot").innerHTML = SKIP;
  }

  /**
   * Every name a country is accepted under, with any bracketed part dropped
   * as well, and an index from each name back to its country, so a typed
   * answer that names another place can say which.
   */
  const namesOf = (d) => [d.name, d.name.replace(/\s*\(.*?\)\s*/g, " "), ...d.aliases];
  const answerIndex = new Map();
  for (const d of DATA) {
    for (const n of namesOf(d)) {
      const k = answerKey(n);
      if (k && !answerIndex.has(k)) answerIndex.set(k, d.code);
    }
  }

  function finish(ok, msg) {
    qs.answered = true;
    qs.total++;
    if (qs.target) store.record(keyFor(qs.target), ok);
    if (ok) {
      qs.right++;
      qs.streak++;
    } else qs.streak = 0;
    qs.due = qs.target?.clue ? dueCount(clues(), clueKey, store) : dueCount(pool(), keyOf, store);
    scoreLine();
    $("#qFoot").innerHTML =
      `<span class="msg ${ok ? "ok" : "bad"}">${msg}</span><button class="btn" data-details>Details</button><button class="btn primary" data-next>Next</button>`;
    $("#qFoot [data-next]").focus({ preventScroll: true });
  }

  /** A nudge that costs nothing: a click on water, or outside the shortlist, is not an answer. */
  let nudgeTimer = 0;
  function nudge(msg) {
    clearTimeout(nudgeTimer);
    $("#qFoot").innerHTML = `<span class="msg">${esc(msg)}</span>${SKIP}`;
    nudgeTimer = setTimeout(() => {
      if (!qs.answered && finding()) $("#qFoot").innerHTML = SKIP;
    }, 3000);
  }

  /** For a clue, what tied the place to it: ": its internet domain is .pl". */
  const because = (t, sep) =>
    t.clue ? `${sep}${esc(CLUES[t.clue.kind].answer(t.clue.value))}` : "";

  function revealTarget(picked) {
    const t = qs.target;
    if (!t) return;
    clearCandidates();
    markCls(t.code, "found", true);
    markers.set(ringAround(t.code, "ok"));
    // If the wrong pick is near enough, frame both, so the distance shows.
    const both = picked && hullOf([picked, t.code]);
    if (both && Math.max(both[2], both[3]) < proj().extent[2] * 0.34) view.frame(both, 1.35, 300);
    else frameCode(t.code, 3, 300);
  }

  function findPick(c, x, y) {
    const t = qs.target;
    if (!t) return;
    if (lvl() === "blind") return blindPick(c, x, y);
    if (!c || !BY[c]) return nudge("That is open water. Click the country itself.");
    if (lvl() === "easy" && !qs.opts.some((o) => o.code === c)) {
      return nudge("Not one of the four outlined shapes.");
    }
    clearTimeout(nudgeTimer);
    const ok = c === t.code;
    if (!ok) {
      qs.picked = c;
      markCls(c, "miss", true);
    }
    revealTarget(ok ? null : c);
    finish(
      ok,
      ok
        ? `Correct${because(t, ": ")}.`
        : `You picked ${esc(BY[c].name)}, in red. ${esc(t.name)} is the one in green${because(t, ": ")}.`,
    );
  }

  /**
   * No borders: the answer is a spot, not a shape. Anywhere inside the
   * country counts, and a miss is measured but never named: saying which
   * country was hit would give the game away.
   */
  function blindPick(c, x, y) {
    const t = qs.target;
    clearTimeout(nudgeTimer);
    const [mx, my] = view.toMap(x, y);
    const [lon, lat] = proj().inv(mx, my);
    clearCandidates();
    markCls(t.code, "found", true);
    if (c === t.code) {
      markers.set(ringAround(t.code, "ok"));
      frameCode(t.code, 2.6, 300);
      finish(true, `Correct — that is inside ${esc(t.name)}${because(t, "; ")}.`);
      return;
    }
    qs.guess = [lon, lat];
    const [line] = guessMarkers();
    markers.set([...ringAround(t.code, "ok"), ...guessMarkers()]);
    const km = distKm(lon, lat, line.lon2, line.lat2);
    // Frame the country and the spot clicked together.
    const b = placeOf.get(t.code).box;
    const x0 = Math.min(b[0], mx);
    const y0 = Math.min(b[1], my);
    view.frame([x0, y0, Math.max(b[0] + b[2], mx) - x0, Math.max(b[1] + b[3], my) - y0], 1.45, 300);
    // One bearing, always read the same way: where the country lies as seen from the click.
    finish(
      false,
      `Not quite. ${esc(t.name)} is about ${esc(formatKm(km))} km ${esc(bearing(lon, lat, line.lon2, line.lat2))} of where you clicked${because(t, "; ")}.`,
    );
  }

  function onQuizClick(e) {
    const t = qs.target;
    if (!t) return;
    const a = e.target.closest("[data-a]");
    if (a && !qs.answered) {
      const ok = a.dataset.a === t.code;
      for (const b of $$("[data-a]", $("#qBody"))) {
        if (b.dataset.a === t.code) b.classList.add("right");
        else if (b === a) b.classList.add("wrong");
      }
      finish(ok, ok ? "Correct." : `That's ${esc(t.name)}.`);
    }
    if (e.target.closest("[data-check]") && !qs.answered) checkTyped();
    if (e.target.closest("[data-skip]") && !qs.answered) {
      if (finding()) revealTarget();
      finish(false, `It's ${esc(t.name)}${because(t, ": ")}.`);
    }
    if (e.target.closest("[data-next]")) nextQ();
    if (e.target.closest("[data-details]")) showDetails(t.code);
  }

  function checkTyped() {
    const input = $("#qIn");
    if (!input) return;
    const t = qs.target;
    const verdict = judgeTyped(input.value, namesOf(t), (key) => {
      const code = answerIndex.get(key);
      return code && code !== t.code ? code : undefined;
    });
    if (!verdict) {
      input.focus();
      return;
    }
    input.disabled = true;
    const name = esc(t.name);
    if (verdict.ok) finish(true, verdict.typo ? `Correct: ${name}.` : "Correct.");
    else if (verdict.other) {
      finish(false, `That's the name of ${esc(BY[verdict.other].name)}. This is ${name}.`);
    } else finish(false, `Not quite. This is ${name}.`);
  }

  document.addEventListener("keydown", (e) => {
    if (mode !== "quiz" || document.querySelector("dialog[open]")) return;
    if (e.target.id === "qIn" && e.key === "Enter") {
      e.preventDefault();
      if (qs.answered) nextQ();
      else checkTyped();
      return;
    }
    if (e.target.matches("input, select, textarea")) return;
    if (!qs.answered && lvl() === "easy" && qs.dirn === "name" && /^[1-4]$/.test(e.key)) {
      $$("[data-a]", $("#qBody"))[Number(e.key) - 1]?.click();
    } else if (qs.answered && e.key === "Enter" && !e.target.closest("button")) {
      e.preventDefault();
      nextQ();
    }
  });

  /* ============================================================ start */

  drawMap();
  projSwitch.sync();
  view.home();
}
