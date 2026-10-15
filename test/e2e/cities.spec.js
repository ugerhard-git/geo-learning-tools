// Cities and Regions in a real browser: exploring, the drills, and saved progress.
import { test, expect } from "@playwright/test";
import { clickAt, cspViolations, openPage, readData, visiblePoint } from "./helpers.js";
import { unpack } from "../../src/shared/codec.js";

const PAGE = "cities/";

/** The cities, decoded the way the app decodes them. */
const json = JSON.parse(readData("cities.json"));
const CITIES = json.cities.split("\n").map((line) => {
  const f = line.split("\t");
  const [lon, lat] = unpack(f[4]);
  return {
    name: f[0],
    iso: f[2],
    lon: lon / json.scale.city,
    lat: lat / json.scale.city,
    t: +f[6],
  };
});
const COUNTRY_NAMES = new Map(
  readData("countries.txt")
    .trim()
    .split("\n")
    .map((line) => line.split("|"))
    .map(([code, , name]) => [code, name]),
);

/**
 * The national capital a "Where is …?" question asks about. A few names
 * belong to more than one capital (Kingston), so the country hint settles it.
 */
async function askedCapital(page) {
  const name = (await page.locator("#drillbar .qprompt").textContent()).match(
    /^Where is (.+?)\?/,
  )[1];
  const matches = CITIES.filter((c) => c.t === 2 && c.name === name);
  if (matches.length === 1) return matches[0];
  await page.keyboard.press("h");
  const hint = await page.locator("#drillbar .hintv").textContent();
  return matches.find((c) => COUNTRY_NAMES.get(c.iso) === hint);
}

/** Start a drill of national capitals, with the given type, answer mode and scope. */
async function startDrill(page, type, { hard = false, length = "10", scope = "E" } = {}) {
  await page.click('header [data-mode="drill"]');
  await page.click(`#setup [data-type="${type}"]`);
  if (await page.locator("#dCat").count()) await page.selectOption("#dCat", "cap");
  // Europe: zoomed in far enough that no capital hides behind the drill bar.
  await page.selectOption("#dScope", scope);
  if (await page.locator("[data-hard]").count()) await page.click(`[data-hard="${hard ? 1 : 0}"]`);
  await page.selectOption("#dLen", length);
  await page.click("#setup [data-start]");
  await expect(page.locator("#drillbar")).toBeVisible();
}

