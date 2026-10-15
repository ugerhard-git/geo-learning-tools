/**
 * City Atlas: 2,738 cities and 4,596 regions on a zoomable world map, with
 * five drills and spaced repetition.
 *
 * - Explore: search, hover and click cities; open a region from a city.
 * - Drill: locate a city or region on the map, name a marked city or a
 *   highlighted region, or match capitals with their countries and regions.
 * - Progress: what is known, what is due, what keeps going wrong.
 *
 * The data model lives in data.js, the rules of each drill in drills.js;
 * this module puts them on the page.
 *
 * @module city-atlas/app
 */
import { $, $$, esc, fmtNum } from "../shared/dom.js";
import { storage } from "../shared/storage.js";
import { norm } from "../shared/text.js";
import { randomInt, shuffle } from "../shared/random.js";
import { PROJECTIONS, projectBox, savedProjection } from "../shared/projection.js";
import { ringsToPath } from "../shared/codec.js";
import { bearing, distKm, formatKm, nearestOnRings, ringsContain } from "../shared/geo.js";
import { MapView } from "../shared/mapview.js";
import { MarkerLayer } from "../shared/overlay.js";
import { Tooltip, drawLand, projectionSwitch } from "../shared/map-ui.js";
import { DetailPanel } from "../shared/panel.js";
import { flagMini, hideFailedFlags } from "../shared/flags.js";
import { REGIONS, STATUS } from "../shared/countries.js";
import { loadLand } from "../shared/land.js";
import { RestCountries, createSettingsDialog, factsList } from "../shared/restcountries.js";
import { ProgressStore, planSession } from "../shared/leitner.js";
import { ProgressView } from "../shared/progress-ui.js";
import { wikipediaSearchUrl } from "../shared/wikidata.js";
import {
  DrillSession,
  cleanLength,
  difficultySwitch,
  lengthSelect,
  startSection,
  typeButtons,
} from "../shared/drill.js";
import { CITY_TYPE, RegionShapes, loadCityData } from "./data.js";
import {
  CityQuestion,
  DRILLS,
  categories,
  keyOf,
  poolBox,
  poolFor,
  scopeOptions,
} from "./drills.js";

/** Saved drill settings, one key each. Kept as they were in the single-file app. */
const SETTINGS = {
  type: "cityatlas.type",
  cat: "cityatlas.cat",
  scope: "cityatlas.scope",
  hard: "cityatlas.hard",
  hint: "cityatlas.hint",
  len: "cityatlas.len",
};

const CITY_TYPE_LABEL = { 2: "National capital", 1: "Regional capital", 0: "Major city" };

const pageStatus = $("#pageStatus");
try {
  await main();
  pageStatus.remove();
} catch (e) {
  pageStatus.textContent = "The map data could not be loaded. Check your connection and reload.";
  throw e;
}

