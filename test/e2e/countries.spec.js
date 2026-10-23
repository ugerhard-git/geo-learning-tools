// Countries and Territories in a real browser: the detail panel and every kind of quiz question.
import { test, expect } from "@playwright/test";
import { clickAt, cspViolations, openPage, readData, visiblePoint } from "./helpers.js";
import { PROJECTIONS } from "../../src/shared/projection.js";

const PAGE = "countries/";

const WORLD = JSON.parse(readData("world.json"));
const COUNTRIES = readData("countries.txt")
  .trim()
  .split("\n")
  .map((line) => line.split("|"))
  .map(([code, , name]) => ({ code, name }));
const byName = (name) => COUNTRIES.find((c) => c.name === name);
/**
 * A spot well inside a country, as longitude/latitude: of a grid laid over
 * its biggest outline, the point the outline covers that lies furthest from
 * any point it does not. The middle of its box can lie outside a crescent
 * like Croatia's, and a spot near a border can slip over it.
 */
async function inside(page, code) {
  const shapes = WORLD.f.flatMap((f, i) => (f.c.includes(code) ? [i] : []));
  const [mx, my] = await page.evaluate((idx) => {
    const paths = idx
      .map((i) => document.querySelector(`#world path[data-i="${i}"]`))
      .filter(Boolean);
    const area = (p) => p.getBBox().width * p.getBBox().height;
    const path = paths.sort((a, b) => area(b) - area(a))[0];
    const b = path.getBBox();
    const n = 30;
    const pts = [];
    for (let gx = -1; gx <= n + 1; gx++) {
      for (let gy = -1; gy <= n + 1; gy++) {
        const pt = new DOMPoint(b.x + (b.width * gx) / n, b.y + (b.height * gy) / n);
        pts.push({ x: pt.x, y: pt.y, in: path.isPointInFill(pt) });
      }
    }
    const outside = pts.filter((p) => !p.in);
    let best = null;
    for (const p of pts.filter((q) => q.in)) {
      const clear = Math.min(...outside.map((o) => Math.hypot(o.x - p.x, o.y - p.y)));
      if (!best || clear > best.clear) best = { clear, p: [p.x, p.y] };
    }
    return best.p;
  }, shapes);
  return PROJECTIONS.ee.inv(mx, my);
}

/** The country a "Name it" question highlights, read from the map. */
async function highlighted(page) {
  const i = await page.locator("#world path.target").first().getAttribute("data-i");
  const codes = WORLD.f[Number(i)].c;
  return COUNTRIES.find((c) => codes.includes(c.code) && !c.code.includes("-"));
}

/**
 * Wait for the map to stop moving: a question frames its candidates with a
 * short animation, and a click aimed at a country while the map still moves
 * lands on its neighbour. Two equal view boxes in a row mean it has stopped.
 */
/**
 * Zoom in on a spot, then click it. At the scale of the whole world a small
 * country is a few pixels wide, and the dots that mark its tiny neighbours
 * (Palestine's next to Jordan) can sit over it.
 */
async function zoomAndClick(page, lon, lat) {
  for (let i = 0; i < 4; i++) {
    const { x, y } = await visiblePoint(page, lon, lat);
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -400);
    await settled(page);
  }
  await clickAt(page, lon, lat);
}

async function settled(page) {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await page.locator("#map").getAttribute("viewBox");
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [150] },
    )
    .toBe(true);
}

async function startQuiz(page, dirn, level) {
  await page.click('header [data-mode="quiz"]');
  await page.click(`[data-dirn="${dirn}"]`);
  await page.click(`[data-level="${level}"]`);
  await expect(page.locator("#qPrompt")).not.toBeEmpty();
}

