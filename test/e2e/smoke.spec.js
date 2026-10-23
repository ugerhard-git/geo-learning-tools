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
    path: "flags/",
    title: "Flags",
    ready: async (page) => expect.poll(() => page.locator(".tile").count()).toBeGreaterThan(240),
  },
  {
    path: "countries/",
    title: "Countries and Territories",
    ready: async (page) =>
      expect.poll(() => page.locator("#world path").count()).toBeGreaterThan(200),
  },
  {
    path: "cities/",
    title: "Cities and Regions",
    ready: async (page) =>
      expect.poll(() => page.locator("#cities circle").count()).toBeGreaterThan(2000),
  },
  {
    path: "terrain/",
    title: "Terrain",
    ready: async (page) =>
      expect.poll(() => page.locator("#feats path").count()).toBeGreaterThan(500),
  },
  {
    path: "languages/",
    title: "Scripts and Languages",
    ready: async (page) => expect.poll(() => page.locator(".lcard").count()).toBeGreaterThan(70),
  },
  {
    path: "roads/",
    title: "Roads",
    ready: async (page) => expect.poll(() => page.locator(".rcard").count()).toBeGreaterThan(110),
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
  expect(hrefs).toEqual(["flags/", "countries/", "cities/", "terrain/", "languages/", "roads/"]);
  for (const href of hrefs) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
  }
});

test("every app has a way back to the landing page", async ({ page }) => {
  for (const app of ["flags", "countries", "cities", "terrain", "languages", "roads"]) {
    await openPage(page, `${app}/`);
    await page.getByRole("link", { name: "All apps" }).click();
    await expect(page, app).toHaveTitle("Atlas Trainer");
  }
});

test("the old addresses forward to the renamed apps", async ({ page }) => {
  const moved = {
    "flag-atlas": "flags",
    "flag-atlas-map": "countries",
    "city-atlas": "cities",
    "terrain-atlas": "terrain",
  };
  for (const [old, now] of Object.entries(moved)) {
    // The single-file app's address, and the folder the apps had until the rename.
    for (const path of [`${old}.html`, `${old}/`]) {
      await openPage(page, path);
      await expect(page, path).toHaveURL(new RegExp(`/${now}/$`));
    }
  }
});

test("pages refuse to run inline script injected after load", async ({ page }) => {
  // The CSP allows scripts from this site's own files only, so anything
  // inline must be refused. This is the property that makes an HTML-injection
  // bug far less dangerous, so check it actually holds in a real browser.
  await openPage(page, "countries/");
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = "window.__injected = true";
    document.body.append(s);
  });
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  expect(await page.evaluate(() => window.__cspViolations.length)).toBeGreaterThan(0);
});
