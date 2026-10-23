// Roads in a real browser: the views, a country's details with its sources,
// the drills limited to the clues picked, and saved progress.
import { test, expect } from "@playwright/test";
import { cspViolations, openPage, readData } from "./helpers.js";

const PAGE = "roads/";
const ROADS = JSON.parse(readData("roads.json"));
const SIGNS = JSON.parse(readData("signs.json"));
const COUNT = Object.keys(ROADS.countries).length;

test("by country, by side and by sign; search narrows them", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await expect(page.locator(".rcard")).toHaveCount(COUNT);
  await page.fill("#q", "japan");
  await expect(page.locator(".rcard .rname")).toHaveText(["Japan"]);
  await page.fill("#q", "");

  await page.click('.filters [data-view="side"]');
  const left = Object.values(ROADS.countries).filter((c) => c.drive === "left").length;
  await expect(page.locator(".group").first().locator(".cchip")).toHaveCount(left);

  await page.click('.filters [data-view="stop"]');
  await expect(page.locator(".tile img").first()).toBeVisible();
  // Every drawing in signs.json can be shown. (The tiles load theirs as they
  // scroll into view, so each is loaded here on its own.)
  const files = Object.values(SIGNS).flatMap((c) => Object.values(c).map((s) => s.file));
  const broken = await page.evaluate(async (names) => {
    const out = [];
    for (const name of names) {
      const img = new Image();
      img.src = `../data/signs/${name}`;
      await img.decode().catch(() => out.push(name));
    }
    return out;
  }, files);
  expect(broken).toEqual([]);
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("a country's details link every fact to its source", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await page.fill("#q", "United States");
  await page.click('.rcard[data-code="US"]');
  const detail = page.locator("#detail");
  await expect(detail.locator("h2")).toHaveText("United States");
  await expect(detail).toContainText("On the right.");
  await expect(detail.getByRole("link", { name: "Left- and right-hand traffic" })).toHaveAttribute(
    "href",
    ROADS.sources.traffic.url,
  );
  // The colour and the style of the centre line each name their source.
  await expect(detail.getByRole("link", { name: "Road surface marking" })).toHaveCount(2);
  await expect(detail.locator(".patterns li")).toHaveCount(
    ROADS.countries.US.centre.patterns.length,
  );
  await expect(detail.locator(".patterns li").first()).toContainText("broken yellow");
  if (SIGNS.US?.stop) {
    await expect(
      detail.locator(`a[href^="https://commons.wikimedia.org/wiki/File:"]`).first(),
    ).toBeVisible();
    await expect(detail.getByRole("link", { name: SIGNS.US.stop.source }).first()).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await page.click("[data-credits]");
  await expect(detail.locator("h2")).toHaveText("Sources and credits");
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

/** Open the drill setup with only these clues picked. */
async function setUp(page, type, clues) {
  await page.click('header [data-mode="drill"]');
  await page.click(`#setup [data-type="${type}"]`);
  // Pick the wanted clues first, then drop the others (one always stays picked).
  for (const clue of clues) {
    const b = page.locator(`#setup [data-clue="${clue}"]`);
    if ((await b.getAttribute("aria-pressed")) === "false") await b.click();
  }
  for (const b of await page.locator("#setup [data-clue]").all()) {
    const clue = await b.getAttribute("data-clue");
    if (!clues.includes(clue) && (await b.getAttribute("aria-pressed")) === "true") await b.click();
  }
}

test("a clue drill asks only about the clue picked, and records it", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await setUp(page, "clue", ["side"]);
  await page.click("#setup [data-start]");
  await expect(page.locator("#drillbar")).toContainText("Which side of the road");
  await expect(page.locator("#drillbar .opts button")).toHaveText([/On the left/, /On the right/]);
  await page.keyboard.press("1");
  await expect(page.locator("#drillbar .opts button.right")).toHaveCount(1);
  await expect(page.locator("#sceneNote")).not.toBeEmpty();

  await page.click('header [data-mode="prog"]');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("roads.progress.v1")))
    .not.toBeNull();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("roads.progress.v1")));
  expect(Object.keys(saved)).toHaveLength(1);
  expect(Object.keys(saved)[0]).toMatch(/^d:[A-Z]{2}$/);
  // The choice of clues is remembered.
  expect(await page.evaluate(() => localStorage.getItem("roads.clues"))).toBe("side");
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("a sign question shows the drawing and four countries", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await setUp(page, "clue", ["stop"]);
  await page.click("#setup [data-start]");
  await expect(page.locator("#sceneArt img")).toBeVisible();
  const labels = await page.locator("#drillbar .opts button").allTextContents();
  expect(new Set(labels).size).toBe(4);
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("the scene drill draws the road and the signs picked", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await setUp(page, "scene", ["side"]);
  // The driving side alone cannot tell a country.
  await expect(page.locator("#setup")).toContainText("Pick at least two clues");
  await setUp(page, "scene", ["side", "lines", "stop"]);
  await page.click("#setup [data-start]");
  await expect(page.locator("#sceneArt svg")).toBeVisible();
  await expect(page.locator("#drillbar")).toContainText("Which country is this road in?");
  await page.keyboard.press("3");
  await expect(page.locator("#drillbar .opts button.right")).toHaveCount(1);
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("Spain's chevrons are drawn from their description, with its source", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await page.fill("#q", "Spain");
  await page.click('.rcard[data-code="ES"]');
  const detail = page.locator("#detail");
  await expect(detail.locator(".dchev svg")).toHaveCount(2);
  await expect(detail).toContainText("drawn by this app from that description");
  await expect(detail.getByRole("link", { name: "Spain: Plonk It guide" }).first()).toBeVisible();
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("New Zealand's give way sign is shown, its licence linked to NZTA's terms", async ({
  page,
}) => {
  const problems = await openPage(page, PAGE);
  await page.fill("#q", "New Zealand");
  await page.click('.rcard[data-code="NZ"]');
  const detail = page.locator("#detail");
  await expect(detail.locator("figure", { hasText: "Give way" }).locator("img")).toBeVisible();
  const terms = detail.getByRole("link", { name: SIGNS.NZ.yield.licence }).first();
  await expect(terms).toHaveAttribute("href", SIGNS.NZ.yield.terms);
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("a chevron drill can be limited to Southern Europe", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await setUp(page, "clue", ["chevron"]);
  await page.selectOption("#dWhere", "039");
  await page.click("#setup [data-start]");
  const names = await page.locator("#drillbar .opts button").allTextContents();
  expect(names).toHaveLength(4);
  // The remembered choice.
  expect(await page.evaluate(() => localStorage.getItem("roads.where"))).toBe("039");
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});