test("search opens a city's details and marks its region", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await expect.poll(() => page.locator("#cities circle").count()).toBeGreaterThan(2000);
  await page.fill("#q", "Lyon");
  await page.press("#q", "Enter");
  const panel = page.locator("#panel");
  await expect(panel.locator("h2")).toHaveText("Lyon");
  await expect(panel).toContainText("France");
  await expect(panel).toContainText("Regional capital");
  await expect(page.locator("#regions path.hi")).toHaveCount(1);
  await panel.locator("[data-region]").click();
  await expect(panel.locator("h2")).toHaveText("Rhône");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("locate: a click on the city is right, a miss says how far and which way", async ({
  page,
}) => {
  const problems = await openPage(page, PAGE);
  await startDrill(page, "locate");

  // First question: click right on the city.
  const city = await askedCapital(page);
  await clickAt(page, city.lon, city.lat);
  await expect(page.locator("#drillbar .msg")).toHaveClass(/ok/);
  await expect(page.locator("#drillbar .msg")).toContainText("Correct");

  await page.click("#drillbar [data-next]");
  // Second question: click a good way off, towards the middle of the map.
  const next = await askedCapital(page);
  const at = await visiblePoint(page, next.lon, next.lat);
  const box = await page.locator("#map").boundingBox();
  await page.mouse.click(
    at.x + (at.x < box.x + box.width / 2 ? 300 : -300),
    at.y + (at.y < box.y + box.height / 2 ? 120 : -120),
  );
  const msg = page.locator("#drillbar .msg");
  await expect(msg).toHaveClass(/bad/);
  await expect(msg).toContainText(
    new RegExp(`^Not quite\\. .+ is [\\d,.]+ km (north|south|east|west)[a-z-]* of your click\\.$`),
  );
  // The answer is shown on the map.
  await expect(page.locator("#overlay .mk-line")).toHaveCount(1);
  await expect(page.locator("#overlay .mk-ring")).toHaveCount(1);
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("typed answers forgive a typo; naming another place says which", async ({ page }) => {
  await openPage(page, PAGE);
  await startDrill(page, "name", { hard: true });

  // "Name the city": the marked city is the ring's centre. Find it by position.
  const ring = page.locator("#overlay .mk-ring");
  const [cx, cy] = await ring.evaluate((el) => [+el.getAttribute("cx"), +el.getAttribute("cy")]);
  const { PROJECTIONS } = await import("../../src/shared/projection.js");
  const city = CITIES.filter((c) => c.t === 2)
    .map((c) => ({
      c,
      d: Math.hypot(...PROJECTIONS.ee.fwd(c.lon, c.lat).map((v, i) => v - [cx, cy][i])),
    }))
    .sort((a, b) => a.d - b.d)[0].c;

  // One letter wrong in a long enough name still counts.
  const typo = city.name.length >= 5 ? city.name.slice(0, -1) + "q" : city.name;
  await page.fill("#dIn", typo);
  await page.press("#dIn", "Enter");
  await expect(page.locator("#drillbar .msg")).toHaveClass(/ok/);

  // The next question, answered with a different capital's exact name.
  await page.press("#drillbar [data-next]", "Enter");
  await expect(page.locator("#dIn")).toBeEditable();
  await page.fill("#dIn", "Reykjavík");
  await page.press("#dIn", "Enter");
  const msg = page.locator("#drillbar .msg");
  // Unless Reykjavík was the answer, the feedback names it.
  const text = await msg.textContent();
  if (!/^Correct/.test(text)) {
    await expect(msg).toHaveText(/^That is Reykjavík\. The answer is .+\.$/);
  }
});

test("progress is saved in the established format and shown on the progress screen", async ({
  page,
}) => {
  // Progress from an earlier version: a record the app must keep reading.
  const old = { "l:FR/Paris": [3, 0, 4, 1], "rl:FR-59": [1, 0, 2, 2], "junk:x": "nonsense" };
  await openPage(page, PAGE, { storage: { "cityatlas.progress.v1": JSON.stringify(old) } });
  await page.click('header [data-mode="prog"]');
  const tiles = page.locator("#progress .pg-stat b");
  await expect(tiles.nth(0)).toHaveText("2"); // practised
  await expect(tiles.nth(2)).toHaveText("2"); // due

  // Answer one question; the new record lands under the same key scheme.
  await startDrill(page, "locate");
  const city = await askedCapital(page);
  await clickAt(page, city.lon, city.lat);
  await page.click('header [data-mode="explore"]');
  await page.reload();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("cityatlas.progress.v1")),
  );
  const key = `l:${city.iso}/${city.name}`;
  expect(saved[key]).toEqual([expect.any(Number), expect.any(Number), expect.any(Number), 0]);
  expect(saved["l:FR/Paris"]).toEqual(city.name === "Paris" ? saved[key] : [3, 0, 4, 1]);
  expect(saved["junk:x"]).toBeUndefined();
});

test("export and import move progress between devices", async ({ page }) => {
  const records = { "n:JP/Tokyo": [4, 99999, 5, 0] };
  await openPage(page, PAGE, { storage: { "cityatlas.progress.v1": JSON.stringify(records) } });
  await page.click('header [data-mode="prog"]');
  await page.click("#progress [data-export]");
  const exported = JSON.parse(await page.locator("dialog[open] textarea").inputValue());
  expect(exported).toMatchObject({ app: "cityatlas", v: 1, p: records });
  await page.keyboard.press("Escape");

  await page.click("#progress [data-import]");
  await page
    .locator("dialog[open] textarea")
    .fill(JSON.stringify({ app: "cityatlas", v: 1, p: { "c:IS/Reykjavík": [2, 0, 1, 0] } }));
  await page.click("dialog[open] [data-act]");
  await expect(page.locator("dialog[open] .status")).toHaveText("Imported. 1 new, 0 updated.");

  await page
    .locator("dialog[open] textarea")
    .fill(JSON.stringify({ app: "terrainatlas", v: 1, p: {} }));
  await page.click("dialog[open] [data-act]");
  await expect(page.locator("dialog[open] .status")).toHaveText(
    "That does not look like a Cities and Regions export.",
  );
});

test("the projection switch is remembered across the map apps", async ({ page }) => {
  await openPage(page, PAGE);
  await page.click('[data-proj="merc"]');
  await expect(page.locator('[data-proj="merc"]')).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("flagatlas.projection"))).toBe("merc");
  await page.reload();
  await expect(page.locator('[data-proj="merc"]')).toHaveAttribute("aria-pressed", "true");
});
