import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECTIONS, WORLD_W, projectBox, worldFrame } from "../../src/shared/projection.js";

for (const [key, proj] of Object.entries(PROJECTIONS)) {
  test(`${key}: inverse undoes forward across the map`, () => {
    let worst = 0;
    for (let lon = -170; lon <= 170; lon += 17) {
      for (let lat = -80; lat <= 80; lat += 8) {
        const [x, y] = proj.fwd(lon, lat);
        const [lon2, lat2] = proj.inv(x, y);
        worst = Math.max(worst, Math.abs(lon2 - lon), Math.abs(lat2 - lat));
      }
    }
    assert.ok(worst < 1e-9, `round trip error ${worst}°`);
  });

  test(`${key}: the world is ${WORLD_W} units wide, centred on Greenwich`, () => {
    assert.ok(Math.abs(proj.fwd(-180, 0)[0]) < 1e-6);
    assert.ok(Math.abs(proj.fwd(180, 0)[0] - WORLD_W) < 1e-6);
    assert.ok(Math.abs(proj.fwd(0, 0)[0] - WORLD_W / 2) < 1e-6);
  });

  test(`${key}: north is up`, () => {
    assert.ok(proj.fwd(0, 50)[1] < proj.fwd(0, -50)[1]);
  });
}

test("Equal Earth puts the poles at the top and bottom of its extent", () => {
  const ee = PROJECTIONS.ee;
  assert.ok(Math.abs(ee.fwd(0, 90)[1]) < 1, "north pole at y = 0");
  assert.ok(Math.abs(ee.fwd(0, -90)[1] - ee.extent[3]) < 1, "south pole at the bottom");
});

test("Equal Earth is equal-area: a small cell keeps its area at any longitude", () => {
  const ee = PROJECTIONS.ee;
  // Off the central meridian a cell is a sheared parallelogram, so measure it
  // as the cross product of its two edges rather than width × height.
  const area = (lon, lat, h = 0.01) => {
    const [x0, y0] = ee.fwd(lon, lat);
    const [xe, ye] = ee.fwd(lon + h, lat);
    const [xn, yn] = ee.fwd(lon, lat + h);
    return Math.abs((xe - x0) * (yn - y0) - (ye - y0) * (xn - x0));
  };
  for (const lon of [60, 120, 170]) {
    const ratio = area(0, 40) / area(lon, 40);
    assert.ok(Math.abs(ratio - 1) < 1e-3, `ratio at ${lon}°: ${ratio}`);
  }
});

test("projectBox contains every projected corner", () => {
  const [x, y, w, h] = projectBox(PROJECTIONS.ee, [5, 45, 10, 10]);
  for (const [lon, lat] of [
    [5, 45],
    [15, 45],
    [5, 55],
    [15, 55],
  ]) {
    const [px, py] = PROJECTIONS.ee.fwd(lon, lat);
    assert.ok(px >= x - 1e-9 && px <= x + w + 1e-9 && py >= y - 1e-9 && py <= y + h + 1e-9);
  }
});

test("worldFrame reaches below a southern country on Mercator", () => {
  const merc = PROJECTIONS.merc;
  const [, y, , h] = worldFrame(merc, -70);
  assert.ok(y + h >= merc.fwd(0, -70)[1], "frame reaches 70° south");
  assert.deepEqual(worldFrame(PROJECTIONS.ee, -70), PROJECTIONS.ee.extent);
});
