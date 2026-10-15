/**
 * Optional country facts from REST Countries (api.restcountries.com).
 *
 * The service needs a personal API key. The learner can paste one into the
 * settings dialog this module builds; without one the apps work as before
 * and the detail panels simply offer to add a key. The key and a three-day
 * cache of answers are shared by every app on the site, under storage keys
 * that predate the others (see the constants below).
 *
 * Security notes:
 * - The key goes only to api.restcountries.com, in an Authorization header,
 *   with no cookies or referrer (see shared/net.js).
 * - When the page is shown inside another site's frame the key is neither
 *   read nor offered for entry, so a framing page cannot trick someone into
 *   typing it there.
 * - Everything in the response, and everything read back from the cache, is
 *   reduced to a few short strings and numbers before it is shown.
 * - What this cannot protect against: on GitHub Pages every project site of
 *   one account shares the origin `<account>.github.io`. Any page published
 *   there can read a remembered key from localStorage, and can even capture
 *   a key held for one tab only, by opening an app in a window it controls.
 *   The settings dialog says so plainly. Only a domain of the site's own
 *   would close this (see SECURITY.md).
 *
 * @module shared/restcountries
 */
import { esc, fmtNum } from "./dom.js";
import { FRAMED, HttpError, getJSON, num, str } from "./net.js";
import { shortString, storage, ttlCache } from "./storage.js";

/* Storage keys. They are shared with the original Flag Atlas, whose names they keep. */
const KEY_STORE = "flagatlas.restcountries.key";
const CACHE_STORE = "flagatlas.restcountries.cache.v5";

/** The provider's terms allow caching answers for up to three days. */
const CACHE_DAYS = 3;
const CACHE_MAX = 300;

/** What an API key looks like: URL-safe characters, sensibly long. */
export const KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{8,256}$/;

/** Fields asked for. The flag description is used by the flag apps only, but always
    fetched, so a cached answer serves every app. */
const FIELDS = [
  "names.official",
  "capitals",
  "subregion",
  "population",
  "area.kilometers",
  "languages",
  "currencies",
  "flag.description",
].join(",");

/** Wait this long after a click before asking, so clicking quickly through countries
    does not use up the monthly quota. */
const DEBOUNCE_MS = 450;

/**
 * @typedef {object} CountryFacts
 * @property {string} official
 * @property {string} capital
 * @property {string} subregion
 * @property {number | null} population
 * @property {number | null} area square kilometres
 * @property {string} languages
 * @property {string} currency
 * @property {string} [flagDesc] missing from entries cached by older versions
 */

/**
 * Whether a cached value has the shape of {@link CountryFacts}. Anything on
 * the same origin can write to the cache, so this runs on every read.
 * @returns {boolean}
 */
export const isCountryFacts = (v) =>
  Boolean(v) &&
  typeof v === "object" &&
  ["official", "capital", "subregion", "languages", "currency"].every((k) =>
    shortString(v[k], 1000),
  ) &&
  ["population", "area"].every((k) => v[k] === null || Number.isFinite(v[k])) &&
  (v.flagDesc === undefined || shortString(v.flagDesc, 2000));

/** The English name of a value that may be a string or a small object of names. */
function nameOf(x) {
  if (typeof x === "string") return x;
  if (!x || typeof x !== "object") return "";
  for (const k of ["name", "english_name", "name_en", "english", "common"]) {
    if (typeof x[k] === "string") return x[k];
  }
  return x.names && typeof x.names === "object" ? nameOf(x.names) : "";
}

/** A list from a field that may be an array or an object keyed by code. */
function listOf(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).map(([code, x]) =>
    x && typeof x === "object" ? { code, ...x } : { code, name: x },
  );
}

/**
 * Reduce one country record from the API to {@link CountryFacts}.
 * @param {unknown} o
 * @returns {CountryFacts | null}
 */
export function summarise(o) {
  if (!o || typeof o !== "object") return null;
  const names = (list, max, count) =>
    listOf(list)
      .map((x) => str(nameOf(x), max))
      .filter(Boolean)
      .slice(0, count)
      .join(", ");
  const currency = listOf(o.currencies)
    .map((c) => {
      const name = str(nameOf(c), 80) || str(c.code, 10);
      const symbol = str(c.symbol, 8);
      return name ? name + (symbol ? ` (${symbol})` : "") : "";
    })
    .filter(Boolean)
    .slice(0, 5)
    .join(", ");
  return {
    official: str(o.names?.official, 200),
    capital: names(o.capitals, 80, 5),
    subregion: str(o.subregion, 80),
    population: num(o.population),
    area: num(o.area?.kilometers),
    languages: names(o.languages, 60, 12),
    currency,
    flagDesc: str(o.flag?.description, 1200),
  };
}

