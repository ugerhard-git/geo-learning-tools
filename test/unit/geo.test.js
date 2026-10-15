import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bearing,
  distKm,
  formatKm,
  nearestOnRings,
  ringAreaKm2,
  ringsContain,
  segmentDistKm,
} from "../../src/shared/geo.js";

const close = (actual, expected, tolerance, label) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected} ± ${tolerance}`,
  );

test("distKm agrees with published great-circle distances", () => {
  close(distKm(13.405, 52.52, 12.496, 41.903), 1182, 5, "Berlin–Rome");
  close(distKm(13.405, 52.52, 2.352, 48.857), 878, 5, "Berlin–Paris");
  close(distKm(-0.128, 51.507, -74.006, 40.713), 5570, 15, "London–New York");
  assert.equal(distKm(10, 20, 10, 20), 0);
});

test("bearing names the direction of the second point as seen from the first", () => {
  assert.equal(bearing(0, 0, 0, 10), "north");
  assert.equal(bearing(0, 0, 10, 0), "east");
  assert.equal(bearing(0, 0, 0, -10), "south");
  assert.equal(bearing(0, 0, -10, 0), "west");
  // Rome lies south-south-east of Berlin, which rounds to south
  assert.equal(bearing(13.405, 52.52, 12.496, 41.903), "south");
  // and swapping the arguments must swap the answer
  assert.equal(bearing(12.496, 41.903, 13.405, 52.52), "north");
});

// A 2° × 2° square with a 1° × 1° hole in the middle.
const square = [0, 0, 2, 0, 2, 2, 0, 2];
const hole = [0.5, 0.5, 1.5, 0.5, 1.5, 1.5, 0.5, 1.5];

test("ringsContain uses the even-odd rule, so holes are outside", () => {
  assert.equal(ringsContain([square], 1, 1), true);
  assert.equal(ringsContain([square], 3, 1), false);
  assert.equal(ringsContain([square, hole], 1, 1), false);
  assert.equal(ringsContain([square, hole], 0.25, 0.25), true);
});

test("nearestOnRings finds the closest point on an edge", () => {
  const [lon, lat] = nearestOnRings([square], 3, 1);
  close(lon, 2, 1e-9, "lon");
  close(lat, 1, 1e-9, "lat");
  assert.equal(nearestOnRings([], 0, 0), null);
});

test("segmentDistKm measures to the nearest point of a segment", () => {
  // one degree north of the middle of an east–west segment on the equator
  close(segmentDistKm(0.5, 1, 0, 0, 1, 0), 111.2, 0.5, "perpendicular");
  // beyond the segment's end, the distance is to the end point
  close(segmentDistKm(3, 0, 0, 0, 1, 0), 2 * 111.2, 1, "past the end");
});

test("ringAreaKm2 is close to the true area near the equator", () => {
  // a 1° square at the equator is about 12,364 km²
  close(ringAreaKm2([0, 0, 1, 0, 1, 1, 0, 1]), 12364, 150, "1° square");
  assert.equal(ringAreaKm2([0, 0, 1, 1]), 0);
});

test("formatKm switches to whole kilometres with separators", () => {
  assert.equal(formatKm(3.14), "3.1");
  assert.equal(formatKm(2387.4), "2,387");
});
