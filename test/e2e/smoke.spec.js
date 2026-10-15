// Smoke tests: every page loads, draws its main content, and does so without
// a script error or a Content-Security-Policy violation.
//
// Requests to any other host are blocked, so the tests never depend on (or
// add load to) Wikipedia, Wikidata, REST Countries or the flag CDN. The apps
// are built to degrade gracefully when those are unreachable, and this keeps
// that property under test as well.
import { test, expect } from "@playwright/test";

const PAGES = [
  {
    path: "index.html",
    title: /Atlas/,
    ready: async (page) => expect(page.locator("a[href$='-atlas.html']")).not.toHaveCount(0),
  },
  {
    path: "flag-atlas.html",
    title: "Flag Atlas",
    ready: async (page) => expect.poll(() => page.locator(".tile").count()).toBeGreaterThan(240),
  },
  {
    path: "flag-atlas-map.html",
    title: "Flag Atlas Map",
    ready: async (page) =>
      expect.poll(() => page.locator("#world path").count()).toBeGreaterThan(200),
  },
  {
    path: "city-atlas.html",
    title: "City Atlas",
    ready: async (page) =>
      expect.poll(() => page.locator("#cities circle").count()).toBeGreaterThan(2000),
  },
  {
    path: "terrain-atlas.html",
    title: "Terrain Atlas",
    ready: async (page) =>
      expect.poll(() => page.locator("#feats path").count()).toBeGreaterThan(500),
  },
];

/**
 * Open a page with outside hosts blocked, and collect everything that would
 * indicate it is broken: uncaught exceptions, console errors and CSP
 * violations.
 */
async function openPage(page, path) {
  const problems = [];
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => route.abort("blockedbyclient"),
  );
  // Recorded from inside the page: CSP violations are reported as DOM
  // events, and this runs before the page's own scripts.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI}`),
    );
  });
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

for (const { path, title, ready } of PAGES) {
  test(`${path} loads cleanly`, async ({ page }) => {
    const problems = await openPage(page, path);
    await expect(page).toHaveTitle(title);
    await ready(page);
    problems.push(...(await page.evaluate(() => window.__cspViolations)));
    expect(problems).toEqual([]);
  });
}

test("every app linked from the landing page exists", async ({ page, request }) => {
  await openPage(page, "index.html");
  const hrefs = await page
    .locator("a[href$='.html']")
    .evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute("href")))]);
  expect(hrefs.length).toBeGreaterThanOrEqual(4);
  for (const href of hrefs) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
  }
});

test("pages refuse to run inline script injected after load", async ({ page }) => {
  // The CSP pins each page's own script by hash, so anything else must be
  // refused. This is the property that makes an HTML-injection bug far less
  // dangerous, so check it actually holds in a real browser.
  await openPage(page, "flag-atlas-map.html");
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__injected = true";
    document.body.append(s);
  });
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  expect(await page.evaluate(() => window.__cspViolations.length)).toBeGreaterThan(0);
});
