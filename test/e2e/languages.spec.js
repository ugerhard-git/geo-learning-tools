// Scripts and Languages in a real browser: the cards, the details, the four
// drills and saved progress.
import { test, expect } from "@playwright/test";
import { cspViolations, openPage, readData } from "./helpers.js";

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
  await expect(detail.locator(".meta")).toContainText("India (some states)");
  await expect(detail.locator("h3", { hasText: "Where in India" })).toBeVisible();
  for (const state of kn.regions?.IN ?? []) await expect(detail).toContainText(state);
  await expect(detail.getByRole("link", { name: "Wikidata" }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Odia has no translation of the Declaration: no sentence, but its words.
  await page.fill("#q", "Odia");
  await page.click('.lcard[data-lang="or"]');
  await expect(detail.locator("h2")).toHaveText("Odia");
  await expect(detail.locator(".dsent")).toHaveCount(0);
  await expect(detail.locator(".dwords span").first()).toBeVisible();
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
