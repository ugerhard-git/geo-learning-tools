/**
 * Terrain Atlas: 2,121 physical features (rivers, ranges, deserts, seas,
 * straits, islands, peaks …) on a zoomable world map, with three drills and
 * spaced repetition.
 *
 * - Explore: switch kinds of feature on and off, hover and click them, and
 *   read what Wikidata and Wikipedia know about each.
 * - Drill: locate a feature, name a highlighted one, or name it from the
 *   countries it touches.
 * - Progress: what is known, what is due, what keeps going wrong.
 *
 * @module terrain-atlas/app
 */
import { $, $$, esc, fmtNum } from "../shared/dom.js";
import { storage } from "../shared/storage.js";
import { norm } from "../shared/text.js";
import { str } from "../shared/net.js";
import { shuffle } from "../shared/random.js";
import { PROJECTIONS, savedProjection } from "../shared/projection.js";
import { ringsToPath } from "../shared/codec.js";
import { bearing, distKm, formatKm } from "../shared/geo.js";
import { MapView } from "../shared/mapview.js";
import { MarkerLayer } from "../shared/overlay.js";
import { Tooltip, drawLand, projectionSwitch } from "../shared/map-ui.js";
import { DetailPanel } from "../shared/panel.js";
import { loadLand } from "../shared/land.js";
import { ProgressStore, planSession } from "../shared/leitner.js";
import { ProgressView } from "../shared/progress-ui.js";
import {
  QID,
  fetchEntity,
  fetchIntro,
  fetchLabels,
  wikidataErrorText,
  wikidataUrl,
  wikipediaSearchUrl,
  wikipediaUrl,
} from "../shared/wikidata.js";
import {
  DrillSession,
  cleanLength,
  difficultySwitch,
  lengthSelect,
  startSection,
  typeButtons,
} from "../shared/drill.js";
import { CONTINENTS, KINDS, KIND_ORDER, loadFeatures } from "./data.js";
import {
  DRILLS,
  LEVELS,
  SCOPES,
  TerrainQuestion,
  featureDistance,
  inScope,
  keyOf,
  nearestFeature,
  nearestVertex,
  poolBox,
  poolFor,
} from "./drills.js";

/** Saved settings, one key each. Kept as they were in the single-file app. */
const SETTINGS = {
  layers: "terrain.layers",
  level: "terrain.level",
  type: "terrain.type",
  kinds: "terrain.kinds",
  scope: "terrain.scope",
  hard: "terrain.hard",
  len: "terrain.len",
};

const DEFAULT_LAYERS = ["riv", "lak", "rng", "des", "sea"];
const DEFAULT_KINDS = ["riv", "rng", "des", "sea"];

/** Measurements worth showing from Wikidata: property, label, unit. */
const WIKIDATA_PROPS = [
  ["P2043", "Length", "km"],
  ["P2044", "Elevation", "m"],
  ["P2046", "Area", "km²"],
  ["P4511", "Greatest depth", "m"],
  ["P2049", "Width", "km"],
  ["P610", "Highest point", ""],
  ["P885", "Source", ""],
  ["P403", "Mouth", ""],
  ["P138", "Named after", ""],
];

const pageStatus = $("#pageStatus");
try {
  await main();
  pageStatus.remove();
} catch (e) {
  pageStatus.textContent = "The map data could not be loaded. Check your connection and reload.";
  throw e;
}

