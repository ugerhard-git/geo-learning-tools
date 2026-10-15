/**
 * Flags: every flag on one page, to browse, group, and quiz yourself on.
 *
 * - The page: search, filter by region and status, sort or group (by look-
 *   alikes, colour, layout, symbols, number of colours, date adopted), and
 *   blur the names to test yourself.
 * - A flag's details: where it is on the map, its design, the flags it is
 *   confused with, country facts from REST Countries (with a key), and the
 *   Wikipedia article and Wikidata facts about the flag.
 * - The quiz: whose flag is this, from four choices or typed.
 *
 * How it runs: `main` loads the country table, the flag tags and the world
 * outlines (src/data/), then draws the grid. Flag images come from
 * flagcdn.com. Adoption dates are fetched from Wikidata the first time
 * someone sorts by them, and kept for a while. Opening a flag fills the
 * detail view part by part, as each outside source answers. The quiz runs in
 * a dialog: the Leitner picker (shared/leitner.js) chooses the next flag from
 * the ones on screen, the flag's look-alikes make the wrong options, and
 * every answer is saved to the learner's progress.
 *
 * The files:
 * - app.js (this file): the page — grid, detail view, quiz and progress.
 * - design.js: what each flag looks like (colours, layout, symbols) and which
 *   flags are easily mistaken for one another. No page access, so it is
 *   unit-tested.
 * - Shared code does the rest: the country table, world outlines, spaced
 *   repetition, the progress screen and the outside services.
 *
 * @module flags/app
 */
import { $, $$, esc } from "../shared/dom.js";
import { loadData, str } from "../shared/net.js";
import { isFreshTime, storage } from "../shared/storage.js";
import { answerKey, judgeTyped, norm } from "../shared/text.js";
import { shuffle } from "../shared/random.js";
import { PROJECTIONS, saveProjection, savedProjection, worldFrame } from "../shared/projection.js";
import { flagSvgUrl, flagUrl, hideFailedFlags } from "../shared/flags.js";
import { REGIONS, STATUS, byCode, flagArticleTitles, parseCountries } from "../shared/countries.js";
import { RestCountries, createSettingsDialog, factsList } from "../shared/restcountries.js";
import { ProgressStore, createPicker, dueCount } from "../shared/leitner.js";
import { ProgressView } from "../shared/progress-ui.js";
import {
  QID,
  fetchEntity,
  fetchIntro,
  fetchLabels,
  sparql,
  wikidataUrl,
  wikipediaUrl,
} from "../shared/wikidata.js";
import { drawWorld, loadWorld, projectPlace } from "../shared/world.js";
import {
  ALIKE,
  COLOURS,
  LAYOUTS,
  NOT_QUIZZABLE,
  NO_OWN_FLAG,
  SYMBOLS,
  lookAlikes,
  parseTags,
} from "./design.js";

/** The projection notes, worded for a page about flags. */
const NOTES = {
  ee: "Countries are shown at their true relative size. Shapes near the poles and the edges are compressed.",
  merc: "Local shapes and angles are true. Areas grow toward the poles, so Greenland looks about as big as Africa.",
};

/** Adoption dates: one Wikidata query for every flag, cached for 30 days. */
const ADOPTION_KEY = "flagatlas.adoption.v1";
const ADOPTION_DAYS = 30;
const LEVEL_KEY = "flagatlas.quizLevel";

const ERAS = [
  [-9999, 1799, "Before 1800"],
  [1800, 1899, "1800 to 1899"],
  [1900, 1945, "1900 to 1945"],
  [1946, 1979, "1946 to 1979: the decolonisation wave"],
  [1980, 1999, "1980 to 1999"],
  [2000, 9999, "2000 and later"],
];

const flagPng = (d, w = 320) => flagUrl(d.code, "w", w);
const swatch = (k) => `<span class="sw c-${esc(k)}"></span>`;

try {
  await main();
} catch (e) {
  $("#main").innerHTML =
    `<p class="banner" role="status">The flags could not be loaded. Check your connection and reload.</p>`;
  throw e;
}

