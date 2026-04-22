import { describe, it, expect } from "vitest";
import { shouldInjectRuntime, type ProbeState } from "./shouldInjectRuntime.js";

const baseState: ProbeState = {
  hasRuntime: false,
  hasTimelines: false,
  hasNestedCompositions: false,
  runtimeInjected: false,
  attempts: 1,
};

describe("shouldInjectRuntime", () => {
  it("never injects when the runtime bridge is already present", () => {
    for (let attempts = 0; attempts <= 40; attempts++) {
      expect(
        shouldInjectRuntime({
          ...baseState,
          hasRuntime: true,
          hasTimelines: true,
          hasNestedCompositions: true,
          attempts,
        }),
      ).toBe(false);
    }
  });

  it("never injects twice — runtimeInjected short-circuits", () => {
    expect(
      shouldInjectRuntime({
        ...baseState,
        hasTimelines: true,
        hasNestedCompositions: true,
        runtimeInjected: true,
        attempts: 10,
      }),
    ).toBe(false);
  });

  describe("nested compositions (data-composition-src children)", () => {
    it("injects on the first tick — no attempts gate", () => {
      expect(
        shouldInjectRuntime({
          ...baseState,
          hasNestedCompositions: true,
          attempts: 1,
        }),
      ).toBe(true);
    });

    // Regression: product-promo and other registry examples register inline
    // pre-runtime timelines (`window.__timelines["main"]`) with only partial
    // durations during iframe load. Without this, the adapter path would
    // resolve against that partial timeline and lock the player into a
    // broken "ready" state before the 5-tick fallback ever fires.
    it("injects even when pre-runtime timelines are already registered", () => {
      expect(
        shouldInjectRuntime({
          ...baseState,
          hasTimelines: true,
          hasNestedCompositions: true,
          attempts: 1,
        }),
      ).toBe(true);
    });

    it("does not re-inject once runtimeInjected flips", () => {
      expect(
        shouldInjectRuntime({
          ...baseState,
          hasNestedCompositions: true,
          runtimeInjected: true,
          attempts: 1,
        }),
      ).toBe(false);
    });
  });

  describe("self-contained compositions (GSAP-only, no nested children)", () => {
    it("waits during the grace period (attempts < 5) even with timelines", () => {
      for (let attempts = 0; attempts < 5; attempts++) {
        expect(
          shouldInjectRuntime({
            ...baseState,
            hasTimelines: true,
            attempts,
          }),
        ).toBe(false);
      }
    });

    it("injects as a fallback at attempt 5", () => {
      expect(
        shouldInjectRuntime({
          ...baseState,
          hasTimelines: true,
          attempts: 5,
        }),
      ).toBe(true);
    });

    it("does not inject when there are neither timelines nor nested scenes", () => {
      for (let attempts = 0; attempts <= 40; attempts++) {
        expect(
          shouldInjectRuntime({
            ...baseState,
            attempts,
          }),
        ).toBe(false);
      }
    });
  });
});
