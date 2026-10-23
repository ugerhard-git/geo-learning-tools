// Countries and Territories in a real browser: the detail panel and every kind of quiz question.
import { test, expect } from "@playwright/test";
import { clickAt, cspViolations, openPage, readData } from "./helpers.js";

const PAGE = "countries/";

const WORLD = JSON.parse(readData("world.json"));
const COUNTRIES = readData("countries.txt")
  .trim()
  .split("\n")
  .map((line) => line.split("|"))
  .map(([code, , name]) => ({ code, name }));
const byName = (name) => COUNTRIES.find((c) => c.name === name);
const middle = (code) => WORLD.i[code].m;

/** The country a "Name it" question highlights, read from the map. */
async function highlighted(page) {
  const i = await page.locator("#world path.target").first().getAttribute("data-i");
  const codes = WORLD.f[Number(i)].c;
  return COUNTRIES.find((c) => codes.includes(c.code) && !c.code.includes("-"));
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
  const [lon, lat] = middle(byName(name).code);
  await clickAt(page, lon, lat);
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