async function main() {
  const [countryText, tagText, world] = await Promise.all([
    loadData("countries.txt", "text"),
    loadData("flag-tags.txt", "text"),
    loadWorld(),
  ]);
  const tags = parseTags(tagText);
  const ALIKE_OF = lookAlikes();
  hideFailedFlags("img");

  /** Every place with a flag of its own, with its design and what search matches. */
  const DATA = parseCountries(countryText)
    .filter((c) => !NO_OWN_FLAG.has(c.code))
    .map((c) => ({
      ...c,
      ...(tags.get(c.code) ?? { col: [], lay: "q", sym: [] }),
      hay: norm([c.name, ...c.aliases].join(" ")),
      codesLc: [c.code, c.a3].filter(Boolean).map((x) => x.toLowerCase()),
    }));
  const BY = byCode(DATA);
  const quizzable = (d) => !NOT_QUIZZABLE.has(d.code);

  /* ============================================================ list */

  const st = { q: "", sort: "name", status: "all", region: "all", hide: false, order: null };
  /** The flags on screen, in order; the quiz and the detail view's arrows use them. */
  let visible = [];

  $("#regions").innerHTML =
    [["all", "All regions"], ...Object.entries(REGIONS)]
      .map(
        ([k, v]) =>
          `<button class="chip" data-r="${esc(k)}" aria-pressed="${k === "all"}">${esc(v)}</button>`,
      )
      .join("") + `<span class="count" id="count"></span>`;

  function filtered() {
    const q = norm(st.q.trim());
    return DATA.filter((d) => {
      if (st.region !== "all" && d.region !== st.region) return false;
      if (st.status === "un" && d.status !== "u") return false;
      if (st.status === "uno" && !"uo".includes(d.status)) return false;
      if (st.status === "other" && d.status === "u") return false;
      if (!q) return true;
      return d.hay.includes(q) || d.codesLc.some((c) => c.startsWith(q));
    });
  }

  const byName = (a, b) => a.name.localeCompare(b.name, "en");

  /** The flags, in groups as the sort select says. Null while adoption dates load. */
  function groups(list) {
    const q = norm(st.q.trim());
    // A flag whose code is exactly what was typed comes first.
    const exact = (d) => (q && d.codesLc.includes(q) ? 0 : 1);
    const sorted = (arr, f = byName) => arr.slice().sort((a, b) => exact(a) - exact(b) || f(a, b));
    switch (st.sort) {
      case "code":
        return [{ items: sorted(list, (a, b) => a.code.localeCompare(b.code)) }];
      case "shuffle": {
        st.order ??= new Map(shuffle(DATA.map((d) => d.code)).map((c, i) => [c, i]));
        return [
          { items: list.slice().sort((a, b) => st.order.get(a.code) - st.order.get(b.code)) },
        ];
      }
      case "region":
        return Object.entries(REGIONS).map(([k, v]) => ({
          title: v,
          items: sorted(list.filter((d) => d.region === k)),
        }));
      case "alike": {
        const inList = new Set(list.map((d) => d.code));
        const used = new Set();
        const out = ALIKE.map((g) => {
          const items = g.codes.filter((c) => inList.has(c)).map((c) => BY[c]);
          items.forEach((d) => used.add(d.code));
          return { title: g.title, items };
        }).filter((g) => g.items.length > 1);
        out.push({
          title: "Everything else",
          note: "No close look-alike in this collection.",
          items: sorted(list.filter((d) => !used.has(d.code))),
        });
        return out;
      }
      case "colour":
        return Object.entries(COLOURS).map(([k, name]) => ({
          title: name,
          sw: k,
          note: "The colour covering the largest share of the flag.",
          items: sorted(list.filter((d) => d.col[0] === k)),
        }));
      case "layout":
        return Object.entries(LAYOUTS).map(([k, [title, note]]) => ({
          title,
          note,
          items: sorted(list.filter((d) => d.lay === k)),
        }));
      case "symbol": {
        const out = Object.entries(SYMBOLS).map(([k, title]) => ({
          title,
          items: sorted(list.filter((d) => d.sym.includes(k))),
        }));
        out.push({
          title: "No symbols",
          note: "Pure geometry: stripes, crosses and fields only.",
          items: sorted(list.filter((d) => !d.sym.length)),
        });
        return out;
      }
      case "ncol": {
        const n = (d) => new Set(d.col).size;
        const words = ["", "", "Two", "Three", "Four", "Five"];
        return [2, 3, 4, 5, 6].map((k) => ({
          title: k < 6 ? `${words[k]} colours` : "Six or more colours",
          items: sorted(list.filter((d) => (k < 6 ? n(d) === k : n(d) >= 6))),
        }));
      }
      case "date": {
        if (!adoption.years) return null;
        const year = (d) => adoption.years[d.code];
        const out = ERAS.map(([from, to, title]) => ({
          title,
          year: true,
          items: list
            .filter((d) => year(d) != null && year(d) >= from && year(d) <= to)
            .sort((x, y) => year(x) - year(y) || byName(x, y)),
        }));
        out.push({
          title: "Date not recorded in Wikidata",
          items: sorted(list.filter((d) => year(d) == null)),
        });
        return out;
      }
      default:
        return [{ items: sorted(list) }];
    }
  }

  function tile(d, showYear) {
    const year = adoption.years?.[d.code];
    const sub =
      showYear && year != null ? `Adopted ${year}` : `${d.code}${d.a3 ? ` · ${d.a3}` : ""}`;
    return `<button class="tile" data-c="${esc(d.code)}" aria-label="${st.hide ? "Hidden flag" : esc(d.name)}">
      <span class="f"><img loading="lazy" src="${flagPng(d)}" srcset="${flagPng(d, 640)} 2x" alt=""></span>
      <span class="n">${esc(d.name)}</span><span class="c">${esc(sub)}</span></button>`;
  }

  function render() {
    const main = $("#main");
    let gs = groups(filtered());
    if (!gs) {
      main.innerHTML = `<p class="banner" role="status">${
        adoption.error ? esc(adoption.error) : "Loading adoption dates from Wikidata…"
      }</p>`;
      visible = [];
      $("#count").textContent = "";
      return;
    }
    gs = gs.filter((g) => g.items.length);
    const seen = new Set();
    visible = gs.flatMap((g) => g.items).filter((d) => !seen.has(d.code) && seen.add(d.code));
    const intro =
      st.sort === "date"
        ? `<p class="banner">Adoption dates come from Wikidata and describe the current design. Territories using another country's flag show that flag's date.</p>`
        : "";
    main.innerHTML = visible.length
      ? intro +
        gs
          .map(
            (g) =>
              `<section class="group">${g.title ? `<h2>${g.sw ? swatch(g.sw) : ""}${esc(g.title)}</h2>` : ""}${
                g.note ? `<p class="note">${esc(g.note)}</p>` : ""
              }<div class="grid">${g.items.map((d) => tile(d, g.year)).join("")}</div></section>`,
          )
          .join("")
      : `<p class="empty">No flag matches “${esc(st.q)}”. Try a shorter name or a two- or three-letter code.</p>`;
    $("#count").textContent = `${visible.length} flag${visible.length === 1 ? "" : "s"}`;
  }

  $("#q").addEventListener("input", (e) => {
    st.q = e.target.value.slice(0, 60);
    render();
  });
  $("#sort").addEventListener("change", (e) => {
    st.sort = e.target.value;
    if (st.sort === "shuffle") st.order = null;
    if (st.sort === "date") loadAdoption();
    render();
  });
  $("#status").addEventListener("change", (e) => {
    st.status = e.target.value;
    render();
  });
  $("#regions").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    st.region = REGIONS[chip.dataset.r] ? chip.dataset.r : "all";
    for (const x of $$(".chip")) x.setAttribute("aria-pressed", String(x === chip));
    render();
  });
  $("#hide").addEventListener("click", (e) => {
    st.hide = !st.hide;
    e.currentTarget.setAttribute("aria-pressed", String(st.hide));
    document.body.classList.toggle("hide", st.hide);
    render();
  });
  $("#main").addEventListener("click", (e) => {
    const t = e.target.closest(".tile");
    if (t && BY[t.dataset.c]) openDetail(t.dataset.c);
  });

  /* -------------------------------------------------- adoption dates */

  const adoption = { years: null, error: null, loading: false };

  /** Years read back from storage, kept only where they make sense. */
  function cleanYears(o) {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (BY[k] && Number.isInteger(v) && v > -3000 && v < 3000) out[k] = v;
    }
    return out;
  }

  async function loadAdoption() {
    if (adoption.years || adoption.loading) return;
    const cached = storage.object(ADOPTION_KEY);
    if (
      cached &&
      isFreshTime(cached.t, Date.now(), ADOPTION_DAYS * 864e5) &&
      cached.d &&
      typeof cached.d === "object"
    ) {
      adoption.years = cleanYears(cached.d);
      render();
      return;
    }
    adoption.loading = true;
    adoption.error = null;
    // The constituent countries of the United Kingdom have subdivision codes, not ISO codes.
    const query = `SELECT ?code (MIN(?d) AS ?date) WHERE {
      { ?c wdt:P297 ?code } UNION { ?c wdt:P300 ?code FILTER(?code IN ("GB-ENG","GB-SCT","GB-WLS","GB-NIR")) }
      ?c p:P163 ?s . ?s ps:P163 ?flag . FILTER NOT EXISTS { ?s pq:P582 ?end }
      ?flag wdt:P571 ?d . } GROUP BY ?code`;
    try {
      const years = {};
      for (const b of await sparql(query)) {
        const code = str(b.code?.value, 10);
        const m = str(b.date?.value, 40).match(/^(-?\d{1,4})-/);
        if (BY[code] && m) years[code] = Number(m[1]);
      }
      adoption.years = years;
      storage.set(ADOPTION_KEY, JSON.stringify({ t: Date.now(), d: years }));
    } catch {
      adoption.error =
        "Adoption dates couldn't be loaded from Wikidata. Check your connection, then pick this sort again.";
    }
    adoption.loading = false;
    if (st.sort === "date") render();
  }

  /* ============================================================= map */

  let projKey = savedProjection();
  /** country code → its outlines in the shared world drawing */
  let pathsOf = new Map();
  let drawnFor = null;

  /** Draw the world once per projection; every detail view shows it through <use>. */
  function drawMap() {
    if (drawnFor === projKey) return;
    drawnFor = projKey;
    pathsOf = drawWorld($("#world"), world.shapes, PROJECTIONS[projKey]);
  }

  function highlight(code) {
    for (const p of $$("#world path.hl")) p.classList.remove("hl");
    for (const p of pathsOf.get(code) ?? []) p.classList.add("hl");
  }

  /** The projection switch and two maps: the world, and the place with its neighbours. */
  function mapsHTML(d) {
    const proj = PROJECTIONS[projKey];
    const bar = `<div class="projbar"><span class="plab">Projection</span><div class="seg" role="group" aria-label="Map projection">${Object.entries(
      PROJECTIONS,
    )
      .map(
        ([k, p]) => `<button data-proj="${k}" aria-pressed="${k === projKey}">${p.name}</button>`,
      )
      .join("")}</div><span class="pnote">${esc(NOTES[projKey])}</span></div>`;
    const info = world.info.get(d.code);
    if (!info) return `${bar}<p class="err">No map outline is available for ${esc(d.name)}.</p>`;
    const {
      box: [bx, by, bw, bh],
      middle: [mx, my],
    } = projectPlace(proj, info);
    const small = Math.max(bw, bh) < 700;
    const frame = worldFrame(proj, info.box[1]);
    const whole = `<svg viewBox="${frame.join(" ")}" role="img" aria-label="${esc(d.name)} on a world map, ${proj.name} projection"><use href="#world"/>${
      small ? `<circle class="ring" cx="${mx}" cy="${my}" r="260"/>` : ""
    }</svg>`;
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const w = Math.max(bw * 1.3, (bh * 1.3 * 4) / 3, 320);
    const h = (w * 3) / 4;
    const tiny = Math.max(bw, bh) < w * 0.06;
    const outline = `<svg viewBox="${cx - w / 2} ${cy - h / 2} ${w} ${h}" role="img" aria-label="Outline of ${esc(d.name)}"><rect x="${cx - w}" y="${cy - h}" width="${w * 2}" height="${h * 2}" class="sea"/><use href="#world"/>${
      tiny ? `<circle class="ring" cx="${mx}" cy="${my}" r="${w * 0.05}"/>` : ""
    }</svg>`;
    return `${bar}<div class="maps"><div class="map">${whole}<span class="lbl">World</span></div><div class="map">${outline}<span class="lbl">Outline and neighbours</span></div></div>`;
  }

  function setProjection(k) {
    if (!PROJECTIONS[k] || k === projKey) return;
    projKey = k;
    saveProjection(k);
    drawMap();
    const wrap = $("#mapsWrap");
    if (wrap && current) {
      wrap.innerHTML = mapsHTML(BY[current]);
      highlight(current);
      wrap.querySelector(`[data-proj="${k}"]`)?.focus();
    }
  }

  /* ========================================================= details */

  const rc = new RestCountries();
  const detail = $("#detail");
  const body = $(".dlg", detail);
  /** The flag the detail view shows. */
  let current = null;

  /** Requests made once per session and shared by every view that needs them. */
  const memo = new Map();
  const once = (key, fn) => {
    if (!memo.has(key)) {
      memo.set(
        key,
        fn().catch((e) => {
          memo.delete(key);
          throw e;
        }),
      );
    }
    return memo.get(key);
  };

  /** The Wikipedia article about a place's flag, trying the likely titles in turn. */
  const flagArticle = (d) =>
    once(`w:${d.code}`, async () => {
      for (const title of flagArticleTitles(d)) {
        const intro = await fetchIntro(title);
        if (intro?.extract) return intro;
      }
      return null;
    });

  /** Facts about a flag recorded in Wikidata. */
  const FLAG_PROPS = [
    ["P571", "Adopted"],
    ["P580", "In use since"],
    ["P462", "Colours"],
    ["P180", "Shows"],
    ["P287", "Designed by"],
    ["P2061", "Aspect ratio"],
  ];

  const flagFacts = (qid) =>
    once(`d:${qid}`, async () => {
      const claims = (await fetchEntity(qid, "claims")).claims ?? {};
      const found = [];
      const ids = new Set();
      for (const [p, label] of FLAG_PROPS) {
        const vals = (Array.isArray(claims[p]) ? claims[p] : [])
          .filter((c) => c?.rank !== "deprecated")
          .map((c) => c?.mainsnak?.datavalue)
          .filter(Boolean)
          .slice(0, 12);
        if (!vals.length) continue;
        found.push({ label, vals });
        for (const v of vals) {
          if (v.type === "wikibase-entityid" && QID.test(v.value?.id ?? "")) ids.add(v.value.id);
        }
      }
      const labels = await fetchLabels([...ids]);
      const text = (v) => formatValue(v, labels);
      return found
        .map((r) => ({
          label: r.label,
          text: [...new Set(r.vals.map(text).filter(Boolean))].join(", "),
        }))
        .filter((r) => r.text);
    });

  /** One Wikidata value as text: a date to its recorded precision, an item by its label. */
  function formatValue(v, labels) {
    if (v.type === "time") {
      const m = str(v.value?.time, 40).match(/^([+-])0*(\d{1,4})-(\d\d)-(\d\d)/);
      if (!m) return "";
      const [, sign, y, mo, da] = m;
      const precision = v.value.precision;
      const opts = { timeZone: "UTC" };
      if (precision >= 11 && Number(mo) && Number(da)) {
        return new Date(Date.UTC(Number(y), mo - 1, Number(da))).toLocaleDateString("en-GB", {
          ...opts,
          day: "numeric",
          month: "long",
          year: "numeric",
        });
      }
      if (precision === 10 && Number(mo)) {
        return new Date(Date.UTC(Number(y), mo - 1, 1)).toLocaleDateString("en-GB", {
          ...opts,
          month: "long",
          year: "numeric",
        });
      }
      return (sign === "-" ? "-" : "") + y;
    }
    if (v.type === "wikibase-entityid") return labels.get(v.value?.id) ?? "";
    if (v.type === "quantity") {
      const n = Number(v.value?.amount);
      return Number.isFinite(n) ? String(n) : "";
    }
    if (v.type === "string") return str(v.value, 120);
    if (v.type === "monolingualtext") return str(v.value?.text, 120);
    return "";
  }

  function designLine(d) {
    const colours = [...new Set(d.col)]
      .map((k) => `<span class="tag">${swatch(k)}${esc(COLOURS[k])}</span>`)
      .join("");
    const symbols = d.sym.map((k) => SYMBOLS[k].toLowerCase()).join(", ");
    return `<div class="meta">${colours}</div><p class="design"><span>Layout:</span> ${esc(LAYOUTS[d.lay][0])}${
      symbols ? ` <span>· Symbols:</span> ${esc(symbols)}` : ""
    }</p>`;
  }

  function openDetail(code) {
    const d = BY[code];
    if (!d) return;
    drawMap();
    current = code;
    const similar = [...(ALIKE_OF.get(code) ?? [])].map((c) => BY[c]).filter(Boolean);
    body.innerHTML = `
      <button class="close" aria-label="Close" data-close>×</button>
      <div class="dhead">
        <div class="bigflag"><img src="${flagSvgUrl(d.code)}" alt="Flag of ${esc(d.name)}"></div>
        <div>
          <h2 id="dname">${esc(d.name)}</h2>
          <div class="meta"><span class="tag code">${esc(d.code)}</span>${
            d.a3 ? `<span class="tag code">${esc(d.a3)}</span>` : ""
          }<span class="tag">${esc(REGIONS[d.region] ?? "")}</span><span class="tag">${esc(STATUS[d.status] ?? "")}</span></div>
          ${designLine(d)}
          ${
            similar.length
              ? `<div class="sim"><p>Easily confused with</p><div class="row">${similar
                  .map(
                    (s) =>
                      `<button data-go="${esc(s.code)}"><img src="${flagPng(s, 80)}" alt="">${esc(s.name)}</button>`,
                  )
                  .join("")}</div></div>`
              : ""
          }
          <div class="nav"><button class="btn" data-step="-1">Previous</button><button class="btn" data-step="1">Next</button></div>
        </div>
      </div>
      <div id="mapsWrap">${mapsHTML(d)}</div>
      <div class="cols">
        <div><h3>At a glance</h3><div data-facts class="loading">Loading country facts…</div><div data-flagfacts></div></div>
        <div class="wiki"><h3>About the flag</h3><div data-wiki class="loading">Loading Wikipedia…</div></div>
      </div>
      <p class="src" data-src>Flag images: flagcdn.com. Map: Natural Earth (public domain).</p>`;
    highlight(code);
    if (!detail.open) detail.showModal();
    body.scrollTop = 0;
    loadFacts(d);
    loadWiki(d);
  }

  /** Fill a part of the detail view, if it still shows this flag. */
  const fill = (d, selector, html) => {
    if (current !== d.code) return;
    const el = $(selector, body);
    if (!el) return;
    el.className = "";
    el.innerHTML = html;
  };

  function loadFacts(d, now = false) {
    if (d.code.includes("-")) {
      rc.cancel();
      fill(
        d,
        "[data-facts]",
        `<p class="err">REST Countries covers ISO countries and territories only, not ${esc(d.name)}.</p>`,
      );
      return;
    }
    rc.load(
      d.code,
      (s) => {
        if (s.state === "loading") return;
        const html =
          s.state === "ok"
            ? factsList(s.facts) +
              (s.facts.flagDesc
                ? `<p class="spaced"><strong>Flag description.</strong> ${esc(s.facts.flagDesc)}</p>`
                : "")
            : s.state === "nokey"
              ? `<p class="err">Add a REST Countries key to see the capital, population and languages. <button class="linkbtn" data-settings>Open settings</button></p>`
              : `<p class="err">${esc(s.message)}</p>`;
        fill(d, "[data-facts]", html);
      },
      { now },
    );
  }

  async function loadWiki(d) {
    try {
      const w = await flagArticle(d);
      if (current !== d.code) return;
      if (!w) {
        fill(d, "[data-wiki]", `<p class="err">Wikipedia has no article about this flag.</p>`);
        return;
      }
      const paragraphs = w.extract
        .split(/\n+/)
        .filter((p) => p.trim())
        .slice(0, 4);
      fill(
        d,
        "[data-wiki]",
        `${paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}<p><a href="${wikipediaUrl(w.title)}" target="_blank" rel="noopener noreferrer">Read “${esc(w.title)}” on Wikipedia</a></p>`,
      );
      $("[data-src]", body).textContent =
        "Flag images: flagcdn.com. Map: Natural Earth. Text: Wikipedia (CC BY-SA). Facts: REST Countries and Wikidata.";
      if (w.qid) {
        const rows = await flagFacts(w.qid);
        if (current !== d.code || !rows.length) return;
        fill(
          d,
          "[data-flagfacts]",
          `<h3 class="later">Flag facts</h3><dl class="facts">${rows
            .map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.text)}</dd>`)
            .join(
              "",
            )}</dl><p class="src"><a href="${wikidataUrl(w.qid)}" target="_blank" rel="noopener noreferrer">View on Wikidata</a></p>`,
        );
      }
    } catch {
      const el = $("[data-wiki]", body);
      if (current === d.code && el?.classList.contains("loading")) {
        fill(
          d,
          "[data-wiki]",
          `<p class="err">Wikipedia couldn't be reached. Check your connection and reopen the flag.</p>`,
        );
      }
    }
  }

  /** Page through the flags on screen. */
  function step(n) {
    const list = visible.length ? visible : DATA;
    const i = list.findIndex((d) => d.code === current);
    openDetail(list[(i + n + list.length) % list.length].code);
  }

  detail.addEventListener("click", (e) => {
    if (e.target === detail || e.target.closest("[data-close]")) return detail.close();
    if (e.target.closest("[data-settings]")) return settings.open();
    const go = e.target.closest("[data-go]")?.dataset.go;
    if (go) return openDetail(go);
    const s = e.target.closest("[data-step]");
    if (s) return step(Number(s.dataset.step) === 1 ? 1 : -1);
    const pj = e.target.closest("[data-proj]");
    if (pj) setProjection(pj.dataset.proj);
  });
  detail.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select") || quiz.open) return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });
  detail.addEventListener("close", () => {
    rc.cancel();
    current = null;
  });

  const settings = createSettingsDialog(rc, {
    intro:
      "The capital, population, languages and currency in each flag's detail view come from REST Countries, which requires a free API key.",
    onChange: () => current && loadFacts(BY[current], true),
  });
  $("#setBtn").addEventListener("click", () => settings.open());

  /* ======================================================== progress */

  const store = new ProgressStore({ storageKey: "flagatlas.progress.v1", app: "flagatlas" });
  const keyOf = (d) => `f:${d.code}`;
  const picker = createPicker(store, keyOf);

  const progressDlg = $("#progress");
  const progress = new ProgressView($(".dlg", progressDlg), {
    store,
    appName: "Flags",
    lead: "One record per flag, however you answered it. Items you get wrong come back sooner.",
    closeButton: true,
    drills: () => [{ label: "Flags", keys: DATA.filter(quizzable).map(keyOf) }],
    describe: (key) => {
      const d = BY[key.slice(2)];
      return d ? { label: d.name, look: d.code } : null;
    },
    onLook: (code) => {
      progressDlg.close();
      openDetail(code);
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

  /* ============================================================ quiz */

  const quiz = $("#quiz");
  const qbody = $(".dlg", quiz);
  const qs = {
    right: 0,
    total: 0,
    streak: 0,
    ans: null,
    locked: false,
    opts: [],
    pool: 0,
    due: 0,
    level: storage.get(LEVEL_KEY) === "hard" ? "hard" : "easy",
  };

  /** The flags in the current view, if there are enough of them; otherwise all. */
  function quizPool() {
    const base = (visible.length >= 4 ? visible : DATA).filter(quizzable);
    return base.length >= 4 ? base : DATA.filter(quizzable);
  }

  /** Every name a flag's place is accepted under, and an index back from each name. */
  const namesOf = (d) => [d.name, d.name.replace(/\s*\(.*?\)\s*/g, " "), ...d.aliases];
  const answerIndex = new Map();
  for (const d of DATA) {
    for (const n of namesOf(d)) {
      const k = answerKey(n);
      if (k && !answerIndex.has(k)) answerIndex.set(k, d.code);
    }
  }

  function nextQ() {
    const pool = quizPool();
    const ans = picker.next(pool);
    qs.ans = ans;
    qs.locked = false;
    qs.pool = pool.length;
    qs.due = dueCount(pool, keyOf, store);
    // Wrong options: its look-alikes first, then flags from the same region, then any.
    const candidates = [
      ...new Set([
        ...[...(ALIKE_OF.get(ans.code) ?? [])].map((c) => BY[c]).filter(Boolean),
        ...shuffle(DATA.filter((d) => d.region === ans.region && d !== ans)),
        ...shuffle(DATA.slice()),
      ]),
    ].filter((d) => d !== ans && quizzable(d));
    qs.opts = shuffle([ans, ...shuffle(candidates.slice(0, 6)).slice(0, 3)]);
    renderQ();
  }

  function scoreLine() {
    const head = qs.total
      ? `${qs.right} of ${qs.total} right${qs.streak > 1 ? `, ${qs.streak} in a row` : ""}`
      : `Drawn from the ${qs.pool} flags in your current view`;
    return qs.due ? `${head} · ${qs.due} due for review` : head;
  }

  function renderQ() {
    const easy = qs.level === "easy";
    const answer = easy
      ? `<div class="opts">${qs.opts
          .map(
            (o, i) => `<button data-a="${esc(o.code)}"><kbd>${i + 1}</kbd>${esc(o.name)}</button>`,
          )
          .join("")}</div>`
      : `<div class="typed"><input id="qIn" maxlength="60" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type the country or territory"><button class="btn primary" data-check>Check</button></div>`;
    qbody.innerHTML = `<button class="close" aria-label="Close quiz" data-close>×</button>
      <h2>Whose flag is this?</h2>
      <div class="qlevel"><div class="seg" role="group" aria-label="Difficulty"><button data-level="easy" aria-pressed="${easy}">Easy: pick from four</button><button data-level="hard" aria-pressed="${!easy}">Hard: type the name</button></div></div>
      <p class="qscore">${scoreLine()}</p>
      <div class="qflag"><img src="${flagSvgUrl(qs.ans.code)}" alt="Mystery flag"></div>
      ${answer}
      <div class="qfoot">${easy ? "" : `<button class="btn quiet" data-skip>Show answer</button>`}</div>`;
    // Keep the focus inside the quiz: replacing the markup drops it, and the
    // number keys only reach the quiz while something in it has the focus.
    if (easy) qbody.focus();
    else setTimeout(() => $("#qIn")?.focus(), 30);
  }

  function finish(ok, msg) {
    qs.locked = true;
    qs.total++;
    store.record(keyOf(qs.ans), ok);
    if (ok) {
      qs.right++;
      qs.streak++;
    } else qs.streak = 0;
    qs.due = dueCount(quizPool(), keyOf, store);
    $(".qscore", qbody).textContent = scoreLine();
    $(".qfoot", qbody).innerHTML =
      `<span class="qmsg ${ok ? "ok" : "bad"}">${msg}</span><button class="btn" data-more>Learn about this flag</button><button class="btn primary" data-next>Next flag</button>`;
    $("[data-next]", qbody).focus();
  }

  function checkTyped() {
    const input = $("#qIn");
    if (!input || qs.locked) return;
    const ans = qs.ans;
    const verdict = judgeTyped(input.value, namesOf(ans), (key) => {
      const code = answerIndex.get(key);
      return code && code !== ans.code ? code : undefined;
    });
    if (!verdict) {
      input.focus();
      return;
    }
    input.disabled = true;
    $("[data-check]", qbody).disabled = true;
    const name = esc(ans.name);
    if (verdict.ok) finish(true, verdict.typo ? `Correct: ${name}.` : "Correct.");
    else if (verdict.other) {
      finish(false, `That's the name of ${esc(BY[verdict.other].name)}. This flag is ${name}.`);
    } else finish(false, `Not quite. This is ${name}.`);
  }

  quiz.addEventListener("click", (e) => {
    if (e.target === quiz || e.target.closest("[data-close]")) return quiz.close();
    const level = e.target.closest("[data-level]")?.dataset.level;
    if ((level === "easy" || level === "hard") && level !== qs.level) {
      qs.level = level;
      storage.set(LEVEL_KEY, level);
      if (qs.locked) nextQ();
      else renderQ();
      return;
    }
    const a = e.target.closest("[data-a]");
    if (a && !qs.locked) {
      const ok = a.dataset.a === qs.ans.code;
      for (const b of $$("[data-a]", quiz)) {
        if (b.dataset.a === qs.ans.code) b.classList.add("right");
        else if (b === a) b.classList.add("wrong");
      }
      finish(ok, ok ? "Correct." : `That's ${esc(qs.ans.name)}.`);
    }
    if (e.target.closest("[data-check]")) checkTyped();
    if (e.target.closest("[data-skip]") && !qs.locked) {
      const input = $("#qIn");
      if (input) input.disabled = true;
      finish(false, `It's ${esc(qs.ans.name)}.`);
    }
    if (e.target.closest("[data-next]")) nextQ();
    // The detail view opens on top, so closing it drops you back into the quiz.
    if (e.target.closest("[data-more]")) openDetail(qs.ans.code);
  });
  quiz.addEventListener("keydown", (e) => {
    if (e.target.id === "qIn" && e.key === "Enter") {
      e.preventDefault();
      if (qs.locked) nextQ();
      else checkTyped();
      return;
    }
    if (e.target.matches("input")) return;
    if (!qs.locked && qs.level === "easy" && /^[1-4]$/.test(e.key)) {
      $$("[data-a]", quiz)[Number(e.key) - 1]?.click();
    }
  });
  $("#quizBtn").addEventListener("click", () => {
    nextQ();
    quiz.showModal();
  });

  render();
}
