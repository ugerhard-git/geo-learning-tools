// The landing page reads every app's saved progress and says what is due.
import { test, expect } from "@playwright/test";
import { openPage } from "./helpers.js";

test("with nothing saved, it suggests a place to start", async ({ page }) => {
  await openPage(page, "");
  await expect(page.locator("#todayHead")).toHaveText("Nothing tracked yet");
  await expect(page.locator("#todayGo")).toHaveAttribute("href", "flags/");
  await expect(page.locator(".tool .go a").first()).toHaveText("Open");
});

test("it counts what is due in each app, and ignores records it cannot trust", async ({ page }) => {
  const far = 99999; // a due day long after today
  await openPage(page, "", {
    storage: {
      "cityatlas.progress.v1": JSON.stringify({
        "l:FR/Paris": [1, 0, 1, 1],
        "rl:FR-59": [2, 0, 3, 1],
        "n:JP/Tokyo": [4, far, 6, 0],
        "junk:x": [9, 0, 0, 0], // no such box
        "also:junk": "nonsense",
      }),
      "flagatlas.progress.v1": JSON.stringify({ "f:DE": [5, far, 9, 0] }),
      "terrainatlas.progress.v1": "not even JSON",
    },
  });
  await expect(page.locator("#todayHead")).toHaveText("2 items are due for review");
  await expect(page.locator("#todayGo")).toHaveText("Review in Cities and Regions");
  await expect(page.locator("#todayPips")).toContainText("2 Cities");

  const city = page.locator(".tool", { hasText: "Cities and Regions" });
  await expect(city.locator(".stats")).toContainText("2 due now");
  await expect(city.locator(".stats")).toContainText("3 practised");
  await expect(city.locator(".stats")).toContainText("1 known well");
  await expect(city.locator(".breakdown")).toHaveText(
    "Locate 1 · Name the city 1 · Locate the region 1",
  );
  await expect(city.locator(".go a")).toHaveText("Review 2");

  const flags = page.locator(".tool", { hasText: "Every flag" });
  await expect(flags.locator(".stats")).toContainText("1 known well of 242");
  await expect(flags.locator(".go a")).toHaveText("Continue");
});

test("the cards sit two to a row, and an odd last card takes the whole row", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPage(page, "");
  const widths = () =>
    page.locator(".tool").evaluateAll((cards) => cards.map((c) => c.offsetWidth));
  const grid = await page.locator(".tools").evaluate((el) => el.clientWidth);
  const even = await widths();
  expect(even.every((w) => w < grid / 2)).toBe(true);

  // A fifth app, as if one were added.
  await page.locator(".tools").evaluate((el) => el.append(el.lastElementChild.cloneNode(true)));
  const odd = await widths();
  expect(odd.at(-1)).toBe(grid);
  expect(odd.slice(0, -1).every((w) => w < grid / 2)).toBe(true);
});