async function main() {
  const [features, land] = await Promise.all([loadFeatures(), loadLand()]);
  const byId = new Map(features.map((f) => [f.i, f]));

  /* ================================================================ map */

  const svg = $("#map");
  const gWorld = $("#world");
  const gFeats = $("#feats");
  const panelEl = $("#panel");
  const drillBar = $("#drillbar");

  let projKey = savedProjection();
  const proj = () => PROJECTIONS[projKey];
  const markers = new MarkerLayer($("#overlay"), proj);
  const tip = new Tooltip($("#tip"), $("#stage"));

  const view = new MapView(svg, {
    projection: proj,
    padding: () => ({
      side: !panelEl.hidden && innerWidth > 760 ? panelEl.offsetWidth + 24 : 0,
      bottom: drillBar.hidden ? 0 : drillBar.offsetHeight + 28,
    }),
    onChange: () => onViewChange(),
    onTap: (_target, x, y) => pick(x, y),
    onHover: (e) => hover(e),
    onGestureStart: () => hideTip(),
  });
  view.bindZoomButtons($('[data-zoom="in"]'), $('[data-zoom="out"]'), $('[data-zoom="home"]'));

  /** feature id → its path or circle */
  const featureEls = new Map();

  /** Draw every feature, one group per kind so a kind can be shown or hidden at once. */
  function drawFeatures() {
    const p = proj();
    gFeats.innerHTML = KIND_ORDER.map((kind) => {
      const shapes = features
        .filter((f) => f.kind === kind)
        .map((f) => {
          if (f.geom === "x") {
            const [x, y] = p.fwd(f.parts[0][0], f.parts[0][1]);
            return `<circle data-f="${f.i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0"/>`;
          }
          const d = ringsToPath(f.parts, p, { close: f.geom === "p", minPoints: 1 });
          return `<path data-f="${f.i}" d="${d}"/>`;
        })
        .join("");
      return `<g class="k-${kind}${layers.has(kind) ? "" : " off"}" data-k="${kind}">${shapes}</g>`;
    }).join("");
    featureEls.clear();
    for (const el of $$("[data-f]", gFeats)) featureEls.set(Number(el.dataset.f), el);
  }

  /** When set, the only peaks shown: a drill reveals the one it asked about. */
  let peakFilter = null;

  /** After every move: keep markers and peaks a constant size on screen. */
  function onViewChange() {
    const k = view.unitsPerPixel();
    markers.fit(k);
    const peaks = gFeats.querySelector(".k-pea");
    if (!peaks || peaks.classList.contains("off")) return;
    const span = Math.min(200, (view.w / 20000) * 360);
    const r = (Math.min(4, Math.max(2.1, 2.1 + ((200 - span) / 200) * 1.9)) * k).toFixed(2);
    for (const c of peaks.querySelectorAll("circle")) {
      c.setAttribute("r", peakFilter && !peakFilter.has(Number(c.dataset.f)) ? "0" : r);
    }
  }

  const mark = (id, on) => featureEls.get(id)?.classList.toggle("on", on);

  const projSwitch = projectionSwitch($(".projsw"), {
    current: () => projKey,
    notes: {
      ee: "Equal Earth: features at their true relative size; shapes near the poles are compressed.",
    },
    onSwitch(key) {
      const [lon, lat] = view.centreLonLat();
      projKey = key;
      hideTip();
      drawLand(gWorld, land.shapes, proj());
      drawFeatures();
      if (selId != null) mark(selId, true);
      if (session.item) mark(session.item.i, true);
      markers.draw();
      view.centreAt(lon, lat);
    },
  });

  /* ============================================================ layers */

  /** The kinds the learner chose to see. */
  function savedLayers() {
    const list = (storage.get(SETTINGS.layers) ?? "").split(",").filter((k) => KINDS[k]);
    return list.length ? list : DEFAULT_LAYERS;
  }
  const layers = new Set(savedLayers());
  const saveLayers = () => storage.set(SETTINGS.layers, [...layers].join(","));

  /**
   * Show just these kinds for now. A drill narrows the map to one kind; that
   * is a temporary view, not a change to what the learner chose to see.
   */
  function showOnly(kinds) {
    layers.clear();
    for (const k of kinds) layers.add(k);
    applyLayers();
  }

  /** Put the learner's own choice of layers back. */
  const restoreLayers = () => showOnly(savedLayers());

  function applyLayers() {
    for (const g of $$("g[data-k]", gFeats)) g.classList.toggle("off", !layers.has(g.dataset.k));
    $("#layerRow").innerHTML = KIND_ORDER.map(
      (k) =>
        `<button data-layer="${k}" aria-pressed="${layers.has(k)}"><span class="sw k-${k}"></span>${esc(KINDS[k].label)}</button>`,
    ).join("");
    const shown = features.filter((f) => layers.has(f.kind)).length;
    $("#layerFoot").textContent = `${fmtNum(shown)} of ${fmtNum(features.length)} features shown`;
    onViewChange();
  }

  $("#layers").addEventListener("click", (e) => {
    const k = e.target.closest("[data-layer]")?.dataset.layer;
    if (!KINDS[k]) return;
    if (layers.has(k)) layers.delete(k);
    else layers.add(k);
    saveLayers();
    applyLayers();
  });

  /* ================================================== search and hover */

  const search = new Map();
  for (const f of features) {
    for (const n of [f.name, ...f.alts]) {
      const k = norm(n);
      if (k && !search.has(k)) search.set(k, f.i);
    }
  }
  $("#names").innerHTML = features
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .slice(0, 1200)
    .map((f) => `<option value="${esc(f.name)}">`)
    .join("");

  function findFeature(query) {
    const k = norm(String(query).trim());
    if (!k) return null;
    if (search.has(k)) return search.get(k);
    const f =
      features.find((x) => norm(x.name).startsWith(k)) ??
      features.find((x) => norm(x.name).includes(k));
    return f ? f.i : null;
  }

  function goSearch(input) {
    const id = findFeature(input.value.slice(0, 60));
    if (id == null) return;
    select(id, true);
    input.blur();
  }
  $("#q").addEventListener("change", (e) => goSearch(e.target));
  $("#q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") goSearch(e.target);
  });

  /** How far from the pointer a feature may be and still be picked: about 12 pixels. */
  const pickRadiusKm = () => view.unitsPerPixel() * 0.12 * 111;
  const visible = () => features.filter((f) => layers.has(f.kind));

  let hovId = null;
  let hoverEvent = null;
  let hoverFrame = 0;
  /** Finding the nearest feature is work, so hovering does it at most once a frame. */
  function hover(e) {
    if (mode !== "explore" || view.isGesturing() || e.pointerType === "touch") return;
    hoverEvent = e;
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const ev = hoverEvent;
      const [lon, lat] = view.toLonLat(ev.clientX, ev.clientY);
      const f = nearestFeature(visible(), lon, lat, pickRadiusKm());
      const id = f ? f.i : null;
      if (id !== hovId) {
        if (hovId != null && hovId !== selId) mark(hovId, false);
        hovId = id;
        if (id != null) mark(id, true);
      }
      if (f) tip.show(f.name, ev.clientX, ev.clientY);
      else hideTip();
    });
  }
  function hideTip() {
    tip.hide();
    if (hovId != null && hovId !== selId) mark(hovId, false);
    hovId = null;
  }
  svg.addEventListener("pointerleave", hideTip);

  function pick(x, y) {
    if (mode === "drill") return drillClick(x, y);
    if (mode !== "explore") return;
    const [lon, lat] = view.toLonLat(x, y);
    const f = nearestFeature(visible(), lon, lat, pickRadiusKm());
    if (f) select(f.i, false);
    else panel.close();
  }

  /* ====================================================== detail panel */

  let selId = null;
  let wikiFor = null;
  let wikiTimer = 0;
  const wikiCache = new Map();

  const panel = new DetailPanel(panelEl, {
    onHide() {
      clearTimeout(wikiTimer);
      wikiFor = null;
    },
    onDismiss() {
      if (selId != null) mark(selId, false);
      selId = null;
      markers.clear();
    },
  });

  /** The map as it stands, to put back when details opened over a drill close. */
  function snapshot() {
    const s = {
      view: view.snapshot(),
      sel: selId,
      markers: markers.items.slice(),
      layers: [...layers],
    };
    return () => {
      if (selId != null) mark(selId, false);
      selId = s.sel;
      if (selId != null) mark(selId, true);
      showOnly(s.layers);
      markers.set(s.markers);
      view.restore(s.view);
    };
  }

  function showDetails(look) {
    const back = snapshot();
    select(Number(look), true);
    panel.showOver(back);
  }

  function select(id, fly) {
    const f = byId.get(id);
    if (!f) return;
    if (selId != null) mark(selId, false);
    selId = id;
    mark(id, true);
    if (!layers.has(f.kind)) {
      layers.add(f.kind);
      saveLayers();
      applyLayers();
    }
    const point = f.geom === "x";
    markers.set(point ? [{ kind: "ring", lon: f.parts[0][0], lat: f.parts[0][1], size: 14 }] : []);
    openPanel(f);
    if (fly) view.frameLonLat(f.box, point ? 1 : 1.5, point ? 700 : 260);
  }

  function openPanel(f) {
    const point = f.geom === "x";
    const lat = `${Math.abs(f.middle[1]).toFixed(1)}° ${f.middle[1] >= 0 ? "N" : "S"}`;
    const lon = `${Math.abs(f.middle[0]).toFixed(1)}° ${f.middle[0] >= 0 ? "E" : "W"}`;
    const extent = point ? "" : `${f.box[2].toFixed(1)}° × ${f.box[3].toFixed(1)}°`;
    panel.show(`
      <h2>${esc(f.name)}</h2>
      <div class="meta"><span class="tag"><span class="sw k-${f.kind}"></span>${esc(KINDS[f.kind].one)}</span>
        <span class="tag">${esc(CONTINENTS[f.cont] ?? "")}</span></div>
      <dl class="facts">
        ${
          f.countries.length
            ? `<dt>${f.countries.length > 1 ? "Countries" : "Country"}</dt><dd>${esc(f.countries.join(", "))}</dd>`
            : ""
        }
        ${f.kind === "pea" && f.extra ? `<dt>Elevation</dt><dd>${fmtNum(Number(f.extra))} m</dd>` : ""}
        ${f.alts.length ? `<dt>Also called</dt><dd>${esc(f.alts.join(", "))}</dd>` : ""}
        <dt>Centre</dt><dd>${lat}, ${lon}</dd>
        ${extent ? `<dt>Extent</dt><dd>${esc(extent)}</dd>` : ""}
      </dl>
      <div class="prow"><button class="btn" data-zoom-to>Zoom to ${esc(f.name)}</button></div>
      <div data-wiki></div>
      <p class="src">Features and outlines: Natural Earth (public domain).
        <a href="${wikipediaSearchUrl(f.name)}" target="_blank" rel="noopener noreferrer">Search Wikipedia for ${esc(f.name)}</a>.</p>`);
    loadWiki(f);
  }

  panelEl.addEventListener("click", (e) => {
    if (!e.target.closest("[data-zoom-to]") || selId == null) return;
    const f = byId.get(selId);
    const point = f.geom === "x";
    view.frameLonLat(f.box, point ? 1 : 1.4, point ? 500 : 220);
  });

  /* ---------------------------- Wikidata and Wikipedia, by Natural Earth's id */

  function loadWiki(f) {
    clearTimeout(wikiTimer);
    wikiFor = f.i;
    const say = (html) => {
      const el = panel.part("[data-wiki]");
      if (el && wikiFor === f.i) el.innerHTML = html;
    };
    if (!QID.test(f.qid)) {
      say(
        `<p class="err spaced">Natural Earth has no Wikidata id for this feature, so there is nothing to look up automatically.</p>`,
      );
      return;
    }
    say(`<p class="loading spaced">Loading from Wikidata…</p>`);
    // A short wait, so moving the pointer across features does not fire a request for each.
    wikiTimer = setTimeout(async () => {
      try {
        const v = wikiCache.get(f.qid) ?? (await fetchWiki(f.qid));
        wikiCache.set(f.qid, v);
        say(wikiHTML(f, v));
      } catch (e) {
        say(`<p class="err spaced">${esc(wikidataErrorText(e, "the feature"))}</p>`);
      }
    }, 320);
  }

  function wikiHTML(f, v) {
    if (!v.rows.length && !v.extract && !v.desc) {
      return `<p class="err spaced">Wikidata has no extra detail recorded for this feature.</p>`;
    }
    const rows = v.rows.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.text)}</dd>`).join("");
    const paragraphs = v.extract
      .split(/\n+/)
      .slice(0, 3)
      .map((p) => `<p>${esc(p)}</p>`)
      .join("");
    return `${v.desc ? `<p class="shint spaced flush-bottom">${esc(v.desc)}</p>` : ""}
      ${rows ? `<h3>Measurements</h3><dl class="facts">${rows}</dl>` : ""}
      ${
        v.extract
          ? `<h3>About</h3><div class="wiki">${paragraphs}${
              v.title
                ? `<p><a href="${wikipediaUrl(v.title)}" target="_blank" rel="noopener noreferrer">Read “${esc(v.title)}” on Wikipedia</a></p>`
                : ""
            }</div>`
          : ""
      }
      <p class="src">Measurements: <a href="${wikidataUrl(f.qid)}" target="_blank" rel="noopener noreferrer">Wikidata</a>, community-edited. Text: Wikipedia (CC BY-SA).</p>`;
  }

  /** The measurements, description and article introduction for one Wikidata item. */
  async function fetchWiki(qid) {
    const entity = await fetchEntity(qid, "claims|sitelinks|descriptions");
    const claims = entity.claims ?? {};
    const rows = [];
    for (const [pid, label, unit] of WIKIDATA_PROPS) {
      // The first claim that is not deprecated, if it is usable.
      const claim = (Array.isArray(claims[pid]) ? claims[pid] : []).find(
        (c) => c?.rank !== "deprecated",
      );
      const dv = claim?.mainsnak?.datavalue;
      if (dv?.type === "quantity") {
        const n = Number(dv.value?.amount);
        if (Number.isFinite(n)) {
          rows.push({ label, text: fmtNum(Math.round(n * 100) / 100) + (unit ? ` ${unit}` : "") });
        }
      } else if (dv?.type === "wikibase-entityid" && QID.test(dv.value?.id ?? "")) {
        rows.push({ label, qid: dv.value.id, text: "" });
      }
    }
    // Items such as a river's mouth are ids; one more request turns them into names.
    const ids = rows.filter((r) => r.qid).map((r) => r.qid);
    if (ids.length) {
      try {
        const labels = await fetchLabels(ids);
        for (const r of rows) if (r.qid) r.text = labels.get(r.qid) ?? "";
      } catch {
        // Without names those rows are left out.
      }
    }
    const title = str(entity.sitelinks?.enwiki?.title, 200);
    let extract = "";
    if (title) {
      try {
        extract = (await fetchIntro(title))?.extract ?? "";
      } catch {
        // The measurements are still worth showing.
      }
    }
    return {
      rows: rows.filter((r) => r.text),
      desc: str(entity.descriptions?.en?.value, 240),
      title,
      extract,
    };
  }

  /* ============================================================ drill */

  const store = new ProgressStore({ storageKey: "terrainatlas.progress.v1", app: "terrainatlas" });
  const setupEl = $("#setup");

  const savedKinds = (storage.get(SETTINGS.kinds) ?? DEFAULT_KINDS.join(","))
    .split(",")
    .filter((k) => KINDS[k]);
  const savedScope = storage.get(SETTINGS.scope);
  /** The learner's drill settings, as saved. */
  const ds = {
    level: LEVELS[storage.get(SETTINGS.level)] ? storage.get(SETTINGS.level) : "4",
    type: DRILLS[storage.get(SETTINGS.type)] ? storage.get(SETTINGS.type) : "locate",
    kinds: new Set(savedKinds.length ? savedKinds : DEFAULT_KINDS),
    scope: SCOPES[savedScope] ? savedScope : "W",
    hard: storage.get(SETTINGS.hard) === "1",
    len: cleanLength(storage.get(SETTINGS.len)),
  };
  /** Distance in km that counts as a hit in "Locate", set per session from the pool's size. */
  let tolerance = 300;
  let current = null;

  const pool = () => poolFor(features, ds);
  const save = (name, value) => storage.set(SETTINGS[name], String(value));

  function renderSetup() {
    session.stop();
    const items = pool();
    const due = items.filter((f) => store.isDueReview(keyOf(ds.type, f))).length;
    const fresh = items.filter((f) => store.isNew(keyOf(ds.type, f))).length;
    const counts = new Map();
    for (const f of features) {
      if (inScope(f, ds.scope) && f.rank <= Number(ds.level)) {
        counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
      }
    }
    setupEl.dataset.view = "setup";
    setupEl.innerHTML = `<h2>Drill</h2>
      <p class="lead">Physical geography: what is where, and what it is called. Wrong answers come back sooner.</p>
      <div class="fieldrow"><span class="flab">What to practise</span>${typeButtons(DRILLS, ds.type)}</div>
      <div class="fieldrow"><span class="flab">Which kinds of feature</span>
        <div class="kinds" role="group" aria-label="Feature kinds">${KIND_ORDER.map(
          (k) =>
            `<button data-kind="${k}" aria-pressed="${ds.kinds.has(k)}"><span class="sw k-${k}"></span>${esc(KINDS[k].label)} <span class="count">${counts.get(k) ?? 0}</span></button>`,
        ).join("")}</div>
      </div>
      <div class="fieldrow"><span class="flab">Where and how</span>
        <div class="selects">
          <select id="dScope" aria-label="Region">
            ${Object.entries(SCOPES)
              .map(
                ([k, v]) =>
                  `<option value="${k}"${k === ds.scope ? " selected" : ""}>${esc(v)}</option>`,
              )
              .join("")}
          </select>
          ${ds.type === "locate" ? "" : difficultySwitch(ds.hard, "Easy: four choices", "Hard: type it")}
          <select id="dLevel" aria-label="How well known">${Object.entries(LEVELS)
            .map(
              ([k, v]) =>
                `<option value="${k}"${k === ds.level ? " selected" : ""}>${esc(v.label)}</option>`,
            )
            .join("")}</select>
          ${lengthSelect(ds.len)}
        </div>
        ${ds.type === "locate" ? `<p class="lead below">Click where you think it is. You are told how far off you were.</p>` : ""}
      </div>
      ${startSection({
        size: items.length,
        due,
        fresh,
        empty: "Not enough features match. Pick more kinds, or a wider region.",
      })}`;
    setupEl.hidden = false;
    resetMap();
  }

  /** The map as the setup and the end of a session leave it. */
  function resetMap() {
    if (current) mark(current.item.i, false);
    current = null;
    markers.clear();
    peakFilter = null;
    svg.classList.remove("aim");
    restoreLayers();
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
    const kind = t.closest("[data-kind]")?.dataset.kind;
    if (kind && KINDS[kind]) {
      if (ds.kinds.has(kind)) ds.kinds.delete(kind);
      else ds.kinds.add(kind);
      if (!ds.kinds.size) ds.kinds.add(kind); // never none
      save("kinds", [...ds.kinds].join(","));
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
    const { id, value } = e.target;
    if (id === "dScope") {
      ds.scope = SCOPES[value] ? value : "W";
      save("scope", ds.scope);
    } else if (id === "dLen") {
      ds.len = cleanLength(value);
      save("len", ds.len);
    } else if (id === "dLevel") {
      ds.level = LEVELS[value] ? value : "4";
      save("level", ds.level);
    } else return;
    renderSetup();
  });

  const session = new DrillSession({
    bar: drillBar,
    card: setupEl,
    store,
    isActive: () => mode === "drill",
    onLook: (look) => showDetails(look),
    onSetup: () => renderSetup(),
    onEnd: () => resetMap(),
  });

  function startDrill(dueOnly) {
    const items = pool();
    if (items.length < 2) return;
    const type = ds.type;
    const queue = planSession(items, (f) => keyOf(type, f), store, { length: ds.len, dueOnly });
    const [bx, by, bw, bh] = poolBox(items);
    tolerance = Math.max(60, Math.min(700, distKm(bx, by, bx + bw, by + bh) * 0.05));

    session.start(queue, ds.len, {
      label: DRILLS[type].label,
      keyOf: (f) => keyOf(type, f),
      ask: (f) => ask(type, f, items),
      reveal: (f) => reveal(f),
      judge: (text) => current.judge(text),
      rightNote: () => current.rightNote(),
      describe: (f) => ({ label: f.name, look: String(f.i) }),
      more: () => shuffle(items.slice()).slice(0, 20),
    });
  }

  /** Set the map up for a question and describe it to the drill bar. */
  function ask(type, f, items) {
    if (current) mark(current.item.i, false);
    current = new TerrainQuestion(type, f, items);
    markers.clear();
    if (type === "name") {
      showOnly([f.kind]);
      peakFilter = f.kind === "pea" ? new Set([f.i]) : null;
      mark(f.i, true);
      if (f.kind === "pea") {
        markers.set([{ kind: "ring", lon: f.parts[0][0], lat: f.parts[0][1], size: 15 }]);
      }
      view.frameLonLat(f.box, f.geom === "x" ? 1 : 3.0, f.geom === "x" ? 1500 : 420);
    } else {
      showOnly([]);
      peakFilter = null;
      // Both start from the same neutral view, so the last answer's position is no clue.
      view.frameLonLat(poolBox(items), 1.06, 700);
    }
    svg.classList.toggle("aim", type === "locate");
    onViewChange();

    const answer = type === "locate" ? "click" : ds.hard ? "type" : "choose";
    return {
      ...current.prompt(),
      answer,
      options: answer === "choose" ? current.options() : undefined,
      answerText: esc(f.name),
    };
  }

  /** Show the answer on the map: its kind alone, with it highlighted. */
  function reveal(f) {
    showOnly([f.kind]);
    peakFilter = f.kind === "pea" ? new Set([f.i]) : null;
    mark(f.i, true);
    if (f.geom === "x") {
      markers.set([
        ...markers.items.filter((m) => m.kind !== "ring"),
        { kind: "ring", lon: f.parts[0][0], lat: f.parts[0][1], size: 15 },
      ]);
    }
    svg.classList.remove("aim");
    onViewChange();
  }

  function drillClick(x, y) {
    if (!session.awaitingClick) return;
    const [lon, lat] = view.toLonLat(x, y);
    const f = session.item;
    const d = featureDistance(f, lon, lat);
    const ok = d <= tolerance;
    // The line goes to the nearest point of the feature, not to its middle.
    const [tx, ty] = nearestVertex(f, lon, lat);
    markers.set([
      { kind: "line", lon, lat, lon2: tx, lat2: ty },
      { kind: "guess", lon, lat, size: 7 },
    ]);
    reveal(f);
    // One bearing, always read the same way: where the feature lies as seen from the click.
    const away = `${formatKm(d)} km ${bearing(lon, lat, tx, ty)} of your click`;
    session.finish(
      ok,
      ok
        ? d < 1
          ? "Correct — spot on."
          : `Correct — ${formatKm(d)} km out.`
        : `Not quite. ${esc(f.name)} is ${esc(away)}.`,
      ok ? "ok" : d <= tolerance * 2.5 ? "near" : "bad",
    );
  }

  /* ========================================================= progress */

  const progressEl = $("#progress");
  const progress = new ProgressView(progressEl, {
    store,
    appName: "Terrain Atlas",
    drills: () =>
      Object.entries(DRILLS).map(([type, d]) => ({
        label: d.label,
        keys: features.map((f) => keyOf(type, f)),
      })),
    describe: (key) => {
      const f = featureByKey().get(key);
      return f ? { label: f.name, look: String(f.i) } : null;
    },
    onLook: (look) => showDetails(look),
    footer: `<button class="btn quiet" data-mode="drill">Back to the drill</button>`,
  });

  let keyIndex = null;
  function featureByKey() {
    if (!keyIndex) {
      keyIndex = new Map();
      for (const type of Object.keys(DRILLS)) {
        for (const f of features) keyIndex.set(keyOf(type, f), f);
      }
    }
    return keyIndex;
  }

  /* ============================================================ modes */

  let mode = "explore";

  function setMode(m) {
    if (!["explore", "drill", "prog"].includes(m)) return;
    mode = m;
    document.body.className = m;
    for (const b of $$("header [data-mode]")) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    }
    $("#searchWrap").hidden = m !== "explore";
    progressEl.hidden = m !== "prog";
    hideTip();
    if (m !== "explore") panel.close();
    if (m === "drill") {
      renderSetup();
    } else {
      setupEl.hidden = true;
      session.stop();
      resetMap();
    }
    if (m === "prog") progress.render();
  }

  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-mode]")?.dataset.mode;
    if (m) setMode(m);
  });

  /* ============================================================ start */

  drawLand(gWorld, land.shapes, proj());
  drawFeatures();
  applyLayers();
  projSwitch.sync();
  view.home();
}
