import { describe, expect, it } from "vitest";
import { generateSpringEaseData } from "../../../parsers/src/springEase.js";
import {
  parseCustomEase,
  parseCustomEasePath,
  resolveEase,
  serializeCustomEase,
} from "./easeMap.js";

type EaseFn = (t: number) => number;
type Direction = "in" | "out" | "inOut";

const DIRECTIONS: Direction[] = ["in", "out", "inOut"];
const SAMPLES = [0, 0.25, 0.5, 0.75, 1];
const TOLERANCE = 1e-3;

// Literal reference samples computed from the bundled GSAP 3.15 runtime at
// node_modules/.bun/gsap@3.15.0/node_modules/gsap/dist/gsap.js using
// gsap.default.parseEase(name), sampled at t = 0, 0.25, 0.5, 0.75, 1.
const GSAP_REFERENCE_SAMPLES: Record<string, number[]> = {
  "power1.in": [0.0, 0.0625, 0.25, 0.5625, 1.0],
  "power1.out": [0.0, 0.4375, 0.75, 0.9375, 1.0],
  "power1.inOut": [0.0, 0.125, 0.5, 0.875, 1.0],
  "power2.in": [0.0, 0.015625, 0.125, 0.421875, 1.0],
  "power2.out": [0.0, 0.578125, 0.875, 0.984375, 1.0],
  "power2.inOut": [0.0, 0.0625, 0.5, 0.9375, 1.0],
  "power3.in": [0.0, 0.003906, 0.0625, 0.316406, 1.0],
  "power3.out": [0.0, 0.683594, 0.9375, 0.996094, 1.0],
  "power3.inOut": [0.0, 0.03125, 0.5, 0.96875, 1.0],
  "power4.in": [0.0, 0.000977, 0.03125, 0.237305, 1.0],
  "power4.out": [0.0, 0.762695, 0.96875, 0.999023, 1.0],
  "power4.inOut": [0.0, 0.015625, 0.5, 0.984375, 1.0],
  "back.in": [0.0, -0.064137, -0.087697, 0.18259, 1.0],
  "back.out": [0.0, 0.81741, 1.087697, 1.064137, 1.0],
  "back.inOut": [0.0, -0.043849, 0.5, 1.043849, 1.0],
  "back.out(2)": [0.0, 0.859375, 1.125, 1.078125, 1.0],
  "elastic.in": [0.0, -0.005524, -0.015625, 0.088388, 1.0],
  "elastic.out": [0.0, 0.911612, 1.015625, 1.005524, 1.0],
  "elastic.inOut": [0.0, 0.011969, 0.5, 0.988031, 1.0],
  "elastic.out(1, 0.45)": [0.0, 1.166116, 0.976061, 1.002762, 1.0],
  "bounce.in": [0.0, 0.027344, 0.234375, 0.527344, 1.0],
  "bounce.out": [0.0, 0.472656, 0.765625, 0.972656, 1.0],
  "bounce.inOut": [0.0, 0.117188, 0.5, 0.882813, 1.0],
  "expo.in": [0.0, 0.001564, 0.023438, 0.177077, 1.0],
  "expo.out": [0.0, 0.822923, 0.976563, 0.998436, 1.0],
  "expo.inOut": [0.0, 0.011719, 0.5, 0.988281, 1.0],
  "sine.in": [0.0, 0.07612, 0.292893, 0.617317, 1.0],
  "sine.out": [0.0, 0.382683, 0.707107, 0.92388, 1.0],
  "sine.inOut": [0.0, 0.146447, 0.5, 0.853553, 1.0],
  "circ.in": [0.0, 0.031754, 0.133975, 0.338562, 1.0],
  "circ.out": [0.0, 0.661438, 0.866025, 0.968246, 1.0],
  "circ.inOut": [0.0, 0.066987, 0.5, 0.933013, 1.0],
  "steps(10)": [0.0, 0.2, 0.5, 0.8, 1.0],
  none: [0.0, 0.25, 0.5, 0.75, 1.0],
};

