// Flags in a real browser: browsing the flags, the detail view and the quiz.
import { test, expect } from "@playwright/test";
import { cspViolations, openPage, readData } from "./helpers.js";

const PAGE = "flags/";

const NAMES = new Map(
  readData("countries.txt")
    .trim()
    .split("\n")
    .map((line) => line.split("|"))
    .map(([code, , name]) => [code, name]),
);

/** The place behind the quiz's mystery flag, read from the image address. */
async function mysteryFlag(page) {
  const src = await page.locator("#quiz .qflag img").getAttribute("src");
  const code = src.match(/\/([a-z-]+)\.svg$/)[1].toUpperCase();
  return { code, name: NAMES.get(code) };
}

test("the page lists every flag, and search and filters narrow it", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await expect(page.locator(".tile")).toHaveCount(249);
  await expect(page.locator("#count")).toHaveText("249 flags");
  // Places that fly another country's flag have no tile of their own.
  await expect(page.locator('.tile[data-c="SJ"]')).toHaveCount(0);

  await page.fill("#q", "DEU");
  await expect(page.locator(".tile").first()).toHaveAttribute("data-c", "DE");
  await page.fill("#q", "");
  await page.click('.chip[data-r="O"]');
  const oceania = await page.locator(".tile").count();
  expect(oceania).toBeGreaterThan(20);
  expect(oceania).toBeLessThan(60);

  await page.selectOption("#sort", "alike");
  await expect(
    page.locator(".group h2", { hasText: "Southern Cross on a blue ensign" }),
  ).toBeVisible();
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("dates adopted say so when Wikidata cannot be reached", async ({ page }) => {
  await openPage(page, PAGE);
  await page.selectOption("#sort", "date");
  await expect(page.locator("#main .banner")).toHaveText(
    "Adoption dates couldn't be loaded from Wikidata. Check your connection, then pick this sort again.",
  );
});

test("the detail view shows the place on a map and steps through the flags", async ({ page }) => {
  const problems = await openPage(page, PAGE);
  await page.click('.tile[data-c="NO"]');
  const detail = page.locator("#detail");
  await expect(detail.locator("h2")).toHaveText("Norway");
  await expect(detail.locator(".sim button")).not.toHaveCount(0); // the Nordic crosses
  await expect(detail.locator(".map svg use")).toHaveCount(2);
  await expect(page.locator("#world path.hl")).not.toHaveCount(0);

  await detail.locator('[data-proj="merc"]').click();
  expect(await page.evaluate(() => localStorage.getItem("flagatlas.projection"))).toBe("merc");
  await expect(detail.locator(".pnote")).toContainText("Greenland");

  await page.keyboard.press("ArrowRight");
  await expect(detail.locator("h2")).not.toHaveText("Norway");
  await page.keyboard.press("Escape");
  await expect(detail).not.toBeVisible();
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
});

test("the quiz: typed names, near misses and wrong names", async ({ page }) => {
  await openPage(page, PAGE, { storage: { "flagatlas.quizLevel": "hard" } });
  await page.click("#quizBtn");
  const msg = page.locator("#quiz .qmsg");

  const first = await mysteryFlag(page);
  // One letter wrong in a long enough name still counts.
  const typo = first.name.length >= 5 ? `${first.name.slice(0, -1)}q` : first.name;
  await page.fill("#qIn", typo);
  await page.press("#qIn", "Enter");
  await expect(msg).toHaveClass(/ok/);

  await page.press("#quiz [data-next]", "Enter");
  const second = await mysteryFlag(page);
  const other = second.code === "FR" ? "Spain" : "France";
  await page.fill("#qIn", other);
  await page.press("#qIn", "Enter");
  await expect(msg).toHaveText(`That's the name of ${other}. This flag is ${second.name}.`);

  await page.waitForTimeout(500);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("flagatlas.progress.v1")),
  );
  expect(saved[`f:${second.code}`]).toEqual([1, expect.any(Number), 1, 1]);
});

test("the quiz never asks about a flag that cannot be told from France's", async ({ page }) => {
  await openPage(page, PAGE);
  await page.click('.chip[data-r="A"]');
  await page.click("#quizBtn");
  for (let i = 0; i < 25; i++) {
    const { code } = await mysteryFlag(page);
    expect(["GF", "GP", "MQ", "BL", "MF"]).not.toContain(code);
    // The number keys keep working from one question to the next.
    await page.keyboard.press("1");
    await expect(page.locator("#quiz .opts .right")).toHaveCount(1);
    await page.click("#quiz [data-next]");
  }
});
