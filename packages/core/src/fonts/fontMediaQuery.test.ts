// @vitest-environment node
import { expect, it } from "vitest";
import { createFontMediaEvaluator } from "./fontMediaQuery.js";

it.each([
  ["(resolution: 2dppx)", true],
  ["(resolution: 192dpi)", true],
  ["(resolution: 1dppx)", false],
  ["(min-width: 100mm)", true],
  ["(min-width: 100pt)", true],
  ["(min-width: 1000q)", false],
  ["(orientation: portrait)", true],
  ["(orientation: landscape)", false],
  ["(100px <= width < 600px)", true],
  ["(prefers-color-scheme: light)", true],
  ["(prefers-reduced-motion: reduce)", false],
  ["(prefers-reduced-data: reduce)", false],
  ["(prefers-reduced-data: no-preference)", false],
  ["not (prefers-reduced-data: reduce)", false],
  ["not screen and (prefers-reduced-data: reduce)", false],
  ["screen and (prefers-reduced-data: reduce), (min-width: 1px)", true],
  ["((prefers-reduced-data: reduce) or (min-width: 1px))", true],
  ["imaginary", false],
  ["not imaginary", true],
  ["screen, (", true],
])("matches render Chrome for %s", (query, expected) => {
  const matches = createFontMediaEvaluator({
    viewport: { width: 500, height: 500 },
    deviceScaleFactor: 2,
  });
  expect(matches(query) === true).toBe(expected);
});

it("keeps absolute units below their boundary", () => {
  const matches = createFontMediaEvaluator({
    viewport: { width: 100, height: 100 },
    deviceScaleFactor: 1,
  });
  expect(matches("(min-width: 100mm)")).toBe(false);
  expect(matches("(min-width: 100pt)")).toBe(false);
  expect(matches("(min-width: 1000q)")).toBe(false);
});

it("keeps unknown conditions distinct through negation and boolean combinations", () => {
  const evaluate = createFontMediaEvaluator({
    viewport: { width: 500, height: 500 },
    deviceScaleFactor: 1,
  });
  expect(evaluate("(device-width: 500px)")).toBe("unknown");
  expect(evaluate("not (device-width: 500px)")).toBe("unknown");
  expect(evaluate("((device-width: 500px) and (width < 1px))")).toBe(false);
  expect(evaluate("((device-width: 500px) or (width > 1px))")).toBe(true);
});

it.each([
  "(min-resolution:-1dppx)",
  "(resolution:-1dppx)",
  "not (resolution:-1dppx)",
  "(min-aspect-ratio:-1)",
  "(min-aspect-ratio:-1/2)",
  "(min-aspect-ratio:1/-2)",
  "not (aspect-ratio:-1/2)",
])("preserves unknown for invalid numeric domains in %s", (query) => {
  const evaluate = createFontMediaEvaluator({
    viewport: { width: 500, height: 500 },
    deviceScaleFactor: 1,
  });
  expect(evaluate(query)).toBe("unknown");
});

it.each([
  ["(aspect-ratio:0/0)", false],
  ["not (aspect-ratio:0/0)", true],
  ["(min-aspect-ratio:0/0)", false],
  ["(max-aspect-ratio:0/0)", true],
  ["(aspect-ratio < 0/0)", true],
  ["(aspect-ratio > 0/0)", false],
])("orders a degenerate 0/0 ratio like Chrome in %s", (query, expected) => {
  const evaluate = createFontMediaEvaluator({
    viewport: { width: 500, height: 500 },
    deviceScaleFactor: 1,
  });
  expect(evaluate(query)).toBe(expected);
});
