import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildCube, paramsFromIntent } from "./cube-build.mjs";
import { validateCube } from "./cube-validate.mjs";

function rows(cube) {
  return cube
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[+-]?(?:\d|\.\d)/.test(line))
    .map((line) => line.split(/\s+/).map(Number));
}

function rowAt(cubeRows, size, r, g, b) {
  return cubeRows[(b * size + g) * size + r];
}

function luma(row) {
  return row[0] * 0.2126 + row[1] * 0.7152 + row[2] * 0.0722;
}

test("all-zero params produce a near-identity LUT", () => {
  const cube = buildCube({}, 3);
  assert.equal(validateCube(cube).ok, true);
  const parsed = rows(cube);
  for (let b = 0; b < 3; b++) {
    for (let g = 0; g < 3; g++) {
      for (let r = 0; r < 3; r++) {
        const row = rowAt(parsed, 3, r, g, b);
        assert.ok(Math.abs(row[0] - r / 2) < 0.000001);
        assert.ok(Math.abs(row[1] - g / 2) < 0.000001);
        assert.ok(Math.abs(row[2] - b / 2) < 0.000001);
      }
    }
  }
});

test("positive exposure increases unclipped output luma", () => {
  const identity = rows(buildCube({}, 5));
  const exposed = rows(buildCube({ exposure: 0.3 }, 5));
  for (let i = 0; i < identity.length; i++) {
    const before = luma(identity[i]);
    if (before > 0.02 && before < 0.95) {
      assert.ok(luma(exposed[i]) > before, `row ${i} should brighten`);
    }
  }
});

test("positive temperature warms mid-gray", () => {
  const parsed = rows(buildCube({ temperature: 0.2 }, 3));
  const mid = rowAt(parsed, 3, 1, 1, 1);
  assert.ok(mid[0] > 0.5, "red channel should rise");
  assert.ok(mid[2] < 0.5, "blue channel should fall");
});

test("positive contrast darkens shadows and brightens highlights", () => {
  const parsed = rows(buildCube({ contrast: 0.3 }, 5));
  const shadow = rowAt(parsed, 5, 1, 1, 1);
  const highlight = rowAt(parsed, 5, 3, 3, 3);
  assert.ok(luma(shadow) < 0.25, "below-mid gray should darken");
  assert.ok(luma(highlight) > 0.75, "above-mid gray should brighten");
});

test("outputs validate at the default size and are deterministic", () => {
  const params = { exposure: 0.15, contrast: 0.2, temperature: -0.1, saturation: 0.12 };
  const a = buildCube(params);
  const b = buildCube(params);
  assert.equal(a, b);
  assert.equal(validateCube(a).ok, true);
  assert.equal(validateCube(a).size, 33);
});

test("paramsFromIntent declines zero-overlap prompts and maps technical words", () => {
  assert.equal(paramsFromIntent("zqxv imaginary neutron look"), null);
  assert.deepEqual(paramsFromIntent("warm cinematic"), {
    temperature: 0.18,
    contrast: 0.08,
    saturation: 0.04,
  });
});
