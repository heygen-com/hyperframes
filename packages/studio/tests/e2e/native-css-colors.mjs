// Run with: node packages/studio/tests/e2e/native-css-colors.mjs
// Uses real browser CSS parsing; happy-dom cannot verify these conversions.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { resolveChromeExecutable } from "./chrome-executable.mjs";

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
    async (colorUrl, gradientUrl) => {
      const { parseCssColor, toColorPickerValue, mergeColorWithExistingAlpha } = await import(
        colorUrl
      );
      const { parseGradient, insertGradientStop } = await import(gradientUrl);
      const inputs = [
        "white",
        "rebeccapurple",
        "#0f172acc",
        "rgb(255 0 0 / 50%)",
        "hsl(210 40% 50%)",
        "color(srgb 0.4 0 0.6)",
        "oklch(0.7 0.15 200)",
        "oklab(0.6 0.1 0.1)",
        "lab(100 0 0)",
        "color(display-p3 1 0 0)",
        "oklch(0.7 0.15 200 / 0)",
        "color(srgb 0.4 0 0.6 / 0.001)",
        "color-mix(in srgb, red 40%, blue)",
        "notacolor",
        "#12",
        "currentcolor",
        "none",
        "var(--color)",
      ];
      const colors = inputs.map((input) => parseCssColor(input));
      const gradient = parseGradient("linear-gradient(90deg, black 0%, white 100%)");
      const alphaGradient = parseGradient("linear-gradient(90deg, #00000000 0%, #000000ff 100%)");
      const element = document.createElement("span");
      element.style.color = "oklch(0.7 0.15 200)";
      document.body.append(element);
      return {
        colors,
        picker: toColorPickerValue(getComputedStyle(element).color),
        alpha: mergeColorWithExistingAlpha("#123456", "color(srgb 0.4 0 0.6 / 0.25)"),
        gradient: insertGradientStop(gradient, 50).stops[1].color,
        alphaGradient: insertGradientStop(alphaGradient, 50).stops[1].color,
      };
    },
    moduleUrl("colorValue"),
    moduleUrl("gradientValue"),
  );
  const expected = [
    [255, 255, 255, 1],
    [102, 51, 153, 1],
    [15, 23, 42, 0.8],
    [255, 0, 0, 0.5],
    [77, 128, 179, 1],
    [102, 0, 153, 1],
    [0, 185, 195, 1],
    [195, 96, 46, 1],
    [255, 255, 255, 1],
    [255, 0, 0, 1],
    [0, 185, 195, 0],
    [102, 0, 153, 0.001],
    [102, 0, 153, 1],
    null,
    null,
    null,
    null,
    null,
  ];
  for (const [index, channels] of expected.entries()) {
    const actual = results.colors[index];
    if (!channels) {
      assert.equal(actual, null, `invalid color ${index}`);
      continue;
    }
    assert.ok(actual, `color ${index} parsed`);
    for (const [channel, value] of Object.entries({
      red: channels[0],
      green: channels[1],
      blue: channels[2],
    })) {
      assert.ok(
        Math.abs(actual[channel] - value) <= 1,
        `color ${index} ${channel}: ${actual[channel]} vs ${value}`,
      );
    }
    assert.ok(Math.abs(actual.alpha - channels[3]) < 0.000001, `color ${index} alpha`);
  }
  assert.equal(results.picker, "#00b9c3");
  assert.equal(results.alpha, "rgba(18, 52, 86, 0.25)");
  assert.equal(results.gradient, "#808080");
  assert.equal(results.alphaGradient, "rgba(0, 0, 0, 0.5)");
  console.log(
    "Passed 18 native CSS color cases, computed-style picker, alpha preservation, and two gradient cases.",
  );
} finally {
  await browser?.close();
  rmSync(output, { recursive: true, force: true });
}
