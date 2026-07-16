import { describe, expect, it } from "vitest";
import { evaluateSpringEase, parseSpringBounce } from "./springEase";

describe("single-parameter spring ease", () => {
  it("parses and clamps the bounce parameter", () => {
    expect(parseSpringBounce("spring(0.5)")).toBe(0.5);
    expect(parseSpringBounce(" spring(2) ")).toBe(1);
    expect(parseSpringBounce("spring(-1)")).toBe(0);
    expect(parseSpringBounce("spring(nope)")).toBeNull();
  });

  it("starts at zero, overshoots, and settles exactly at one", () => {
    const samples = Array.from({ length: 101 }, (_, index) => evaluateSpringEase(index / 100, 0.5));
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(1);
    expect(Math.max(...samples)).toBeGreaterThan(1);
  });

  it("is deterministic and makes higher bounce values more oscillatory", () => {
    const progress = Array.from({ length: 41 }, (_, index) => index / 40);
    expect(progress.map((value) => evaluateSpringEase(value, 0.75))).toEqual(
      progress.map((value) => evaluateSpringEase(value, 0.75)),
    );

    const lowBounce = progress.map((value) => evaluateSpringEase(value, 0.25));
    const highBounce = progress.map((value) => evaluateSpringEase(value, 0.75));
    expect(Math.max(...highBounce)).toBeGreaterThan(Math.max(...lowBounce));
  });
});
