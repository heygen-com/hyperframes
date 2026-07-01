// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mapEase } from "./motionEase";

describe("mapEase", () => {
  it("maps linear to none", () => {
    expect(mapEase("linear")).toEqual({ kind: "named", ease: "none" });
  });
  it("maps a bezier array through unchanged", () => {
    expect(mapEase([0.539, 0, 0.312, 0.995])).toEqual({
      kind: "bezier",
      bezier: [0.539, 0, 0.312, 0.995],
    });
  });
  it("maps named eases to GSAP equivalents (case/format insensitive)", () => {
    expect(mapEase("easeOut")).toEqual({ kind: "named", ease: "power2.out" });
    expect(mapEase("EASE_IN_AND_OUT")).toEqual({
      kind: "named",
      ease: "power2.inOut",
    });
    expect(mapEase("backOut")).toEqual({ kind: "named", ease: "back.out" });
    expect(mapEase("HOLD")).toEqual({ kind: "named", ease: "steps(1)" });
  });
  it("falls back to none for unknown named eases", () => {
    expect(mapEase("wobble")).toEqual({ kind: "named", ease: "none" });
  });
});

describe("mapEase validation + coverage", () => {
  it("rejects malformed bezier arrays (wrong length / NaN) to linear", () => {
    expect(mapEase([0.5, 0, 0.3] as unknown as [number, number, number, number])).toEqual({
      kind: "named",
      ease: "none",
    });
    expect(mapEase([0.5, Number.NaN, 0.3, 1])).toEqual({ kind: "named", ease: "none" });
  });
  it("covers circ/expo/bounce/elastic/anticipate/spring", () => {
    expect(mapEase("circOut")).toEqual({ kind: "named", ease: "circ.out" });
    expect(mapEase("expoInOut")).toEqual({ kind: "named", ease: "expo.inOut" });
    expect(mapEase("bounceOut")).toEqual({ kind: "named", ease: "bounce.out" });
    expect(mapEase("elasticOut")).toEqual({ kind: "named", ease: "elastic.out" });
    expect(mapEase("anticipate")).toEqual({ kind: "named", ease: "back.in" });
    expect(mapEase("spring")).toEqual({ kind: "named", ease: "elastic.out" });
  });
});
