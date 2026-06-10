// fallow-ignore-file dead-code
import { expect } from "vitest";
import {
  parseGsapScript,
  serializeGsapAnimations,
  convertToKeyframesInScript,
} from "./gsapParser.js";
import type { GsapAnimation, GsapPercentageKeyframe } from "./gsapParser.js";

/**
 * Parse a script and serialize the result, returning both the parsed output
 * and the serialized string for assertion. Shared across gsapParser.test.ts
 * and gsapParser.stress.test.ts.
 */
export function parseAndSerialize(script: string) {
  const parsed = parseGsapScript(script);
  const serialized = serializeGsapAnimations(parsed.animations, parsed.timelineVar, {
    preamble: parsed.preamble,
    postamble: parsed.postamble,
  });
  return { parsed, serialized };
}

/**
 * Parse a script expecting exactly one animation, and return it directly.
 */
export function parseSingleAnimation(script: string): GsapAnimation {
  const result = parseGsapScript(script);
  expect(result.animations).toHaveLength(1);
  return result.animations[0]!;
}

/**
 * Assert that a parsed animation's stagger extra exists and contains
 * the expected substrings (as a __raw: prefixed string).
 */
export function expectStaggerRaw(anim: GsapAnimation, ...expectedSubstrings: string[]): void {
  expect(anim.extras).toBeDefined();
  expect(anim.extras!.stagger).toBeDefined();
  const stagger = String(anim.extras!.stagger);
  expect(stagger.startsWith("__raw:")).toBe(true);
  for (const sub of expectedSubstrings) {
    expect(stagger).toContain(sub);
  }
}

/**
 * Assert a single keyframe's percentage, properties, and optional ease.
 */
export function expectKeyframe(
  kf: GsapPercentageKeyframe,
  percentage: number,
  properties: Record<string, number | string>,
  ease?: string,
): void {
  expect(kf.percentage).toBe(percentage);
  for (const [key, value] of Object.entries(properties)) {
    expect(kf.properties[key]).toBe(value);
  }
  if (ease !== undefined) {
    expect(kf.ease).toBe(ease);
  }
}

/**
 * Assert that an animation has a defined keyframes block with the expected format
 * and count, and return the keyframes array for further assertions.
 */
export function expectKeyframesFormat(
  anim: GsapAnimation,
  format: string,
  count: number,
): GsapPercentageKeyframe[] {
  expect(anim.keyframes).toBeDefined();
  expect(anim.keyframes!.format).toBe(format);
  expect(anim.keyframes!.keyframes).toHaveLength(count);
  return anim.keyframes!.keyframes;
}

/**
 * Parse a script expecting one animation, assert that `rawProp` is a __raw: string
 * and `resolvableProp` has the expected value.
 */
export function expectRawWithResolvable(
  script: string,
  rawProp: string,
  resolvableProp: string,
  resolvableValue: number | string,
): void {
  const anim = parseSingleAnimation(script);
  const val = anim.properties[rawProp];
  expect(typeof val === "string" && val.startsWith("__raw:")).toBe(true);
  expect(anim.properties[resolvableProp]).toBe(resolvableValue);
}

/**
 * Parse a script expecting one animation, assert that `position` matches the expected value.
 */
export function expectSingleAnimPosition(script: string, position: number): void {
  const anim = parseSingleAnimation(script);
  expect(anim.position).toBe(position);
}

/**
 * Parse a script, get the first animation id, run convertToKeyframesInScript,
 * reparse, and return the first animation for assertion.
 */
export function convertAndReparse(
  script: string,
  runtimeValues?: Record<string, number | string>,
): GsapAnimation {
  const id = parseSingleAnimation(script).id;
  const updated = convertToKeyframesInScript(script, id, runtimeValues);
  return parseSingleAnimation(updated);
}

/**
 * Parse a script, return the first animation and run a split-related reparse.
 * Asserts the reparse result has exactly `expectedCount` animations and returns
 * the selector of the first animation.
 */
export function parseSplitAndAssert(
  script: string,
  splitFn: (s: string) => string,
  expectedCount: number,
): string[] {
  const result = splitFn(script);
  const parsed = parseGsapScript(result);
  expect(parsed.animations).toHaveLength(expectedCount);
  return parsed.animations.map((a) => a.targetSelector);
}