async function main() {
  const [data, land] = await Promise.all([loadCityData(), loadLand()]);
  const shapes = new RegionShapes(data.packedShapes, data.regionScale);
  const CATEGORIES = categories(data);
  hideFailedFlags();

  /* ================================================================ map */

  const svg = $("#map");
  const gWorld = $("#world");
  const gRegions = $("#regions");
  const gCities = $("#cities");
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
    onTap: (target, x, y) => pick(target, x, y),
    onHover: (e) => hover(e),
    onGestureStart: () => hideTip(),
  });
  view.bindZoomButtons($('[data-zoom="in"]'), $('[data-zoom="out"]'), $('[data-zoom="home"]'));

  /** country code → its outlines on the map */
  let countryPaths = new Map();
  /** region code → its outline */
  const regionPaths = new Map();
  /** city index → its dot */
  let cityDots = [];
  let regionsDrawn = false;

  function drawCountries() {
    countryPaths = drawLand(gWorld, land.shapes, proj());
  }

  function drawCities() {
    const p = proj();
    gCities.innerHTML = data.cities
      .map((c) => {
        const [x, y] = p.fwd(c.lon, c.lat);
        const cls = c.t === CITY_TYPE.national ? ' class="cap"' : "";
        return `<circle data-c="${c.i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0"${cls}/>`;
      })
      .join("");
    cityDots = $$("circle", gCities);
  }

  /** Region borders are many and seldom needed, so they are drawn on first use. */
  function drawRegions() {
    const p = proj();
    gRegions.innerHTML = data.regions
      .map((r) => `<path data-r="${esc(r.code)}" d="${ringsToPath(shapes.ringsOf(r.code), p)}"/>`)
      .join("");
    regionPaths.clear();
    for (const path of $$("path[data-r]", gRegions)) regionPaths.set(path.dataset.r, path);
    regionsDrawn = true;
  }

  const needRegions = () => regionsDrawn || drawRegions();

  function showRegionBorders(on) {
    if (on) needRegions();
    gRegions.classList.toggle("on", on);
    $("#regBtn").setAttribute("aria-pressed", String(on));
  }

  $("#regBtn").addEventListener("click", (e) => {
    showRegionBorders(e.currentTarget.getAttribute("aria-pressed") !== "true");
  });

  /* -------------------------------------------------- dots and markers */

  /** When set, only these cities are shown, e.g. the answer after a question. */
  let cityFilter = null;

  /* An SVG group has no `hidden` property, so visibility goes through a class. */
  const showCities = (on) => gCities.classList.toggle("off", !on);

  /** After every move: keep markers and dots a constant size, show more cities closer in. */
  function onViewChange() {
    const k = view.unitsPerPixel();
    markers.fit(k);
    if (!cityDots.length || gCities.classList.contains("off")) return;
    const span = (view.w / 20000) * 360; // degrees of longitude across the screen
    const minPop = span > 200 ? 4e6 : span > 90 ? 15e5 : span > 40 ? 5e5 : span > 12 ? 1e5 : 0;
    const r = Math.min(4.2, Math.max(2.2, 2.2 + ((200 - Math.min(200, span)) / 200) * 2)) * k;
    for (const c of data.cities) {
      const on = cityFilter
        ? cityFilter.has(c.i)
        : c.t === CITY_TYPE.national ||
          c.pop >= minPop ||
          (c.t === CITY_TYPE.regional && span < 60);
      const size = on ? (c.t === CITY_TYPE.national ? r * 1.25 : r) : 0;
      cityDots[c.i].setAttribute("r", size.toFixed(2));
    }
  }

  /* ------------------------------------------------- what is selected */

  let selCity = null;
  let selCountry = null;
  let hiRegion = null;

  const markCity = (i, on) => cityDots[i]?.classList.toggle("hov", on);
  const markCountry = (code, on) => {
    for (const p of countryPaths.get(code) ?? []) p.classList.toggle("sel", on);
  };
  function markRegion(code, on) {
    if (on) needRegions();
    if (hiRegion && hiRegion !== code) regionPaths.get(hiRegion)?.classList.remove("hi");
    regionPaths.get(code)?.classList.toggle("hi", on);
    hiRegion = on ? code : null;
  }

  function clearSelection() {
    if (selCity != null) markCity(selCity, false);
    if (selCountry) markCountry(selCountry, false);
    if (hiRegion) markRegion(hiRegion, false);
    selCity = null;
    selCountry = null;
  }

  /* --------------------------------------------------------- projection */

  const projSwitch = projectionSwitch($(".projsw"), {
    current: () => projKey,
    onSwitch(key) {
      const [lon, lat] = view.centreLonLat();
      projKey = key;
      hideTip();
      drawCountries();
      drawCities();
      if (regionsDrawn) drawRegions();
      // Put back whatever was marked before the redraw.
      if (selCity != null) markCity(selCity, true);
      if (selCountry) markCountry(selCountry, true);
      if (hiRegion) markRegion(hiRegion, true);
      markers.draw();
      view.centreAt(lon, lat);
    },
  });

  /* ================================================== search and hover */

  const search = new Map();
  for (const c of data.cities) {
    for (const n of [c.name, ...c.alts]) {
      if (!search.has(norm(n))) search.set(norm(n), { city: c.i });
    }
  }
  for (const r of data.regions) {
    for (const n of [r.name, r.alt].filter(Boolean)) {
      if (!search.has(norm(n))) search.set(norm(n), { region: r.code });
    }
  }
  const byPop = (a, b) => b.pop - a.pop;
  $("#names").innerHTML = data.cities
    .slice()
    .sort(byPop)
    .slice(0, 900)
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((c) => `<option value="${esc(c.name)}">`)
    .join("");

  /** The place a search means: an exact name, else a city or region starting with it. */
  function findPlace(query) {
    const k = norm(String(query).trim());
    if (!k) return null;
    if (search.has(k)) return search.get(k);
    const city = data.cities.filter((c) => norm(c.name).startsWith(k)).sort(byPop)[0];
    if (city) return { city: city.i };
    const region = data.regions.find((r) => norm(r.name).startsWith(k));
    if (region) return { region: region.code };
    const inside = data.cities.filter((c) => norm(c.name).includes(k)).sort(byPop)[0];
    return inside ? { city: inside.i } : null;
  }

  function goSearch(input) {
    const place = findPlace(input.value.slice(0, 60));
    if (place?.city != null) selectCity(place.city, true);
    else if (place?.region) selectRegion(place.region, true);
    input.blur();
  }
  $("#q").addEventListener("change", (e) => goSearch(e.target));
  $("#q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") goSearch(e.target);
  });

  let hovCity = null;
  function hover(e) {
    if (mode !== "explore" || view.isGesturing() || e.pointerType === "touch") return;
    const dot = e.target.closest?.("#cities circle");
    const i = dot ? Number(dot.dataset.c) : null;
    if (i !== hovCity) {
      if (hovCity != null && hovCity !== selCity) markCity(hovCity, false);
      hovCity = i;
      if (i != null) markCity(i, true);
    }
    if (i == null) return hideTip();
    tip.show(data.cities[i].name, e.clientX, e.clientY);
  }
  function hideTip() {
    tip.hide();
    if (hovCity != null && hovCity !== selCity) markCity(hovCity, false);
    hovCity = null;
  }
  svg.addEventListener("pointerleave", hideTip);

  function pick(target, x, y) {
    if (mode === "drill") return drillClick(x, y);
    if (mode !== "explore") return;
    const dot = target.closest?.("#cities circle");
    if (dot) selectCity(Number(dot.dataset.c), false);
    else panel.close();
  }

  /* ====================================================== detail panel */

  const rc = new RestCountries();
  let factsFor = null;

  const panel = new DetailPanel(panelEl, {
    onHide() {
      rc.cancel();
      factsFor = null;
    },
    onDismiss() {
      clearSelection();
      markers.clear();
    },
  });

  /** The map as it stands, to put back when details opened over a drill close. */
  function snapshot() {
    const s = {
      markers: markers.items.slice(),
      region: hiRegion,
      filter: cityFilter,
      shown: !gCities.classList.contains("off"),
      view: view.snapshot(),
      city: selCity,
      country: selCountry,
    };
    return () => {
      clearSelection();
      if (s.region) markRegion(s.region, true);
      if (s.city != null) markCity((selCity = s.city), true);
      if (s.country) markCountry((selCountry = s.country), true);
      cityFilter = s.filter;
      showCities(s.shown);
      markers.set(s.markers);
      view.restore(s.view);
    };
  }

  /**
   * Open details over a drill or the progress screen.
   * @param {string} look "c<index>" for a city, "r<code>" for a region
   */
  function showDetails(look) {
    const back = snapshot();
    if (look.startsWith("c")) selectCity(Number(look.slice(1)), true);
    else selectRegion(look.slice(1), true);
    panel.showOver(back);
  }

  function selectCity(i, fly) {
    const c = data.cities[i];
    if (!c) return;
    clearSelection();
    selCity = i;
    selCountry = c.iso;
    markCity(i, true);
    markCountry(c.iso, true);
    if (c.reg) markRegion(c.reg, true);
    markers.set([{ kind: "ring", lon: c.lon, lat: c.lat, size: 14 }]);
    openCityPanel(c);
    if (fly) view.centreOn(c.lon, c.lat, Math.max(view.w > 20000 / 6 ? 900 : view.w, 300));
  }

  function selectRegion(code, fly) {
    const r = data.regionBy.get(code);
    if (!r) return;
    clearSelection();
    markRegion(code, true);
    showRegionBorders(true);
    markers.clear();
    openRegionPanel(r);
    if (fly) view.frameLonLat(shapes.extent(code).box, 1.6, 240);
  }

  const countryLine = (iso, name, extra = "") =>
    `<span class="ctry">${flagMini(iso, name)}<span>${esc(name)}${extra}</span></span>`;

  function openCityPanel(c) {
    const region = data.regionBy.get(c.reg);
    const country = data.countryBy[c.iso];
    const countryName = country?.name ?? c.iso;
    const capitals = (data.nationalCapitals.get(c.iso) ?? []).map((x) => x.name).join(", ");
    const status =
      country && country.status !== "u"
        ? ` <span class="muted">(${esc(STATUS[country.status])})</span>`
        : "";
    const lat = `${Math.abs(c.lat).toFixed(2)}° ${c.lat >= 0 ? "N" : "S"}`;
    const lon = `${Math.abs(c.lon).toFixed(2)}° ${c.lon >= 0 ? "E" : "W"}`;
    panel.show(`
      <h2>${esc(c.name)}</h2>
      <div class="meta"><span class="tag code">${esc(CITY_TYPE_LABEL[c.t])}</span>${
        country ? `<span class="tag">${esc(REGIONS[country.region] ?? "")}</span>` : ""
      }</div>
      <dl class="facts">
        <dt>Country</dt><dd>${countryLine(c.iso, countryName, status)}</dd>
        ${
          region
            ? `<dt>Region</dt><dd>${esc(region.name)}${region.alt ? ` · ${esc(region.alt)}` : ""}${
                c.t === CITY_TYPE.regional ? " — capital" : ""
              }</dd>`
            : ""
        }
        <dt>Population</dt><dd>${fmtNum(c.pop)}</dd>
        ${c.alts.length ? `<dt>Also known as</dt><dd>${esc(c.alts.join(", "))}</dd>` : ""}
        <dt>Coordinates</dt><dd>${lat}, ${lon}</dd>
        ${
          capitals && c.t !== CITY_TYPE.national
            ? `<dt>Country capital</dt><dd>${esc(capitals)}</dd>`
            : ""
        }
      </dl>
      <div class="prow">
        <button class="btn" data-zoom-city>Zoom to ${esc(c.name)}</button>
        ${region ? `<button class="btn" data-region="${esc(c.reg)}">Show ${esc(region.name)}</button>` : ""}
      </div>
      <div data-facts></div>
      <p class="src">Cities and outlines: Natural Earth (public domain). Flag: flagcdn.com. Population figures are Natural Earth's and are a few years old.
        <a href="${wikipediaSearchUrl(c.name)}" target="_blank" rel="noopener noreferrer">Read about ${esc(c.name)} on Wikipedia</a>.</p>`);
    loadFacts(c.iso);
  }

  function openRegionPanel(r) {
    const capital = data.capitalOfRegion.get(r.code);
    const country = data.countryBy[r.iso];
    const inRegion = data.cities
      .filter((c) => c.reg === r.code)
      .sort(byPop)
      .slice(0, 8);
    panel.show(`
      <h2>${esc(r.name)}</h2>
      <div class="meta"><span class="tag code">${esc(r.code)}</span><span class="tag">Region</span></div>
      <dl class="facts">
        <dt>Country</dt><dd>${countryLine(r.iso, country?.name ?? r.iso)}</dd>
        ${r.alt ? `<dt>Also called</dt><dd>${esc(r.alt)}</dd>` : ""}
        ${capital ? `<dt>Capital</dt><dd>${esc(capital.name)}</dd>` : ""}
      </dl>
      ${
        inRegion.length
          ? `<h3>Cities here</h3><dl class="facts">${inRegion
              .map((c) => `<dt>${esc(c.name)}</dt><dd>${fmtNum(c.pop)}</dd>`)
              .join("")}</dl>`
          : ""
      }
      <div class="prow"><button class="btn" data-zoom-region="${esc(r.code)}">Zoom to ${esc(r.name)}</button>${
        capital
          ? `<button class="btn" data-city="${capital.i}">Open ${esc(capital.name)}</button>`
          : ""
      }</div>
      <p class="src">Region outlines: Natural Earth (public domain).</p>`);
  }

  panelEl.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-zoom-city]") && selCity != null) {
      const c = data.cities[selCity];
      return view.centreOn(c.lon, c.lat, 400);
    }
    const zr = t.closest("[data-zoom-region]")?.dataset.zoomRegion;
    if (zr && data.regionBy.has(zr)) return view.frameLonLat(shapes.extent(zr).box, 1.6, 240);
    const region = t.closest("[data-region]")?.dataset.region;
    if (region) return selectRegion(region, true);
    const city = t.closest("[data-city]")?.dataset.city;
    if (city != null) return selectCity(Number(city), true);
    if (t.closest("[data-settings]")) settings.open();
  });

  /* ------------------------------------------ country facts (optional) */

  function loadFacts(iso, now = false) {
    factsFor = iso;
    rc.load(iso, (state) => renderFacts(iso, state), { now });
  }

  function renderFacts(iso, state) {
    const el = panel.part("[data-facts]");
    if (!el || factsFor !== iso) return;
    const name = data.countryBy[iso]?.name ?? iso;
    el.innerHTML =
      state.state === "ok"
        ? `<h3>${esc(name)}</h3>${factsList(state.facts)}`
        : state.state === "nokey"
          ? `<p class="err spaced">Country facts are available with a REST Countries key. <button class="linkbtn" data-settings>Add a key</button></p>`
          : state.state === "loading"
            ? `<p class="loading spaced">Loading country facts…</p>`
            : `<p class="err spaced">${esc(state.message)}</p>`;
  }

  const settings = createSettingsDialog(rc, {
    intro:
      "Optional. With a key, a city's panel also shows its country's capital, population, languages and currency.",
    onChange: () => factsFor && loadFacts(factsFor, true),
  });
  $("#setBtn").addEventListener("click", () => settings.open());

  /* ============================================================ drill */

  const store = new ProgressStore({ storageKey: "cityatlas.progress.v1", app: "cityatlas" });
  const setupEl = $("#setup");

  /** The learner's drill settings, as saved. */
  const ds = {
    type: DRILLS[storage.get(SETTINGS.type)] ? storage.get(SETTINGS.type) : "locate",
    cat: CATEGORIES[storage.get(SETTINGS.cat)] ? storage.get(SETTINGS.cat) : "cap",
    scope: storage.get(SETTINGS.scope) || "W",
    hard: storage.get(SETTINGS.hard) === "1",
    // The country a question sits in is a give-away, so it is held back unless asked for.
    hint: storage.get(SETTINGS.hint) === "1",
    len: cleanLength(storage.get(SETTINGS.len)),
  };
  /** Distance in km that counts as a hit in "Locate", set per session from the pool's size. */
  let tolerance = 200;
  /** The question on screen. */
  let current = null;

  const pool = () => poolFor(data, ds);
  const save = (name, value) => storage.set(SETTINGS[name], String(value));

  function renderSetup() {
    session.stop();
    const kind = DRILLS[ds.type].kind;
    const scopes = scopeOptions(data, kind);
    if (!scopes.some(([k]) => k === ds.scope)) ds.scope = "W";
    const items = pool();
    const due = items.filter((it) => store.isDueReview(keyOf(ds.type, it))).length;
    const fresh = items.filter((it) => store.isNew(keyOf(ds.type, it))).length;
    setupEl.dataset.view = "setup";
    setupEl.innerHTML = `<h2>Drill</h2>
      <p class="lead">Questions you get wrong come back sooner. Everything is stored in this browser only.</p>
      <div class="fieldrow"><span class="flab">What to practise</span>${typeButtons(DRILLS, ds.type)}</div>
      <div class="fieldrow"><span class="flab">Which places</span>
        <div class="selects">
          ${
            kind === "city"
              ? `<select id="dCat" aria-label="Category">${Object.entries(CATEGORIES)
                  .map(
                    ([k, v]) =>
                      `<option value="${k}"${k === ds.cat ? " selected" : ""}>${esc(v.label)}</option>`,
                  )
                  .join("")}</select>`
              : ""
          }
          <select id="dScope" aria-label="Scope">${scopes
            .map(
              ([k, v]) =>
                `<option value="${esc(k)}"${k === ds.scope ? " selected" : ""}>${esc(v)}</option>`,
            )
            .join("")}</select>
        </div>
      </div>
      <div class="fieldrow"><span class="flab">How to answer</span>
        <div class="selects">
          ${
            DRILLS[ds.type].click
              ? `<p class="lead flush">Click the spot on the map. You are told how far off you were.</p>`
              : difficultySwitch(ds.hard, "Easy: pick from four", "Hard: type the name")
          }
          ${lengthSelect(ds.len)}
        </div>
      </div>
      <div class="fieldrow"><span class="flab">Country hint</span>
        <div class="selects">
          <div class="seg" role="group" aria-label="Country hint"><button data-hintset="0" aria-pressed="${!ds.hint}">Ask for it</button><button data-hintset="1" aria-pressed="${ds.hint}">Always show it</button></div>
        </div>
        <p class="lead note">The country a place sits in is not shown with the question. Leave this on <b>Ask for it</b> and a <b>Hint</b> button offers it when you want it; it is revealed once you answer either way.</p>
      </div>
      ${startSection({
        size: items.length,
        due,
        fresh,
        empty: "No places match this combination. Pick a wider scope.",
      })}`;
    setupEl.hidden = false;
    resetMap();
  }

  /** The map as the drill setup and the end of a session leave it. */
  function resetMap() {
    current = null;
    showCities(true);
    cityFilter = null;
    markers.clear();
    if (hiRegion) markRegion(hiRegion, false);
    svg.classList.remove("aim");
    onViewChange();
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
    const hint = t.closest("[data-hintset]")?.dataset.hintset;
    if (hint) {
      ds.hint = hint === "1";
      save("hint", hint);
      return renderSetup();
    }
    if (t.closest("[data-start]")) return startDrill(false);
    if (t.closest("[data-start-due]")) return startDrill(true);
  });

  setupEl.addEventListener("change", (e) => {
    const { id, value } = e.target;
    if (id === "dCat" && CATEGORIES[value]) {
      ds.cat = value;
      save("cat", value);
    } else if (id === "dScope") {
      ds.scope = value;
      save("scope", value);
    } else if (id === "dLen") {
      ds.len = cleanLength(value);
      save("len", ds.len);
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
    const queue = planSession(items, (it) => keyOf(type, it), store, {
      length: ds.len,
      dueOnly,
    });
    const [bx, by, bw, bh] = poolBox(items, shapes);
    tolerance = Math.max(25, Math.min(400, distKm(bx, by, bx + bw, by + bh) * 0.04));
    const kindOf = DRILLS[type].kind;

    session.start(
      queue,
      ds.len,
      {
        label: DRILLS[type].label,
        keyOf: (it) => keyOf(type, it),
        ask: (it) => ask(type, it, items),
        reveal: (it) => reveal(it),
        judge: (text) => current.judge(text, items),
        describe: (it) =>
          kindOf === "city"
            ? { label: it.name, look: `c${it.i}` }
            : { label: it.name, look: `r${it.code}` },
        more: () => shuffle(items.slice()).slice(0, 20),
      },
      { alwaysHint: ds.hint },
    );
  }

  /** Set the map up for a question and describe it to the drill bar. */
  function ask(type, item, items) {
    current = new CityQuestion(data, shapes, type, item, randomInt(2));
    const click = Boolean(DRILLS[type].click);
    const answer = click ? "click" : ds.hard ? "type" : "choose";

    cityFilter = null;
    showCities(false);
    if (hiRegion) markRegion(hiRegion, false);
    markers.clear();
    svg.classList.toggle("aim", click);
    const pin = (it) => [
      { kind: "ring", lon: it.lon, lat: it.lat, size: 15 },
      { kind: "pin", lon: it.lon, lat: it.lat, size: 4 },
    ];

    if (type === "locate") {
      view.frameLonLat(poolBox(items, shapes), 1.06, 600);
    } else if (type === "name") {
      markers.set(pin(item));
      const [, , width] = projectBox(proj(), poolBox(items, shapes));
      view.centreOn(item.lon, item.lat, Math.max(900, width * 0.25));
    } else if (type === "rlocate") {
      showRegionBorders(true);
      view.frameLonLat(poolBox(items, shapes), 1.06, 600);
    } else if (type === "region") {
      showRegionBorders(true);
      markRegion(item.code, true);
      view.frameLonLat(shapes.extent(item.code).box, 3.2, 300);
    } else if (current.dir === 1) {
      markers.set(pin(item));
      view.centreOn(item.lon, item.lat, 1400);
    } else if (item.t === CITY_TYPE.national) {
      const box = land.boxes.get(item.iso)?.box;
      if (box) view.frameLonLat(box, 1.3, 400);
    } else if (data.regionBy.has(item.reg)) {
      needRegions();
      gRegions.classList.add("on");
      markRegion(item.reg, true);
      view.frameLonLat(shapes.extent(item.reg).box, 2.6, 300);
    }
    onViewChange();

    return {
      ...current.prompt(),
      answer,
      options: answer === "choose" ? current.options(items) : undefined,
      answerText: current.answerText(),
    };
  }

  /** Show the answer on the map. */
  function reveal(item) {
    const isCity = DRILLS[current.type].kind === "city";
    if (isCity && (current.type !== "capital" || current.dir === 0)) {
      markers.set([
        ...markers.items.filter((m) => m.kind !== "ring"),
        { kind: "ring", lon: item.lon, lat: item.lat, size: 15 },
        { kind: "pin", lon: item.lon, lat: item.lat, size: 4 },
      ]);
    }
    if (!isCity) markRegion(item.code, true);
    else if (current.type === "capital" && item.t === CITY_TYPE.regional)
      markRegion(item.reg, true);
    showCities(true);
    cityFilter = new Set(isCity ? [item.i] : []);
    svg.classList.remove("aim");
    onViewChange();
  }

  /** A click on the map while a "Locate" question waits for one. */
  function drillClick(x, y) {
    if (!session.awaitingClick) return;
    const [lon, lat] = view.toLonLat(x, y);
    const item = session.item;
    if (current.type === "rlocate") return regionClick(lon, lat, item);

    const d = distKm(lon, lat, item.lon, item.lat);
    const ok = d <= tolerance;
    markers.set([
      { kind: "line", lon, lat, lon2: item.lon, lat2: item.lat },
      { kind: "guess", lon, lat, size: 7 },
      { kind: "ring", lon: item.lon, lat: item.lat, size: 15 },
      { kind: "pin", lon: item.lon, lat: item.lat, size: 4 },
    ]);
    showCities(true);
    cityFilter = new Set([item.i]);
    svg.classList.remove("aim");
    onViewChange();
    // One bearing, always read the same way: where the city lies as seen from the click.
    const away = `${formatKm(d)} km ${bearing(lon, lat, item.lon, item.lat)} of your click`;
    session.finish(
      ok,
      ok
        ? d < 1
          ? "Correct — spot on."
          : `Correct — ${formatKm(d)} km out.`
        : `Not quite. ${esc(item.name)} is ${esc(away)}.`,
      ok ? "ok" : d <= tolerance * 2.5 ? "near" : "bad",
    );
  }

  /**
   * Landing anywhere inside the region counts. A miss is measured to the
   * nearest point of its edge, and never names the region that was clicked
   * instead: that would hand over a later question as much as this one.
   */
  function regionClick(lon, lat, item) {
    showRegionBorders(true);
    markRegion(item.code, true);
    showCities(true);
    cityFilter = new Set();
    svg.classList.remove("aim");
    const rings = shapes.ringsOf(item.code);
    const edge = nearestOnRings(rings, lon, lat) ?? [lon, lat];
    // Judged against the outline on screen: a few pixels of slack forgive a
    // fingertip landing on the line itself, without being generous about the ground.
    const p = proj();
    const [ax, ay] = p.fwd(lon, lat);
    const [bx, by] = p.fwd(edge[0], edge[1]);
    const px = Math.hypot(ax - bx, ay - by) / view.unitsPerPixel();
    if (ringsContain(rings, lon, lat) || px <= 8) {
      markers.set([{ kind: "guess", lon, lat, size: 7 }]);
      return session.finish(true, "Correct.", "ok");
    }
    const d = distKm(lon, lat, edge[0], edge[1]);
    markers.set([
      { kind: "line", lon, lat, lon2: edge[0], lat2: edge[1] },
      { kind: "guess", lon, lat, size: 7 },
    ]);
    // One bearing, always read the same way: where the region lies as seen from the click.
    const away = `${formatKm(d)} km ${bearing(lon, lat, edge[0], edge[1])} of your click`;
    session.finish(
      false,
      `Not quite. ${esc(item.name)} is ${esc(away)}.`,
      d <= 150 ? "near" : "bad",
    );
  }

  /* ========================================================= progress */

  const progressEl = $("#progress");
  const progress = new ProgressView(progressEl, {
    store,
    appName: "City Atlas",
    drills: () =>
      Object.entries(DRILLS).map(([type, d]) => ({
        label: d.label,
        keys: (d.kind === "region" ? data.regions : data.cities).map((it) => keyOf(type, it)),
      })),
    describe: (key) => describeKey(key),
    onLook: (look) => showDetails(look),
    footer: `<button class="btn quiet" data-mode="drill">Back to the drill</button>`,
  });

  /** Lookup from progress key to item, built when the progress screen first needs it. */
  let keyIndex = null;
  function describeKey(key) {
    if (!keyIndex) {
      keyIndex = new Map();
      for (const [type, d] of Object.entries(DRILLS)) {
        for (const it of d.kind === "region" ? data.regions : data.cities) {
          keyIndex.set(keyOf(type, it), it);
        }
      }
    }
    const it = keyIndex.get(key);
    if (!it) return null;
    return { label: it.name, look: "code" in it ? `r${it.code}` : `c${it.i}` };
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

  drawCountries();
  drawCities();
  projSwitch.sync();
  view.home();
}
