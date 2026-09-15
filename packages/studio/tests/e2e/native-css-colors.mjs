import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { resolveChromeExecutable } from "./chrome-executable.mjs";

const cases = [
  ["white", [255, 255, 255, 1]],
  ["rebeccapurple", [102, 51, 153, 1]],
  ["#0f172acc", [15, 23, 42, 0.8]],
  ["rgb(255 0 0 / 50%)", [255, 0, 0, 0.5]],
  ["hsl(210 40% 50%)", [77, 128, 179, 1]],
  ["color(srgb 0.4 0 0.6)", [102, 0, 153, 1]],
  ["oklch(0.7 0.15 200)", [0, 185, 195, 1]],
  ["oklab(0.6 0.1 0.1)", [195, 96, 46, 1]],
  ["lab(100 0 0)", [255, 255, 255, 1]],
  ["color(display-p3 1 0 0)", [255, 0, 0, 1]],
  ["oklch(0.9 0.35 140)", [0, 255, 0, 1]],
  ["oklch(0.7 0.15 200 / 0)", [0, 185, 195, 0]],
  ["color(srgb 0.4 0 0.6 / 0.001)", [102, 0, 153, 0.001]],
  ["color-mix(in srgb, red 40%, blue)", [102, 0, 153, 1]],
  ["notacolor", null],
  ["#12", null],
  ["rgb(1. 2 3)", null],
  ["currentcolor", null],
  ["none", null],
  ["var(--color)", null],
  ["inherit", null],
  ["env(safe-area-inset-top)", null],
];

const output = mkdtempSync(join(tmpdir(), "native-css-colors-"));
let browser;
try {
  execFileSync(
    "bun",
    [
      "build",
      "packages/studio/src/components/editor/colorValue.ts",
      "packages/studio/src/components/editor/gradientValue.ts",
      "--target",
      "browser",
      "--outdir",
      output,
    ],
    { cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../../../..") },
  );
  const moduleUrl = (name) =>
    `data:text/javascript;base64,${readFileSync(join(output, `${name}.js`)).toString("base64")}`;
  browser = await puppeteer.launch({
    executablePath: resolveChromeExecutable(),
    headless: true,
    pipe: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const results = await page.evaluate(
    async (colorUrl, gradientUrl, inputs) => {
      const { parseCssColor, toColorPickerValue, mergeColorWithExistingAlpha } = await import(
        colorUrl
      );
      const { parseGradient, insertGradientStop } = await import(gradientUrl);
      const gradient = parseGradient("linear-gradient(90deg, black 0%, white 100%)");
      const alphaGradient = parseGradient("linear-gradient(90deg, #00000000 0%, #000000ff 100%)");
      const element = document.createElement("span");
      element.style.color = "oklch(0.7 0.15 200)";
      document.body.append(element);
      return {
        colors: inputs.map((input) => parseCssColor(input)),
        picker: toColorPickerValue(getComputedStyle(element).color),
        alpha: mergeColorWithExistingAlpha("#123456", "color(srgb 0.4 0 0.6 / 0.25)"),
        gradient: insertGradientStop(gradient, 50).stops[1].color,
        alphaGradient: insertGradientStop(alphaGradient, 50).stops[1].color,
      };
    },
    moduleUrl("colorValue"),
    moduleUrl("gradientValue"),
    cases.map(([input]) => input),
  );
  for (const [index, [input, channels]] of cases.entries()) {
    const actual = results.colors[index];
    if (!channels) {
      assert.equal(actual, null, `${input} should be rejected`);
      continue;
    }
    assert.ok(actual, `${input} should parse`);
    for (const [channelIndex, channel] of ["red", "green", "blue"].entries()) {
      assert.ok(
        Math.abs(actual[channel] - channels[channelIndex]) <= 1,
        `${input} ${channel}: ${actual[channel]} vs ${channels[channelIndex]}`,
      );
    }
    assert.ok(
      Math.abs(actual.alpha - channels[3]) < 0.000001,
      `${input} alpha: ${actual.alpha} vs ${channels[3]}`,
    );
  }
  assert.equal(results.picker, "#00b9c3");
  assert.equal(results.alpha, "rgba(18, 52, 86, 0.25)");
  assert.equal(results.gradient, "#808080");
  assert.equal(results.alphaGradient, "rgba(0, 0, 0, 0.5)");
  console.log(
    `Passed ${cases.length} native CSS color cases, computed-style picker, alpha preservation, and two gradient cases.`,
  );
} finally {
  await browser?.close();
  rmSync(output, { recursive: true, force: true });
}
