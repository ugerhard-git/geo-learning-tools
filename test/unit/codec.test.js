import { test } from "node:test";
import assert from "node:assert/strict";
import { csvRings, ringsToPath, undelta, unpack, unpackRing } from "../../src/shared/codec.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-";

/** The encoder the data build uses, reproduced here so the decoder can be checked against it. */
function pack(values) {
  let out = "";
  for (const v of values) {
    let u = v < 0 ? -2 * v - 1 : 2 * v; // zig-zag
    do {
      const chunk = u & 31;
      u >>>= 5;
      out += ALPHABET[chunk | (u ? 32 : 0)];
    } while (u);
  }
  return out;
}

test("unpack reverses the 6-bit packing, including negatives and large values", () => {
  const values = [0, -1, 1, -2, 2, 15, -16, 16, 1000, -1000, 123456, -987654];
  assert.deepEqual(unpack(pack(values)), values);
});

test("unpack skips characters outside the alphabet", () => {
  const packed = pack([5, -7]);
  assert.deepEqual(unpack(`${packed[0]}\n "${packed.slice(1)}`), [5, -7]);
});

test("undelta turns steps into positions", () => {
  assert.deepEqual([...undelta([100, 200, 5, -10, 5, -10], 10)], [10, 20, 10.5, 19, 11, 18]);
});

test("unpackRing and csvRings decode the two stored formats", () => {
  const ring = [1350, 5250, 10, -5, -20, 0];
  assert.deepEqual([...unpackRing(pack(ring), 100)], [13.5, 52.5, 13.6, 52.45, 13.4, 52.45]);
  const [a, b] = csvRings("1350,5250,10,-5|0,0,100,0");
  assert.deepEqual([...a], [13.5, 52.5, 13.6, 52.45]);
  assert.deepEqual([...b], [0, 0, 1, 0]);
});

test("ringsToPath closes shapes, leaves lines open and drops tiny rings", () => {
  const identity = { fwd: (x, y) => [x, y] };
  const tri = [0, 0, 10, 0, 10, 10];
  assert.equal(ringsToPath([tri], identity), "M0 0L10 0L10 10Z");
  assert.equal(ringsToPath([tri], identity, { close: false }), "M0 0L10 0L10 10");
  assert.equal(ringsToPath([[0, 0, 1, 1]], identity), "");
  assert.equal(ringsToPath([[0, 0, 1, 1]], identity, { close: false, minPoints: 2 }), "M0 0L1 1");
});