test("the panel shows a country's flag, outline and factbook geography", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await expect.poll(() => page.locator("#world path").count()).toBeGreaterThan(200);
  await page.fill("#q", "MLT"); // a three-letter code finds it too
  await page.press("#q", "Enter");
  const panel = page.locator("#panel");
  await expect(panel.locator("h2")).toHaveText("Malta");
  await expect(panel.locator(".outline svg use")).toHaveCount(1);
  await expect(panel.locator("h3", { hasText: "Geography" })).toBeVisible();
  await expect(panel).toContainText("Location");
  // No key and no network: the panel says what is missing rather than failing.
  await expect(panel).toContainText("More detail is available with a REST Countries key.");
  await expect(panel).toContainText("Wikidata couldn't be reached");
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("name it, typed: the right name counts, another country's name is called out", async ({
  page,
}) => {
  const problems = await openPage(page, PAGE);
  await startQuiz(page, "name", "hard");
  const target = await highlighted(page);
  await page.fill("#qIn", target.name.toUpperCase());
  await page.press("#qIn", "Enter");
  await expect(page.locator("#qFoot .msg")).toHaveText("Correct.");

  await page.press("#qFoot [data-next]", "Enter");
  const next = await highlighted(page);
  const other = next.code === "FR" ? "Spain" : "France";
  await page.fill("#qIn", other);
  await page.press("#qIn", "Enter");
  await expect(page.locator("#qFoot .msg")).toHaveText(
    `That's the name of ${other}. This is ${next.name}.`,
  );
  await expect(page.locator("#qScore")).toContainText("1 of 2");
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("find it, free hand: clicking the country is right", async ({ page }) => {
  await openPage(page, PAGE);
  await startQuiz(page, "find", "hard");
  const name = (await page.locator("#qPrompt").textContent()).match(/^Find (.+) on the map$/)[1];
  const [lon, lat] = await inside(page, byName(name).code);
  await settled(page);
  await zoomAndClick(page, lon, lat);
  await expect(page.locator("#qFoot .msg")).toHaveText("Correct.");
  await expect(page.locator("#world path.found").first()).toBeAttached();
});

test("find it, no borders: a miss is measured, and no other country is named", async ({ page }) => {
  await openPage(page, PAGE);
  await startQuiz(page, "find", "blind");
  await expect(page.locator("body")).toHaveClass(/blind/);
  const name = (await page.locator("#qPrompt").textContent()).match(/^Find (.+) on the map$/)[1];
  // The middle of the South Pacific is a long way from every country in the pool.
  await clickAt(page, -130, -45);
  const msg = page.locator("#qFoot .msg");
  await expect(msg).toHaveText(
    new RegExp(
      `^Not quite\\. ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is about [\\d,.]+ km [a-z-]+ of where you clicked\\.$`,
    ),
  );
  await expect(page.locator("#overlay .mk-line")).toHaveCount(1);
});

test("answers are saved under the established key and counted in the progress dialog", async ({
  page,
}) => {
  await openPage(page, PAGE);
  await startQuiz(page, "name", "easy");
  const target = await highlighted(page);
  await page.click("#qFoot [data-skip]");
  await page.click("#progBtn");
  const dialog = page.locator("#progress");
  await expect(dialog.locator(".pg-stat b").first()).toHaveText("1");
  await page.keyboard.press("Escape");
  await page.click('header [data-mode="explore"]');
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("flagatlasmap.progress.v1")),
  );
  expect(saved[`c:${target.code}`]).toEqual([1, expect.any(Number), 1, 1]);
});

test("clues: a domain names no place, and finding its place is right", async ({ page }) => {
  const FACTS = JSON.parse(readData("quick-facts.json")).facts;
  const problems = await openPage(page, PAGE);
  await page.click('header [data-mode="quiz"]');
  await page.click('[data-dirn="clue"]');
  // Phone codes are not asked.
  await expect(page.locator('#qClue option[value="phone"]')).toHaveCount(0);
  await page.selectOption("#qClue", "tld");
  // The shortlist frames four places closely, so the click cannot slip over a border.
  await page.click('[data-level="easy"]');
  const prompt = await page.locator("#qPrompt").textContent();
  const tld = prompt.match(/^Find the place whose internet domain is (\.[a-z]{2})$/)[1];
  // The prompt and the note under it never name the place.
  const code = Object.keys(FACTS).find((c) => FACTS[c].tld.includes(tld));
  const name = COUNTRIES.find((c) => c.code === code).name;
  await expect(page.locator("#quizbar")).not.toContainText(name);
  const [lon, lat] = await inside(page, code);
  await settled(page);
  await zoomAndClick(page, lon, lat);
  await expect(page.locator("#qFoot .msg")).toHaveText(`Correct: its internet domain is ${tld}.`);
  // Saved under the clue's own key.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("flagatlasmap.progress.v1") ?? ""))
    .toContain(`"d:${code}"`);
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("the panel lists a place's quick facts", async ({ page }) => {
  await openPage(page, PAGE);
  await expect.poll(() => page.locator("#world path").count()).toBeGreaterThan(200);
  await page.fill("#q", "Poland");
  await page.press("#q", "Enter");
  const panel = page.locator("#panel");
  await expect(panel.locator("h3", { hasText: "Quick facts" })).toBeVisible();
  await expect(panel).toContainText(".pl");
  await expect(panel).toContainText("+48");
  await expect(panel).toContainText("PLN");
});
