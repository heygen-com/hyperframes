/**
 * Shared test utilities for parser test suites (T1, T2, T6…).
 * Import from here rather than duplicating helpers across test files.
 *
 * Not part of the public package exports — consumed only by *.test.ts files.
 */
import { generateHyperframesHtml } from "../generators/hyperframes.js";
import type { ParsedHtml } from "./htmlParser.js";

export function maxEndTime(elements: ParsedHtml["elements"]): number {
  if (elements.length === 0) return 0;
  return Math.max(...elements.map((e) => e.startTime + e.duration));
}

/**
 * Round-trip serialize helper.
 * Fixed compositionId prevents Date.now() churn from masking structural instability.
 * The compositionId generation instability itself is tracked as R1 (stable hf- ids).
 */
export function serialize(parsed: ParsedHtml): string {
  return generateHyperframesHtml(parsed.elements, maxEndTime(parsed.elements), {
    compositionId: "test-comp",
    resolution: parsed.resolution,
    styles: parsed.styles ?? undefined,
    keyframes: parsed.keyframes,
    stageZoomKeyframes: parsed.stageZoomKeyframes,
  });
}
