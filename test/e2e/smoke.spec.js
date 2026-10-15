// Smoke tests: every page loads, draws its main content, and does so without
// a script error or a Content-Security-Policy violation. The behaviour of each
// app is tested in its own file.
//
// Requests to any other host are blocked, so the tests never depend on (or
// add load to) Wikipedia, Wikidata, REST Countries or the flag CDN. The apps
// are built to degrade gracefully when those are unreachable, and this keeps
// that property under test as well.
import { test, expect } from "@playwright/test";
import { cspViolations, openPage } from "./helpers.js";

const PAGES = [
  {
    path: "",
    title: "Atlas Trainer",
    ready: async (page) => expect(page.locator("#globe path")).not.toHaveCount(0),
  },
  {
    path: "flag-atlas/",
    title: "Flag Atlas",
    ready: async (page) => expect.poll(() => page.locator(".tile").count()).toBeGreaterThan(240),
  },
  {
    path: "flag-atlas-map/",
    title: "Flag Atlas Map",
    ready: async (page) =>
      expect.poll(() => page.locator("#world path").count()).toBeGreaterThan(200),
  },
  {
    path: "city-atlas/",
    title: "City Atlas",
    ready: async (page) =>
      expect.poll(() => page.locator("#cities circle").count()).toBeGreaterThan(2000),
  },
  {
    path: "terrain-atlas/",
    title: "Terrain Atlas",
    ready: async (page) =>
      expect.poll(() => page.locator("#feats path").count()).toBeGreaterThan(500),
  },
];

for (const { path, title, ready } of PAGES) {
  test(`${path || "the landing page"} loads cleanly`, async ({ page }) => {
    const problems = await openPage(page, path);
    await expect(page).toHaveTitle(title);
    await ready(page);
    // Give late work (data that arrives after first paint) a moment to fail, if it is going to.
    await page.waitForTimeout(300);
    expect([...problems, ...(await cspViolations(page))]).toEqual([]);
  });
}

test("every app linked from the landing page exists", async ({ page, request }) => {
  await openPage(page, "");
  const hrefs = await page
    .locator(".tool .go a")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(hrefs).toEqual(["flag-atlas/", "flag-atlas-map/", "terrain-atlas/", "city-atlas/"]);
  for (const href of hrefs) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
  }
});

test("the old single-file addresses forward to the apps", async ({ page }) => {
  for (const app of ["flag-atlas", "flag-atlas-map", "city-atlas", "terrain-atlas"]) {
    await openPage(page, `${app}.html`);
    await expect(page).toHaveURL(new RegExp(`/${app}/$`));
  }
});

test("pages refuse to run inline script injected after load", async ({ page }) => {
  // The CSP allows scripts from this site's own files only, so anything
  // inline must be refused. This is the property that makes an HTML-injection
  // bug far less dangerous, so check it actually holds in a real browser.
  await openPage(page, "flag-atlas-map/");
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__injected = true";
    document.body.append(s);
  });
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  expect(await page.evaluate(() => window.__cspViolations.length)).toBeGreaterThan(0);
});
