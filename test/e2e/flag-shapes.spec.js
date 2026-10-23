// Flags come in many shapes. Whatever the shape, a flag must fit inside its
// 3:2 box and never stretch the box or its row: Nepal is taller than wide,
// Switzerland and Vatican City are square, Qatar is long and thin.
import { test, expect } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { cspViolations, openPage } from "./helpers.js";

/** Width:height of the flags that are not 3:2. Everything else is drawn 3:2. */
const SHAPES = { np: 320 / 390, ch: 1, va: 1, qa: 320 / 126, be: 320 / 277 };

/** A plain PNG of the given size; enough to stand in for a flag image. */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 200)]);
  const pixels = deflateSync(Buffer.concat(Array(height).fill(row)));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** flagcdn.com, answered with stand-in images of each flag's real shape. */
function flagImages(url) {
  if (url.hostname !== "flagcdn.com") return undefined;
  const [, size, code] = url.pathname.match(/^\/w(\d+)\/([a-z-]+)\.png$/) ?? [];
  if (!size) return undefined;
  const width = Math.min(Number(size), 640);
  return png(width, Math.round(width / (SHAPES[code] ?? 1.5)));
}

/** Every flag sits inside its box, and the box keeps its 3:2 shape. */
async function expectContained(boxes) {
  for (const box of await boxes.all()) {
    const outer = await box.boundingBox();
    const img = await box.locator("img").boundingBox();
    expect(outer.width / outer.height).toBeCloseTo(1.5, 1);
    expect(img.x).toBeGreaterThanOrEqual(outer.x - 0.5);
    expect(img.y).toBeGreaterThanOrEqual(outer.y - 0.5);
    expect(img.x + img.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
    expect(img.y + img.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
  }
}

for (const viewport of [
  { width: 1024, height: 1366 }, // iPad Pro 12.9", portrait
  { width: 1366, height: 1024 }, // and landscape
  { width: 390, height: 844 }, // a phone
]) {
  test(`odd-shaped flags keep the grid even at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const problems = await openPage(page, "flags/", { answers: flagImages });
    const odd = ["NP", "CH", "VA", "QA", "BE"];
    for (const code of odd) {
      const tile = page.locator(`.tile[data-c="${code}"]`);
      await tile.scrollIntoViewIfNeeded();
      await expect(tile.locator("img")).toHaveJSProperty("complete", true);
      expect(await tile.locator("img").evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
    }
    await expectContained(page.locator(odd.map((c) => `.tile[data-c="${c}"] .f`).join(", ")));

    // Tiles side by side are the same height, odd shape or not.
    const heights = await page
      .locator(".tile .f")
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);

    // The detail view's big flag, too.
    await page.click('.tile[data-c="NP"]');
    await expect(page.locator("#detail h2")).toHaveText("Nepal");
    expect([...problems, ...(await cspViolations(page))]).toEqual([]);
  });
}
