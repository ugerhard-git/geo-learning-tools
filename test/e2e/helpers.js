// Shared set-up for the browser tests.
import { readFileSync } from "node:fs";
import { PROJECTIONS } from "../../src/shared/projection.js";

const DATA = new URL("../../src/data/", import.meta.url);

/** One of the site's data files, read from the source tree. */
export const readData = (name) => readFileSync(new URL(name, DATA), "utf8");

/**
 * Open a page with every outside host blocked, and collect what would show
 * it is broken: uncaught exceptions, console errors and CSP violations
 * (read the last with {@link cspViolations}).
 *
 * Blocking outside hosts keeps the tests from depending on (or adding load
 * to) Wikipedia, Wikidata, REST Countries or the flag CDN. The apps are
 * built to cope when those cannot be reached, and this keeps that under test.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} path
 * @param {object} [options]
 * @param {Record<string, string>} [options.storage] localStorage to start with
 * @param {(url: URL) => unknown} [options.answers] an answer for an outside
 *   request: a Buffer is sent as a PNG image, a string starting "<svg" as an
 *   SVG image, anything else as JSON, and
 *   undefined blocks the request as usual
 * @returns {Promise<string[]>} problems seen so far; keeps filling as the test runs
 */
export async function openPage(page, path, { storage, answers } = {}) {
  const problems = [];
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => {
      const body = answers?.(new URL(route.request().url()));
      if (body === undefined) return route.abort("blockedbyclient");
      if (Buffer.isBuffer(body)) return route.fulfill({ contentType: "image/png", body });
      if (typeof body === "string" && body.startsWith("<svg")) {
        return route.fulfill({ contentType: "image/svg+xml", body });
      }
      return route.fulfill({
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(body),
      });
    },
  );
  // Map moves are animated; with reduced motion they happen at once, so a
  // test can act on the map as soon as a question is shown.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((seed) => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI}`),
    );
    if (seed && !sessionStorage.getItem("__seeded")) {
      sessionStorage.setItem("__seeded", "1");
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }
  }, storage ?? null);
  page.on("pageerror", (err) => problems.push(`uncaught: ${err.message}`));
  page.on("console", (msg) => {
    // A blocked outside request logs "Failed to load resource"; that is the
    // test's doing, not the page's.
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) {
      problems.push(`console: ${msg.text()}`);
    }
  });
  await page.goto(path);
  return problems;
}

/** CSP violations the page has reported so far. */
export const cspViolations = (page) => page.evaluate(() => window.__cspViolations);

/**
 * Where a longitude/latitude is on screen, given the map's current view.
 * @param {import("@playwright/test").Page} page
 * @param {number} lon
 * @param {number} lat
 * @param {"ee" | "merc"} [projection]
 */
export async function screenPoint(page, lon, lat, projection = "ee") {
  const [x, y] = PROJECTIONS[projection].fwd(lon, lat);
  return page.evaluate(
    ([mx, my]) => {
      const svg = document.querySelector("#map");
      const vb = svg.viewBox.baseVal;
      const r = svg.getBoundingClientRect();
      return {
        x: r.left + ((mx - vb.x) / vb.width) * r.width,
        y: r.top + ((my - vb.y) / vb.height) * r.height,
      };
    },
    [x, y],
  );
}

/**
 * The place's position on screen, with the map panned first if the place
 * sits under a floating control (the projection switch, the drill bar).
 */
export async function visiblePoint(page, lon, lat) {
  for (let tries = 0; tries < 12; tries++) {
    const p = await screenPoint(page, lon, lat);
    const clear = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("#map") != null,
      p,
    );
    if (clear) return p;
    const box = await page.locator("#map").boundingBox();
    const key =
      p.y < box.y + box.height / 2
        ? p.y < box.y + 160
          ? "ArrowUp"
          : p.x < box.x + box.width / 2
            ? "ArrowLeft"
            : "ArrowRight"
        : "ArrowDown";
    await page.locator("#map").press(key);
  }
  throw new Error(`No clear spot on the map for ${lon}, ${lat}`);
}

/** Click a place on the map. */
export async function clickAt(page, lon, lat) {
  const { x, y } = await visiblePoint(page, lon, lat);
  await page.mouse.click(x, y);
}