function expectClose(actual: number, expected: number, tolerance = TOLERANCE): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function expectGsapSamples(gsapEase: string, fn: EaseFn): void {
  const expectedValues = GSAP_REFERENCE_SAMPLES[gsapEase];
  if (expectedValues === undefined) throw new Error(`Missing GSAP samples for ${gsapEase}`);

  for (let i = 0; i < SAMPLES.length; i++) {
    const t = SAMPLES[i];
    const expected = expectedValues[i];
    if (t === undefined || expected === undefined) {
      throw new Error(`Missing sample ${i} for ${gsapEase}`);
    }
    expectClose(fn(t), expected);
  }
}

interface PowerFamily {
  gsap: string;
  anime: string;
}

interface NamedFamily {
  gsap: string;
  anime: string;
}

describe("resolveEase", () => {
  it("maps power eases to anime names and GSAP-equivalent runtime curves", () => {
    const powerFamilies: PowerFamily[] = [
      { gsap: "power1", anime: "Quad" },
      { gsap: "power2", anime: "Cubic" },
      { gsap: "power3", anime: "Quart" },
      { gsap: "power4", anime: "Quint" },
    ];

    for (const family of powerFamilies) {
      for (const direction of DIRECTIONS) {
        const resolved = resolveEase(`${family.gsap}.${direction}`);
        expect(resolved.animeEase).toBe(`${direction}${family.anime}`);
        expectGsapSamples(`${family.gsap}.${direction}`, resolved.fn);
      }
    }
  });

  it("maps named GSAP ease families to anime names and runtime curves", () => {
    const families: NamedFamily[] = [
      { gsap: "back", anime: "Back(1.70158)" },
      { gsap: "elastic", anime: "Elastic(1, .3)" },
      { gsap: "bounce", anime: "Bounce" },
      { gsap: "expo", anime: "Expo" },
      { gsap: "sine", anime: "Sine" },
      { gsap: "circ", anime: "Circ" },
    ];

    for (const family of families) {
      for (const direction of DIRECTIONS) {
        const resolved = resolveEase(`${family.gsap}.${direction}`);
        const animeSuffix =
          family.gsap === "elastic" && direction === "inOut" ? "Elastic(1, .45)" : family.anime;
        expect(resolved.animeEase).toBe(`${direction}${animeSuffix}`);
        expectGsapSamples(`${family.gsap}.${direction}`, resolved.fn);
      }
    }
  });

  it("maps parameterized back, elastic, steps, and none eases", () => {
    const back = resolveEase("back.out(2)");
    expect(back.animeEase).toBe("outBack(2)");
    expectGsapSamples("back.out(2)", back.fn);

    const elastic = resolveEase("elastic.out(1, 0.45)");
    expect(elastic.animeEase).toBe("outElastic(1, .45)");
    expectGsapSamples("elastic.out(1, 0.45)", elastic.fn);

    const steps = resolveEase("steps(10)");
    expect(steps.animeEase).toBe("steps(10)");
    expectGsapSamples("steps(10)", steps.fn);

    const none = resolveEase("none");
    expect(none.animeEase).toBe("linear");
    expectGsapSamples("none", none.fn);
  });

  it("maps supported spring presets through CustomEase path shims", () => {
    const resolved = resolveEase("spring-gentle");

    expect(resolved.warning).toBeUndefined();
    expect(resolved.customEase?.kind).toBe("customEase");
    expect(resolved.animeEase.startsWith("M0,0 L")).toBe(true);
    expectClose(resolved.fn(0), 0);
    expectClose(resolved.fn(1), 1);
  });

  it("falls back to outQuad with a warning for unknown eases", () => {
    const resolved = resolveEase("totally-not-a-real-ease");

    expect(resolved.animeEase).toBe("outQuad");
    expect(resolved.warning?.length).toBeGreaterThan(0);
    expectGsapSamples("power1.out", resolved.fn);
  });
});

describe("CustomEase path shim", () => {
  it("parses monotonic spring paths and round-trips an equivalent curve", () => {
    const path = generateSpringEaseData(1, 100, 30, 40);
    const parsed = parseCustomEase(path);
    const fn = parseCustomEasePath(path);
    const roundTrip = serializeCustomEase(parsed);
    const roundTripFn = parseCustomEasePath(roundTrip);

    let previous = fn(0);
    for (let i = 1; i <= 20; i++) {
      const t = i / 20;
      const value = fn(t);
      expect(value).toBeGreaterThanOrEqual(previous - 0.001);
      expectClose(roundTripFn(t), value);
      previous = value;
    }
  });
});
