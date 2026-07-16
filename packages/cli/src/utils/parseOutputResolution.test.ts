/**
 * Boundary tests for the shared `parseOutputResolutionFlag` helper. Every
 * distributed entrypoint (`hyperframes cloudrun render{,-batch}`,
 * `hyperframes lambda render{,-batch}`) delegates to this one function —
 * covering it here (rather than at each surface) makes the sibling-surface
 * regression this PR fixes unreachable by construction: any future surface
 * that calls `parseOutputResolutionFlag` inherits the correct alias
 * threading. The wire-config-level tests at
 * `../commands/cloudrun.test.ts` / `../commands/lambda/render.test.ts` /
 * `../commands/lambda/render-batch.test.ts` still exercise the
 * per-entrypoint composition so the plumbing stays end-to-end covered.
 */

import { describe, expect, it } from "vitest";
import { parseOutputResolutionFlag } from "./parseOutputResolution.js";

const CLOUDRUN = { surfaceLabel: "[cloudrun render]" } as const;
const LAMBDA = {
  surfaceLabel: "[lambda render]",
  aliasHint:
    "1080p, 4k, uhd, hd, 1080p-portrait, portrait-1080p, 4k-portrait, 1080p-square, square-1080p, 4k-square",
} as const;

describe("parseOutputResolutionFlag", () => {
  it.each([undefined, "", null])(
    "returns undefined + false when the flag is omitted (raw=%s)",
    (raw) => {
      expect(parseOutputResolutionFlag(raw, CLOUDRUN)).toEqual({
        outputResolution: undefined,
        outputResolutionAspectAgnostic: false,
      });
    },
  );

  it.each(["landscape", "portrait-4k", "square", "square-4k"])(
    "normalizes canonical preset %s with aspect-agnostic=false",
    (preset) => {
      const { outputResolution, outputResolutionAspectAgnostic } = parseOutputResolutionFlag(
        preset,
        CLOUDRUN,
      );
      expect(outputResolution).toBe(preset);
      expect(outputResolutionAspectAgnostic).toBe(false);
    },
  );

  // The blocker path from Miga's R2 review: without this pair, a portrait
  // composition with `--output-resolution 1080p` reaches the compile stage
  // as the explicit `landscape` preset and rejects with the original
  // aspect-mismatch instead of remapping to `portrait`.
  it.each(["1080p", "hd", "4k", "uhd"])(
    "flags aspect-agnostic tier alias %s so the compile stage can remap orientation",
    (alias) => {
      const { outputResolution, outputResolutionAspectAgnostic } = parseOutputResolutionFlag(
        alias,
        CLOUDRUN,
      );
      expect(outputResolutionAspectAgnostic).toBe(true);
      expect(outputResolution).toBeDefined();
    },
  );

  it.each(["1080p-portrait", "portrait-1080p", "1080p-square", "4k-portrait", "4k-square"])(
    "does NOT flag orientation-suffixed alias %s as aspect-agnostic",
    (alias) => {
      // The user picked an orientation — respect it, don't silently swap.
      const { outputResolutionAspectAgnostic } = parseOutputResolutionFlag(alias, CLOUDRUN);
      expect(outputResolutionAspectAgnostic).toBe(false);
    },
  );

  it("treats input case-insensitively (1080P, UHD, HD, 4K all pass)", () => {
    for (const alias of ["1080P", "UHD", "HD", "4K"]) {
      expect(parseOutputResolutionFlag(alias, CLOUDRUN).outputResolutionAspectAgnostic).toBe(true);
    }
  });

  it("throws with the caller-supplied surface label on unknown values", () => {
    // The two surfaces MUST use the same underlying helper (see PR #2529 —
    // divergent copies is exactly the cross-scaffold drift class this
    // consolidation prevents), but each stakes its own label so debugging
    // still points at the right verb.
    expect(() => parseOutputResolutionFlag("8k", CLOUDRUN)).toThrow(/\[cloudrun render\]/);
    expect(() => parseOutputResolutionFlag("8k", LAMBDA)).toThrow(/\[lambda render\]/);
  });

  it("appends the caller-supplied aliasHint to the error text (so the message stays surface-accurate)", () => {
    // Lambda advertises the full orientation-suffixed alias list in help
    // text; the error message must match that surface for the user's
    // "did you mean?" search to land on real docs.
    const err = getThrown(() => parseOutputResolutionFlag("8k", LAMBDA));
    expect(err.message).toContain("1080p-portrait");
    expect(err.message).toContain("4k-portrait");
  });
});

function getThrown(fn: () => void): Error {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error(`Non-Error thrown: ${String(e)}`);
  }
  throw new Error("Expected fn to throw, but it did not");
}
