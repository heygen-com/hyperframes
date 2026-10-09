import assert from "node:assert/strict";
import test from "node:test";
import { ERROR_DIFFUSION_ALGORITHMS, applyErrorDiffusionRgba } from "./error-diffusion.mjs";

const EXPECTED_GRADIENTS = {
  "floyd-steinberg": "00000101/00010101/00100101/00010111/01010101/01011011",
  atkinson: "00000011/00001100/00010011/00010111/01001101/00111011",
  "jarvis-judice-ninke": "00000011/00001011/00011001/00101111/00100111/01011011",
  stucki: "00000011/00010101/00010110/00101011/00101101/01010111",
  burkes: "00000101/00010011/00010110/00101011/01010111/00101011",
  sierra: "00000011/00010101/00010110/00100111/00110111/00101101",
  "sierra-lite": "00000101/00010101/00100101/00010110/01010111/01010101",
  "two-row-sierra": "00000101/00010011/00010110/00101011/00101101/01011011",
};

test("exposes the eight article error-diffusion algorithms", () => {
  assert.deepEqual(Object.keys(ERROR_DIFFUSION_ALGORITHMS), Object.keys(EXPECTED_GRADIENTS));
});

test("matches deterministic golden patterns for every diffusion kernel", () => {
  const width = 8;
  const height = 6;
  const source = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.round((255 * (x + y * 0.7)) / (width - 1 + (height - 1) * 0.7));
      const offset = (y * width + x) * 4;
      source[offset] = value;
      source[offset + 1] = Math.round(value * 0.8);
      source[offset + 2] = Math.round(value * 0.55);
      source[offset + 3] = 17 + x + y;
    }
  }

  for (const [algorithm, expected] of Object.entries(EXPECTED_GRADIENTS)) {
    const output = source.slice();
    applyErrorDiffusionRgba(output, width, height, {
      algorithm,
      brightness: 1,
      contrast: 1,
      detail: 1,
      palette: ["#000000", "#ffffff"],
      pointSize: 1,
    });
    const rows = [];
    for (let y = 0; y < height; y++) {
      let row = "";
      for (let x = 0; x < width; x++) row += output[(y * width + x) * 4] ? "1" : "0";
      rows.push(row);
    }
    assert.equal(rows.join("/"), expected, algorithm);
    for (let i = 0; i < width * height; i++) assert.equal(output[i * 4 + 3], source[i * 4 + 3]);
  }
});

test("fills point-size blocks from their center sample", () => {
  const data = new Uint8ClampedArray([
    0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 5, 255, 255, 255, 6, 0, 0, 0, 7, 255,
    255, 255, 8,
  ]);
  applyErrorDiffusionRgba(
    data,
    4,
    2,
    {
      algorithm: "floyd-steinberg",
      brightness: 1,
      contrast: 1,
      detail: 1,
      palette: ["#000000", "#ffffff"],
      pointSize: 2,
    },
    new Float32Array(6),
  );
  assert.deepEqual(
    [...data],
    [
      255, 255, 255, 1, 255, 255, 255, 2, 255, 255, 255, 3, 255, 255, 255, 4, 255, 255, 255, 5, 255,
      255, 255, 6, 255, 255, 255, 7, 255, 255, 255, 8,
    ],
  );
});

test("preserves authored palette order and validates the public contract", () => {
  const reversed = new Uint8ClampedArray([0, 0, 0, 255]);
  applyErrorDiffusionRgba(reversed, 1, 1, {
    palette: ["#ffffff", "#000000"],
  });
  assert.deepEqual([...reversed], [255, 255, 255, 255]);

  assert.throws(
    () => applyErrorDiffusionRgba(new Uint8ClampedArray(4), 1, 1, { palette: ["#000000"] }),
    /2 to 6 colors/,
  );
  assert.throws(
    () =>
      applyErrorDiffusionRgba(new Uint8ClampedArray(4), 1, 1, {
        algorithm: "ordered-bayer",
      }),
    /unknown error-diffusion algorithm/,
  );
});