/**
 * The facts as label/value rows for a definition list, leaving out the
 * empty ones.
 * @param {CountryFacts} o
 * @returns {[string, string][]}
 */
export const factRows = (o) =>
  [
    ["Official name", o.official],
    ["Capital", o.capital],
    ["Subregion", o.subregion],
    ["Population", fmtNum(o.population)],
    ["Area", o.area != null ? `${fmtNum(Math.round(o.area))} km²` : ""],
    ["Languages", o.languages],
    ["Currency", o.currency],
  ].filter((row) => row[1]);

/** HTML for the facts as a definition list. */
export const factsList = (o) =>
  `<dl class="facts">${factRows(o)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
    .join("")}</dl>`;

/** What to tell the learner when a request failed. */
export function errorText(e) {
  if (e instanceof HttpError) {
    if (e.status === 401) {
      return "REST Countries rejected the key. Check it for typos, or create a new one.";
    }
    if (e.status === 403) {
      return "REST Countries refused the request. The monthly quota may be used up.";
    }
    if (e.status === 429) {
      return "Too many REST Countries requests in a short time. Wait ten seconds and try again.";
    }
    if (e.status === 404) return "REST Countries has no record for this place.";
    return `REST Countries answered with error ${e.status}. Try again later.`;
  }
  return `The browser blocked the REST Countries request. Add “${location.hostname}” to the key's allowed hostnames at restcountries.com.`;
}

/**
 * @typedef {{ state: "ok", facts: CountryFacts }
 *   | { state: "nokey" | "loading" }
 *   | { state: "err", message: string }} FactsState
 */

/**
 * The API key, the cache and the requests. One instance per page.
 */
export class RestCountries {
  constructor() {
    const saved = FRAMED ? null : storage.get(KEY_STORE);
    /** @type {string | null} */
    this.key = saved && KEY_PATTERN.test(saved) ? saved : null;
    this.cache = ttlCache(CACHE_STORE, CACHE_DAYS * 864e5, CACHE_MAX, isCountryFacts);
    this.timer = 0;
    /** Bumped on every load, so an answer to an older request is dropped. */
    this.generation = 0;
  }

  /** Whether the key is saved in this browser rather than held for this tab. */
  get remembered() {
    return Boolean(storage.get(KEY_STORE));
  }

  /**
   * Use a key, for this tab only or remembered in this browser.
   * @param {string} key already checked against {@link KEY_PATTERN}
   * @param {boolean} remember
   */
  setKey(key, remember) {
    this.key = key;
    this.remember(remember);
  }

  /** Save or forget the current key in this browser. */
  remember(on) {
    if (on && this.key) storage.set(KEY_STORE, this.key);
    else storage.remove(KEY_STORE);
  }

  /** Forget the key and every cached answer. */
  clear() {
    this.key = null;
    storage.remove(KEY_STORE);
    this.cache.clear();
  }

  /**
   * Ask the service about one country.
   * @param {string} code ISO 3166-1 alpha-2
   * @returns {Promise<CountryFacts | null>}
   */
  async request(code) {
    if (!this.key) throw new Error("No API key");
    const url = `https://api.restcountries.com/countries/v5/codes.alpha_2/${encodeURIComponent(code)}?response_fields=${FIELDS}`;
    const json = await getJSON(url, {
      headers: { Authorization: `Bearer ${this.key}` },
      cache: "no-store",
    });
    return summarise(json?.data?.objects?.[0]);
  }

  /**
   * Facts for one country, from the cache or the service, reported through
   * `onState` as they become known. A newer call cancels an older one.
   *
   * @param {string} code
   * @param {(state: FactsState) => void} onState
   * @param {{ now?: boolean }} [options] skip the short wait before asking
   */
  load(code, onState, { now = false } = {}) {
    this.cancel();
    const generation = this.generation;
    const report = (state) => {
      if (generation === this.generation) onState(state);
    };
    const hit = this.cache.get(code);
    if (hit) return report({ state: "ok", facts: hit });
    if (!this.key) return report({ state: "nokey" });
    report({ state: "loading" });
    this.timer = setTimeout(
      async () => {
        try {
          const facts = await this.request(code);
          if (!facts) {
            report({ state: "err", message: "REST Countries has no record for this place." });
            return;
          }
          this.cache.put(code, facts);
          report({ state: "ok", facts });
        } catch (e) {
          report({ state: "err", message: errorText(e) });
        }
      },
      now ? 0 : DEBOUNCE_MS,
    );
  }

