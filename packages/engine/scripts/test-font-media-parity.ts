// Run with bun. Browser selection and launch flags come from the render engine.
import "./test-font-stylesheet-activation.ts";
import { acquireBrowser, buildChromeArgs } from "../src/services/browserManager.ts";
import { createFontMediaEvaluator } from "../../core/src/fonts/fontMediaQuery.ts";
import { EMBEDDED_FONT_DATA } from "../../core/src/fonts/fontData.generated.ts";
import assert from "node:assert/strict";
const queries = [
  "screen",
  "print",
  "(min-width:-1px)",
  "(min-height:-1px)",
  "(min-resolution:-1dppx)",
  "not (min-width:-1px)",
  "not (min-height:-1px)",
  "not (min-resolution:-1dppx)",
  "(resolution:-1dppx)",
  "not (resolution:-1dppx)",
  "(resolution:0dppx)",
  "(min-resolution:0dppx)",
  "not (min-resolution:0dppx)",
  "(min-aspect-ratio:-1)",
  "(min-aspect-ratio:-1/2)",
  "(min-aspect-ratio:1/-2)",
  "not (aspect-ratio:-1/2)",
  "(aspect-ratio:0/0)",
  "not (aspect-ratio:0/0)",
  "(min-aspect-ratio:1/0)",
  "(prefers-color-scheme: light)",
  "(prefers-color-scheme: dark)",
  "(prefers-reduced-motion: no-preference)",
  "(prefers-reduced-motion: reduce)",
  "(prefers-contrast: no-preference)",
  "(prefers-reduced-transparency: no-preference)",
  "(prefers-reduced-data: no-preference)",
  "(prefers-reduced-data: reduce)",
  "not (prefers-reduced-data: reduce)",
  "not screen and (prefers-reduced-data: reduce)",
  "screen and (prefers-reduced-data: reduce), (min-width: 1px)",
  "((prefers-reduced-data: reduce) or (min-width: 1px))",
  "(forced-colors: none)",
  "(hover: none)",
  "(pointer: none)",
  "(any-hover: none)",
  "(any-pointer: none)",
  "(color-gamut: srgb)",
  "(color-gamut: p3)",
  "(dynamic-range: standard)",
  "(resolution: 1dppx)",
  "(resolution: 2dppx)",
  "(min-resolution: 1.5dppx)",
  "(1000px <= width < 1200px)",
  "not print and (min-width: 1000px)",
  "((width >= 1000px) and (height > 1000px))",
  "(min-width:100mm)",
  "(min-width:100pt)",
  "(min-width:1000q)",
  "(orientation: portrait)",
  "(orientation: landscape)",
  "screen, (",
  "(unsupported-feature: yes)",
  "not (unsupported-feature: yes)",
  "imaginary",
  "not imaginary",
];
const results = [];
for (const viewport of [
  { width: 1080, height: 1920, deviceScaleFactor: 1 },
  { width: 1080, height: 1920, deviceScaleFactor: 2 },
  { width: 500, height: 500, deviceScaleFactor: 1 },
  { width: 100, height: 100, deviceScaleFactor: 1 },
]) {
  const lease = await acquireBrowser(
    buildChromeArgs({ width: viewport.width, height: viewport.height }, { disableGpu: true }),
    { enableBrowserPool: false, browserTimeout: 20000, protocolTimeout: 20000 },
  );
  const { browser } = lease;
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    if (results.length === 0) {
      const source = EMBEDDED_FONT_DATA.get("@fontsource/inter:400:normal");
      assert(source);
      for (const declarations of [
        'font-family: "Existing Font"',
        'font-family: "Other Font"; font-family: "Existing Font";',
        'font-family:   ; font-family: "Existing Font";',
      ]) {
        // A valid source precedes the exact descriptor suffix, preserving its final semicolon.
        await page.setContent(`<style>@font-face{src:url("${source}");${declarations}}</style>`);
        const family = await page.evaluate(() => {
          const rule = document.querySelector("style")!.sheet!.cssRules[0] as CSSFontFaceRule;
          return rule.style.getPropertyValue("font-family");
        });
        assert.equal(family, '"Existing Font"', `${await browser.version()}: ${declarations}`);
      }
      console.log("Font face CSSOM parity: 3 descriptor cases matched render Chrome");
      const importUrl = "data:text/css," + encodeURIComponent(":root{--import-witness:active}");
      for (const entry of [
        { tail: "screen", layer: null, supports: false, active: true },
        { tail: "layer(fonts) screen", layer: "fonts", supports: false, active: true },
        { tail: "layer screen", layer: "", supports: false, active: true },
        { tail: "layer(fonts) print", layer: "fonts", supports: false, active: false },
        {
          tail: "layer(fonts) supports((hf-no-such-property:1)) screen",
          layer: "fonts",
          supports: true,
          active: false,
        },
      ]) {
        await page.setContent(`<style>@import url("${importUrl}") ${entry.tail};</style>`);
        if (entry.active)
          await page.waitForFunction(
            () =>
              getComputedStyle(document.documentElement)
                .getPropertyValue("--import-witness")
                .trim() === "active",
          );
        const actual = await page.evaluate(() => {
          const rule = document.querySelector("style")!.sheet!.cssRules[0] as CSSImportRule;
          return {
            type: rule.type,
            layer: rule.layerName,
            supports: rule.supportsText !== null,
            media: matchMedia(rule.media.mediaText).matches,
            marker: getComputedStyle(document.documentElement)
              .getPropertyValue("--import-witness")
              .trim(),
          };
        });
        assert.equal(actual.type, 3, entry.tail);
        assert.equal(actual.layer, entry.layer, entry.tail);
        assert.equal(actual.supports, entry.supports, entry.tail);
        assert.equal(actual.media, !entry.tail.endsWith("print"), entry.tail);
        assert.equal(actual.marker, entry.active ? "active" : "", entry.tail);
      }
      console.log("Import qualifier CSSOM parity: 5 cases matched render Chrome");
    }
    results.push({
      version: await browser.version(),
      ...(await page.evaluate(
        (queries) => ({
          dpr: devicePixelRatio,
          width: innerWidth,
          height: innerHeight,
          screenWidth: screen.width,
          screenHeight: screen.height,
          colorDepth: screen.colorDepth,
          queries: Object.fromEntries(queries.map((q) => [q, matchMedia(q).matches])),
        }),
        queries,
      )),
    });
  } finally {
    await lease.release();
  }
}
let checked = 0;
const mismatches: string[] = [];
for (const row of results) {
  const matches = createFontMediaEvaluator({
    viewport: { width: row.width, height: row.height },
    deviceScaleFactor: row.dpr,
  });
  for (const [query, expected] of Object.entries(row.queries)) {
    const actual = matches(query);
    if ((actual === true) !== expected) {
      mismatches.push(
        `${row.version} ${row.width}x${row.height}@${row.dpr}: ${query}, evaluator=${actual}, Chrome=${expected}`,
      );
    }
    checked++;
  }
}
assert.deepEqual(mismatches, [], mismatches.join("\n"));
console.log(`Font media parity: ${checked} queries matched render Chrome`);
console.log(`Render Chrome: ${[...new Set(results.map((row) => row.version))].join(", ")}`);
