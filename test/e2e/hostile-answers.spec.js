// What Wikipedia, Wikidata and REST Countries send back is untrusted: anyone
// can edit the first two. Here every text they return carries markup that
// would run script or add elements if it were put on the page as HTML. Each
// app must show it as plain text and nothing more.
import { test, expect } from "@playwright/test";
import { cspViolations, openPage } from "./helpers.js";

const MARK = "pwned";
const P = `<img src=x id=${MARK} onerror="window.__${MARK}=1">"'><svg id=${MARK}2></svg>`;
const QID = "Q42";

/** A hostile answer for any request the apps make to an outside service. */
function hostile(url) {
  const host = url.hostname;
  const params = url.searchParams;
  if (host === "en.wikipedia.org") {
    return {
      query: {
        pages: {
          1: { pageid: 1, title: P, extract: `${P}\n${P}`, pageprops: { wikibase_item: QID } },
        },
      },
    };
  }
  if (host === "www.wikidata.org") {
    const ids = (params.get("ids") ?? QID).split("|");
    const entities = {};
    for (const id of ids) {
      const item = () => ({
        rank: "normal",
        mainsnak: { datavalue: { type: "wikibase-entityid", value: { id: "Q1" } } },
      });
      const amount = {
        rank: "normal",
        mainsnak: { datavalue: { type: "quantity", value: { amount: "+12.5" } } },
      };
      entities[id] = {
        labels: { en: { value: P } },
        descriptions: { en: { value: P } },
        sitelinks: { enwiki: { title: P } },
        claims: Object.fromEntries(
          ["P571", "P462", "P180", "P287", "P610", "P885", "P403", "P138"]
            .map((p) => [p, [item()]])
            .concat(
              ["P2043", "P2044", "P2046", "P4511", "P2049", "P2061"].map((p) => [p, [amount]]),
            ),
        ),
      };
    }
    return { entities };
  }
  if (host === "query.wikidata.org") {
    const entity = (id) => ({ type: "uri", value: `http://www.wikidata.org/entity/${id}` });
    return {
      results: {
        bindings: ["P36", "P37", "P38", "P122", "P35", "P85"].map((pid) => ({
          c: entity("Q183"),
          pid: entity(pid),
          v: entity("Q1"),
          vLabel: { type: "literal", value: P },
          code: { value: "DE" },
          date: { value: "1949-05-23T00:00:00Z" },
        })),
      },
    };
  }
  if (host === "api.restcountries.com") {
    return {
      data: {
        objects: [
          {
            names: { official: P },
            capitals: [{ name: P }],
            subregion: P,
            population: 5,
            area: { kilometers: 5 },
            languages: { x: { name: P } },
            currencies: { X: { name: P, symbol: P } },
            flag: { description: P },
          },
        ],
      },
    };
  }
  return undefined;
}

/** Nothing from the answers became an element, ran, or turned into a link. */
async function expectNoInjection(page, problems) {
  expect(await page.locator(`#${MARK}, #${MARK}2`).count()).toBe(0);
  expect(await page.evaluate((m) => window[`__${m}`], MARK)).toBeUndefined();
  expect(await page.locator('a[href^="javascript:" i]').count()).toBe(0);
  expect([...problems, ...(await cspViolations(page))]).toEqual([]);
}

const KEY = { "flagatlas.restcountries.key": "test-key-0123456789" };

test("Flags shows hostile answers as text", async ({ page }) => {
  const problems = await openPage(page, "flags/", { answers: hostile, storage: KEY });
  await page.click('.tile[data-c="DE"]');
  const detail = page.locator("#detail");
  // The text arrives, escaped: the panels show the markup as characters.
  await expect(detail.locator("[data-wiki]")).toContainText("<img src=x");
  await expect(detail.locator("[data-facts]")).toContainText("<img src=x");
  await expectNoInjection(page, problems);
});

test("Countries and Territories shows hostile answers as text", async ({ page }) => {
  const problems = await openPage(page, "countries/", { answers: hostile, storage: KEY });
  await page.fill("#q", "Germany");
  await page.press("#q", "Enter");
  const panel = page.locator("#panel");
  await expect(panel.locator("h2")).toHaveText("Germany");
  await expect(panel).toContainText("<img src=x");
  await expectNoInjection(page, problems);
});

test("Cities and Regions shows hostile answers as text", async ({ page }) => {
  const problems = await openPage(page, "cities/", { answers: hostile, storage: KEY });
  await page.fill("#q", "Lyon");
  await page.press("#q", "Enter");
  const panel = page.locator("#panel");
  await expect(panel.locator("h2")).toHaveText("Lyon");
  await expect(panel).toContainText("<img src=x");
  await expectNoInjection(page, problems);
});

test("Terrain shows hostile answers as text", async ({ page }) => {
  const problems = await openPage(page, "terrain/", { answers: hostile });
  await page.fill("#q", "Caspian Sea");
  await page.press("#q", "Enter");
  const panel = page.locator("#panel");
  await expect(panel.locator("h2")).toHaveText("Caspian Sea");
  await expect(panel.locator("[data-wiki]")).toContainText("<img src=x");
  await expectNoInjection(page, problems);
});