  /** Drop any request still waiting, e.g. when the panel closes. */
  cancel() {
    clearTimeout(this.timer);
    this.generation++;
  }
}

/* ------------------------------------------------------------------------ */

/**
 * Build the settings dialog for the API key and add it to the page.
 *
 * @param {RestCountries} rc
 * @param {object} options
 * @param {string} options.intro what a key adds in this app (plain text)
 * @param {() => void} [options.onChange] after a key was saved and tested, or cleared
 * @returns {{ open(): void }}
 */
export function createSettingsDialog(rc, { intro, onChange = () => {} }) {
  const dlg = document.createElement("dialog");
  dlg.setAttribute("aria-labelledby", "settingsTitle");
  dlg.innerHTML = `<div class="dlg">
    <button class="close" aria-label="Close settings" data-close>×</button>
    <h2 id="settingsTitle">REST Countries key</h2>
    <p>${esc(intro)} The key is sent only to api.restcountries.com, never to any other service.</p>
    <label for="keyIn" class="field-label">API key</label>
    <div class="field">
      <input id="keyIn" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="256" placeholder="Paste your key">
      <button class="btn" data-show aria-pressed="false">Show</button>
    </div>
    <label class="check"><input type="checkbox" data-remember><span>Remember the key in this browser</span></label>
    <p class="warn">A remembered key is stored unencrypted in this browser. Anyone with access to this browser profile can read it, so leave this unticked on shared computers; the key is then forgotten when you close the tab.</p>
    <p class="warn">This site shares its address, ${esc(location.host)}, with every other site published from the same GitHub account. A page on any of them could read the key, remembered or not. Use a key here only if you trust them all; a free key can be replaced at restcountries.com at any time.</p>
    <div class="actions">
      <button class="btn primary" data-save>Save and test key</button>
      <button class="btn" data-clear>Clear key</button>
    </div>
    <p class="status" role="status"></p>
    <p class="shint" data-hint></p>
    <p class="shint">No key yet? <a href="https://restcountries.com/sign-up" target="_blank" rel="noopener noreferrer">Create a free key at restcountries.com</a> (1,000 requests a month). Answers are cached in this browser for three days.</p>
  </div>`;
  document.body.append(dlg);

  const input = dlg.querySelector("#keyIn");
  const show = dlg.querySelector("[data-show]");
  const remember = dlg.querySelector("[data-remember]");
  const status = dlg.querySelector(".status");
  const say = (text, cls = "") => {
    status.textContent = text;
    status.className = `status ${cls}`.trim();
  };

  show.addEventListener("click", () => {
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    show.textContent = visible ? "Hide" : "Show";
    show.setAttribute("aria-pressed", String(visible));
  });

  remember.addEventListener("change", () => rc.remember(remember.checked));

  dlg.querySelector("[data-save]").addEventListener("click", async () => {
    const key = input.value.trim();
    if (!KEY_PATTERN.test(key)) {
      say(
        "That doesn't look like an API key. Keys are 8 to 256 characters of letters, digits and - _ . ~ + / =",
        "bad",
      );
      return;
    }
    rc.setKey(key, remember.checked);
    say("Testing the key…");
    try {
      await rc.request("DE");
      say(
        remember.checked
          ? "Key works and is saved in this browser."
          : "Key works. It will be forgotten when you close this tab.",
        "ok",
      );
      onChange();
    } catch (e) {
      say(errorText(e), "bad");
    }
  });

  dlg.querySelector("[data-clear]").addEventListener("click", () => {
    rc.clear();
    input.value = "";
    remember.checked = false;
    say("Key and cached country facts removed from this browser.", "ok");
    onChange();
  });

  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
  });

  return {
    open() {
      if (FRAMED) {
        alert(
          "Settings are disabled because this page is embedded in another site. Open it directly to use a REST Countries key.",
        );
        return;
      }
      input.value = rc.key ?? "";
      input.type = "password";
      show.textContent = "Show";
      show.setAttribute("aria-pressed", "false");
      remember.checked = rc.remembered;
      say(
        rc.key
          ? rc.remembered
            ? "A key is saved in this browser."
            : "A key is set for this tab only."
          : "No key set. The app works without one.",
      );
      dlg.querySelector("[data-hint]").innerHTML =
        `REST Countries only answers pages whose hostname is on the key's allowed list. Add <code>${esc(location.hostname || "localhost")}</code> on the API Keys page at restcountries.com.`;
      dlg.showModal();
    },
  };
}
