// Terrain Atlas in a real browser: layers, picking features, the drills and saved progress.
import { test, expect } from "@playwright/test";
import { clickAt, cspViolations, openPage, readData, screenPoint } from "./helpers.js";
import { unpackRing } from "../../src/shared/codec.js";

const PAGE = "terrain-atlas/";

/** The features, decoded the way the app decodes them (geometry only where needed). */
const json = JSON.parse(readData("terrain.json"));
const FEATURES = json.features.split("\n").map((line) => {
  const f = line.split("\t");
  const scale = f[8] === "x" ? json.scale.point : json.scale.line;
  return {
    kind: f[0],
    name: f[1],
    geom: f[8],
    parts: f[9].split("|").map((p) => unpackRing(p, scale)),
  };
});
const feature = (name, kind) => FEATURES.find((f) => f.name === name && (!kind || f.kind === kind));

test("layers switch kinds of feature on and off, and are remembered", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await expect.poll(() => page.locator("#feats path").count()).toBeGreaterThan(500);
  const peaks = page.locator('#layers [data-layer="pea"]');
  await expect(peaks).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#feats g.k-pea")).toHaveClass(/off/);
  await peaks.click();
  await expect(peaks).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#feats g.k-pea")).not.toHaveClass(/off/);
  await page.reload();
  await expect(page.locator('#layers [data-layer="pea"]')).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("terrain.layers"))).toContain("pea");
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("search and a click on the map both open a feature's details", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await page.fill("#q", "Danube");
  await page.press("#q", "Enter");
  const panel = page.locator("#panel");
  await expect(panel.locator("h2")).toHaveText("Danube");
  await expect(panel).toContainText("River");
  // Natural Earth gives no Wikidata id for the Danube, and the panel says so.
  await expect(panel.locator("[data-wiki] .err")).toContainText("no Wikidata id");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.click('[data-zoom="home"]');

  // Click on the middle of the Caspian Sea.
  const caspian = feature("Caspian Sea");
  const ring = caspian.parts[0];
  let [lon, lat] = [0, 0];
  for (let i = 0; i < ring.length; i += 2) [lon, lat] = [lon + ring[i], lat + ring[i + 1]];
  const n = ring.length / 2;
  const { x, y } = await screenPoint(page, lon / n, lat / n);
  await page.mouse.click(x, y);
  await expect(panel.locator("h2")).toHaveText("Caspian Sea");
  // It has an id, but Wikidata cannot be reached in the tests, and the panel says so.
  await expect(panel.locator("[data-wiki] .err")).toContainText("Wikidata couldn't be reached");
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

/** Start a drill. */
async function startDrill(page, type, { hard = false } = {}) {
  await page.click('header [data-mode="drill"]');
  await page.click(`#setup [data-type="${type}"]`);
  if (await page.locator("[data-hard]").count()) await page.click(`[data-hard="${hard ? 1 : 0}"]`);
  await page.selectOption("#dLen", "10");
  await page.click("#setup [data-start]");
  await expect(page.locator("#drillbar")).toBeVisible();
}

test("locate: a click on the feature is right; the miss says how far and which way", async ({
  page,
}) => {
  const problems = await openPage(page, PAGE, {
    storage: { "terrain.kinds": "rng", "terrain.level": "2", "terrain.scope": "W" },
  });
  await startDrill(page, "locate");
  const asked = async () => {
    const name = (await page.locator("#drillbar .qprompt").textContent()).match(
      /^Where is (.+?)\?/,
    )[1];
    return feature(name, "rng");
  };

  // A point on the range itself is right.
  const range = await asked();
  await clickAt(page, range.parts[0][0], range.parts[0][1]);
  await expect(page.locator("#drillbar .msg")).toHaveClass(/ok/);

  // A point far out in the ocean is not.
  await page.click("#drillbar [data-next]");
  await asked();
  const sea = await screenPoint(page, -140, -40);
  await page.mouse.click(sea.x, sea.y);
  await expect(page.locator("#drillbar .msg")).toHaveText(
    /^Not quite\. .+ is [\d,.]+ km (north|south|east|west)[a-z-]* of your click\.$/,
  );
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("name it: four choices, one right, and the score counts", async ({ page }) => {
  await openPage(page, PAGE, { storage: { "terrain.kinds": "riv,sea", "terrain.level": "2" } });
  await startDrill(page, "name");
  const options = page.locator("#drillbar .opts button");
  await expect(options).toHaveCount(4);
  await page.keyboard.press("1");
  await expect(page.locator("#drillbar .opts button.right")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator("#drillbar .qscore")).toHaveText(
    /^[01] of 1 right · question 2 of \d+$/,
  );
});

test("a skipped question is saved as a miss, under the established key", async ({ page }) => {
  await openPage(page, PAGE, { storage: { "terrain.kinds": "riv", "terrain.level": "2" } });
  await startDrill(page, "name", { hard: true });
  // Reveal the answer, then use the name for the re-asked question later.
  await page.click("#drillbar [data-skip]");
  const answer = (await page.locator("#drillbar .msg").textContent()).match(
    /^The answer is (.+)\.$/,
  )[1];
  await page.click('header [data-mode="explore"]');
  const saved = await page.evaluate(
    () =>
      new Promise((r) =>
        setTimeout(() => r(localStorage.getItem("terrainatlas.progress.v1")), 600),
      ),
  );
  const records = JSON.parse(saved);
  const key = `n:riv/${answer}`;
  expect(records[key]).toEqual([1, expect.any(Number), 1, 1]);
});

test("the region select tells the whole world and the open ocean apart", async ({ page }) => {
  // In the open ocean there are only islands and seamounts.
  await openPage(page, PAGE, { storage: { "terrain.kinds": "isl,pea", "terrain.level": "9" } });
  await page.click('header [data-mode="drill"]');
  const scope = page.locator("#dScope");
  await expect(scope.locator("option:checked")).toHaveText("Whole world");
  await scope.selectOption({ label: "Open ocean" });
  await expect(page.locator("#dScope option:checked")).toHaveText("Open ocean");
  await expect(page.locator("#setup .due")).toHaveText(/^9 in this set/);
});
