// Scripts and Languages in a real browser: the cards, the details, the four
// drills and saved progress.
import { test, expect } from "@playwright/test";
import { clickAt, cspViolations, openPage, readData, settled } from "./helpers.js";
import { unpackRing } from "../../src/shared/codec.js";
import { ringsContain } from "../../src/shared/geo.js";
import { parseRegionShapes } from "../../src/shared/regions.js";
import { mapAreas } from "../../src/languages/drills.js";

const PAGE = "languages/";
const DATA = JSON.parse(readData("languages.json"));
const byName = new Map(DATA.languages.map((l) => [l.name, l]));

test("the cards list every language, and search and script filters narrow them", async ({
  page,
}) => {
  const problems = await openPage(page, PAGE);
  await expect(page.locator(".lcard")).toHaveCount(DATA.languages.length);

  // A letter finds the languages that use it.
  await page.fill("#q", "ő");
  await expect(page.locator(".lcard .lname")).toHaveText(["Hungarian"]);
  // So does a country.
  await page.fill("#q", "Switzerland");
  await expect(page.locator(".lcard .lname")).toHaveText(
    ["French", "German", "Italian", "Romansh"].filter((n) => byName.has(n)),
  );
  await page.fill("#q", "");

  await page.click('.filters [data-script="Cyrl"]');
  const cyrillic = DATA.languages.filter((l) => l.script === "Cyrl").length;
  await expect(page.locator(".lcard")).toHaveCount(cyrillic);
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("a card opens the language's letters, sentence and words", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await page.fill("#q", "Polish");
  // The language's own card: the first may be clicked before the search narrows the list.
  await page.click('.lcard[data-lang="pl"]');
  const detail = page.locator("#detail");
  await expect(detail.locator("h2")).toHaveText("Polish");
  await expect(detail.locator(".dtells")).toContainText("ł");
  await expect(detail.locator(".dsent")).toHaveText(byName.get("Polish").sentence);
  await expect(detail.locator(".dsent")).toHaveAttribute("lang", "pl");
  // Words of place names, each with its English, and the capital.
  await expect(detail.locator(".dplace")).toContainText("północ");
  await expect(detail.locator(".dplace")).toContainText("north");
  await expect(detail.locator(".dcaps")).toHaveText("Warszawa");
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

/** Open the drill setup and start a session of the given type. */
async function startDrill(page, type, { hard = false } = {}) {
  await page.click('header [data-mode="drill"]');
  await page.click(`#setup [data-type="${type}"]`);
  await page.click(`[data-hard="${hard ? 1 : 0}"]`);
  await page.click("#setup [data-start]");
  await expect(page.locator("#drillbar")).toBeVisible();
}

/** The first letter of each drill's progress keys. */
const PREFIX = { language: "l", letter: "t", script: "s", country: "c" };

for (const type of ["language", "letter", "script", "country"]) {
  test(`the "${type}" drill shows writing, offers four choices and records the answer`, async ({
    page,
  }) => {
    const problems = await openPage(page, PAGE);
    await startDrill(page, type);
    await expect(page.locator("#specText")).not.toBeEmpty();
    const options = page.locator("#drillbar .opts button");
    await expect(options).toHaveCount(4);
    // Four different answers, exactly one of them right.
    const labels = await options.allTextContents();
    expect(new Set(labels).size).toBe(4);
    await page.keyboard.press("2");
    await expect(page.locator("#drillbar .opts button.right")).toHaveCount(1);
    await expect(page.locator("#specNote")).not.toBeEmpty();
    await page.keyboard.press("Enter");
    await expect(page.locator("#drillbar .qscore")).toHaveText(/^[01] of 1 right · question 2/);

    await page.click('header [data-mode="prog"]');
    // Answers are saved a moment after they are given.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("languages.progress.v1")))
      .not.toBeNull();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("languages.progress.v1")),
    );
    expect(Object.keys(saved)).toHaveLength(1);
    expect(Object.keys(saved)[0]).toMatch(new RegExp(`^${PREFIX[type]}:`));
    await expect(page.locator("#progress")).toContainText("1 / ");
    expect([...problems, ...(await cspViolations(page))]).toEqual([]);
  });
}

test("India's regional languages say where they are official, with the source", async ({
  page,
}) => {
  const problems = await openPage(page, PAGE);
  const kn = DATA.languages.find((l) => l.id === "kn");
  await page.fill("#q", "Kannada");
  await page.click('.lcard[data-lang="kn"]');
  const detail = page.locator("#detail");
  await expect(detail.locator("h2")).toHaveText("Kannada");
  await expect(detail.locator(".meta")).toContainText("India (some regions)");
  await expect(detail.locator("h3", { hasText: "Where in India" })).toBeVisible();
  for (const state of kn.regions.IN.official) await expect(detail).toContainText(state);
  await expect(detail.getByRole("link", { name: kn.regions.IN.source.title })).toHaveAttribute(
    "href",
    kn.regions.IN.source.url,
  );
  await page.keyboard.press("Escape");

  // Odia has no translation of the Declaration: no sentence, but its words.
  await page.fill("#q", "Odia");
  await page.click('.lcard[data-lang="or"]');
  await expect(detail.locator("h2")).toHaveText("Odia");
  await expect(detail.locator(".dsent")).toHaveCount(0);
  await expect(detail.locator(".dwords span").first()).toBeVisible();
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("Basque says where in Spain and France it is used, and Afrikaans is South African", async ({
  page,
}) => {
  const problems = await openPage(page, PAGE);
  const eu = DATA.languages.find((l) => l.id === "eu");
  await page.fill("#q", "Basque");
  await page.click('.lcard[data-lang="eu"]');
  const detail = page.locator("#detail");
  await expect(detail.locator("h3", { hasText: "Where in Spain" })).toBeVisible();
  await expect(detail.locator("h3", { hasText: "Where in France" })).toBeVisible();
  await expect(detail).toContainText("Official in the Basque Country");
  await expect(detail).toContainText(
    "Spoken, without official status, in the French Basque Country",
  );
  await expect(detail.getByRole("link", { name: eu.regions.FR.source.title })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.fill("#q", "Afrikaans");
  await page.click('.lcard[data-lang="af"]');
  await expect(detail.locator(".meta")).toContainText("South Africa");
  await expect(detail).toContainText("Official in all of South Africa");
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("a language's details show where it is used on a map", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  // Kannada: one state of India shaded, India itself lighter.
  await page.fill("#q", "Kannada");
  await page.click('.lcard[data-lang="kn"]');
  const map = page.locator("#detail .lmap");
  await expect(map).toBeVisible();
  await expect(map.locator(".shade path.on")).toHaveCount(1);
  await expect(map.locator(".shade path.part")).toHaveCount(1);
  await page.keyboard.press("Escape");
  // Swedish: its two countries shaded whole.
  await page.fill("#q", "Swedish");
  await page.click('.lcard[data-lang="sv"]');
  const sv = DATA.languages.find((l) => l.id === "sv");
  await expect(map.locator(".shade path.on")).toHaveCount(sv.countries.length);
  await expect(map.locator(".shade path.part")).toHaveCount(0);
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

/* The outlines the map drill judges a click by, read here to find a spot inside one. */
const LAND = JSON.parse(readData("land.json"));
const landRings = (code) =>
  LAND.shapes
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([codes]) => codes.split(",").includes(code))
    .flatMap(([, rings]) => rings.split("|").map((r) => unpackRing(r, LAND.scale.shape)));
const REGION_SHAPES = parseRegionShapes(DATA.regionShapes);
const regionRings = (code) => REGION_SHAPES.get(code).map((r) => unpackRing(r, DATA.regionScale));

/** A spot well inside the largest of these rings: the grid point furthest from its edge. */
function spotInside(rings) {
  const ring = rings
    .map((r) => {
      const xs = r.filter((_, i) => i % 2 === 0);
      const ys = r.filter((_, i) => i % 2 === 1);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      return { r, box, area: (box[2] - box[0]) * (box[3] - box[1]) };
    })
    .sort((a, b) => b.area - a.area)[0];
  const [x0, y0, x1, y1] = ring.box;
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    for (let j = 0; j <= 24; j++) {
      const lon = x0 + ((x1 - x0) * i) / 24;
      const lat = y0 + ((y1 - y0) * j) / 24;
      pts.push({ lon, lat, in: ringsContain([ring.r], lon, lat) });
    }
  }
  const out = pts.filter((p) => !p.in);
  let best = null;
  for (const p of pts.filter((q) => q.in)) {
    const clear = Math.min(...out.map((o) => Math.hypot(o.lon - p.lon, o.lat - p.lat)));
    if (!best || clear > best.clear) best = { clear, p };
  }
  return [best.p.lon, best.p.lat];
}

/** The language a map question shows, found from its writing. */
async function askedLanguage(page) {
  const text = await page.locator("#specText").textContent();
  const words = text.split(" · ");
  return DATA.languages.find((l) =>
    words.length > 1 ? words.every((w) => l.words.includes(w)) : l.sentence === text,
  );
}

test("the map drill takes a click inside the right place, and shades it", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await page.click('header [data-mode="drill"]');
  await page.click('#setup [data-type="map"]');
  // The map drill is answered on the map, so there is no choice of easy or hard.
  await expect(page.locator("#setup [data-hard]")).toHaveCount(0);
  await page.click("#setup [data-start]");
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator("#drillbar")).toContainText("Where would you read this?");

  // First question: a click inside one of its places.
  const lang = await askedLanguage(page);
  expect(lang, "the language shown").toBeTruthy();
  const { countries, regions } = mapAreas(lang);
  const rings = countries.length ? landRings(countries[0]) : regionRings(regions[0]);
  const [lon, lat] = spotInside(rings);
  await settled(page);
  await clickAt(page, lon, lat);
  await expect(page.locator("#drillbar .msg")).toHaveText(`Correct: that is ${lang.name}.`);
  await expect(page.locator("#answer path.ans").first()).toBeAttached();
  await expect(page.locator("#specNote")).toContainText(lang.name);

  // Second question: shown, not answered.
  await page.click("#drillbar [data-next]");
  await expect(page.locator("#answer path")).toHaveCount(0);
  await page.click("#drillbar [data-skip]");
  await expect(page.locator("#drillbar .msg")).toContainText("The answer is");
  await expect(page.locator("#answer path.ans").first()).toBeAttached();

  // Saved under the map drill's own key.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("languages.progress.v1") ?? ""))
    .toContain(`"m:${lang.id}"`);
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("typed answers: the right name, a near miss, and another language", async ({ page }) => {
  await openPage(page, PAGE);
  await startDrill(page, "language", { hard: true });
  // Read which language it is from the specimen's lang attribute.
  const id = await page.locator("#specText").getAttribute("lang");
  const lang = DATA.languages.find((l) => l.id === id);
  await page.fill("#dIn", lang.name.replace(/\s*\(.*\)$/, "").toUpperCase());
  await page.press("#dIn", "Enter");
  await expect(page.locator("#drillbar .msg")).toHaveText(/^Correct/);

  await page.press("#dIn", "Enter");
  const id2 = await page.locator("#specText").getAttribute("lang");
  const other = DATA.languages.find(
    (l) => l.id !== id2 && !["bs", "hr", "sr-Latn"].includes(l.id) && l.name !== "Serbian",
  );
  await page.fill("#dIn", other.name);
  await page.press("#dIn", "Enter");
  await expect(page.locator("#drillbar .msg")).toHaveText(
    new RegExp(`^That is ${other.name.replace(/[()]/g, "\\$&")}\\. The answer is`),
  );
});
